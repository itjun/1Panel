import type { monitor } from "@/api";
import { api } from "@/api";
import { useSettingsStore } from "@/stores/settings";
import {
  ALERT,
  ALL_ALERT_KINDS,
  diskLowMessage,
  isCpuAlert,
  isDiskLow,
  isLoadAlert,
  isMemAlert,
  type ResourceAlertKind,
} from "@/utils/alerts";
import { clearHostWecom, fireHostWecom } from "@/utils/wecomHostAlerts";

/** 上一拍各主机已触发的资源告警类型（首次只建基线，不告警） */
const prevKinds = new Map<string, Set<ResourceAlertKind>>();

const POLL_MS = 5000;

let timer: ReturnType<typeof setInterval> | null = null;
let ticking = false;

function collectKinds(
  ov: monitor.Overview | null | undefined,
  disks: monitor.DiskInfo[] | null | undefined
): Set<ResourceAlertKind> {
  const out = new Set<ResourceAlertKind>();
  if (!ov) return out;
  if (isCpuAlert(ov)) out.add("cpu");
  if (isMemAlert(ov)) out.add("mem");
  if (isLoadAlert(ov)) out.add("load");
  if (isDiskLow(disks)) out.add("disk");
  return out;
}

function detailOf(
  host: string,
  kind: ResourceAlertKind,
  ov: monitor.Overview,
  disks: monitor.DiskInfo[] | null | undefined
): string {
  switch (kind) {
    case "cpu":
      return `「${host}」CPU ${ov.cpuPercent.toFixed(1)}% ≥ ${ALERT.cpu}%`;
    case "mem":
      return `「${host}」内存 ${ov.memPercent.toFixed(1)}% 超过 ${ALERT.mem}%`;
    case "load":
      return `「${host}」负载 ${ov.load1.toFixed(2)} / ${ov.cpuCount} 核 超过警戒`;
    case "disk":
      return diskLowMessage(host, disks);
    default:
      return `「${host}」${kind}超阈值`;
  }
}

async function pollHost(host: string): Promise<void> {
  const settings = useSettingsStore();
  const subscribed = new Set(settings.listResourceNotifySubs(host));
  if (!subscribed.size) {
    prevKinds.delete(host);
    return;
  }

  let ov: monitor.Overview | null = null;
  let disks: monitor.DiskInfo[] = [];
  try {
    ov = await api.collectOverview(host);
  } catch {
    return;
  }
  try {
    disks = (await api.collectDisks(host)) || [];
  } catch {
    disks = [];
  }
  if (!ov) return;

  const now = collectKinds(ov, disks);
  let prev = prevKinds.get(host);
  const first = !prev;
  if (!prev) {
    prev = new Set();
    prevKinds.set(host, prev);
  }

  for (const kind of ALL_ALERT_KINDS) {
    if (!subscribed.has(kind)) {
      if (prev.has(kind)) {
        prev.delete(kind);
        void clearHostWecom({
          key: `${host}|${kind}`,
          host,
          kind,
        });
      }
      continue;
    }
    const on = now.has(kind);
    const was = prev.has(kind);
    if (first) {
      if (on) prev.add(kind);
      continue;
    }
    if (on && !was) {
      prev.add(kind);
      await fireHostWecom({
        key: `${host}|${kind}`,
        host,
        kind,
        detail: detailOf(host, kind, ov, disks),
      });
    } else if (!on && was) {
      prev.delete(kind);
      await clearHostWecom({
        key: `${host}|${kind}`,
        host,
        kind,
      });
    }
  }
}

async function tick(): Promise<void> {
  if (ticking) return;
  ticking = true;
  try {
    const settings = useSettingsStore();
    const hosts = settings.hostsWithResourceNotifySubs();
    const active = new Set(hosts);
    for (const h of [...prevKinds.keys()]) {
      if (!active.has(h)) prevKinds.delete(h);
    }
    await Promise.all(hosts.map((h) => pollHost(h)));
  } finally {
    ticking = false;
  }
}

/** 启动全局资源告警轮询：已订阅主机不依赖当前打开的页签 */
export function startHostResourceAlertPoll(): void {
  stopHostResourceAlertPoll();
  void tick();
  timer = window.setInterval(() => {
    void tick();
  }, POLL_MS);
}

export function stopHostResourceAlertPoll(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

export function tickHostResourceAlertPoll(): void {
  void tick();
}
