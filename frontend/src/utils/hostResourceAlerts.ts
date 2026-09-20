import type { monitor } from "@/api";
import { api } from "@/api";
import { useSettingsStore } from "@/stores/settings";
import {
  ALERT,
  ALL_ALERT_KINDS,
  isCpuAlert,
  isDiskLow,
  isLoadAlert,
  isMemAlert,
  type ResourceAlertKind,
} from "@/utils/alerts";
import { formatBytes } from "@/utils/format";
import type { NotifyTextParts } from "@/utils/alertNotify";
import { clearHostWecom, fireHostWecom } from "@/utils/wecomHostAlerts";

/** 上一拍各主机已触发的资源告警类型（首次只建基线，不告警） */
const prevKinds = new Map<string, Set<ResourceAlertKind>>();

const POLL_MS = 5000;
const GB = 1024 * 1024 * 1024;

let timer: ReturnType<typeof setInterval> | null = null;
let ticking = false;
let lastTickAt = 0;

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

function metricLabel(kind: ResourceAlertKind): string {
  switch (kind) {
    case "cpu":
      return "CPU";
    case "mem":
      return "内存";
    case "disk":
      return "磁盘";
    case "load":
      return "负载";
    default:
      return kind;
  }
}

/** 结构化正文字段，供 notifyContentFields 勾选拼装 */
function partsOf(
  host: string,
  kind: ResourceAlertKind,
  ov: monitor.Overview,
  disks: monitor.DiskInfo[] | null | undefined
): NotifyTextParts {
  const base: NotifyTextParts = {
    hostName: host,
    metric: metricLabel(kind),
  };
  switch (kind) {
    case "cpu":
      return {
        ...base,
        value: `${ov.cpuPercent.toFixed(1)}%`,
        threshold: `≥ ${ALERT.cpu}%`,
      };
    case "mem":
      return {
        ...base,
        value: `${ov.memPercent.toFixed(1)}%`,
        threshold: `> ${ALERT.mem}%`,
      };
    case "load":
      return {
        ...base,
        value: `${ov.load1.toFixed(2)} / ${ov.cpuCount} 核`,
        threshold: `> ${ALERT.loadRatio}`,
      };
    case "disk": {
      const thr = ALERT.diskAvailBytes;
      const candidates = (disks || []).filter((d) => (d.total || 0) > thr);
      let value = `可用不足 ${ALERT.diskAvailBytes / GB} GB`;
      if (candidates.length) {
        const worst = [...candidates].sort(
          (a, b) => (a.avail || 0) - (b.avail || 0)
        )[0];
        const mount = worst.mount || worst.filesystem || "磁盘";
        value = `${mount} 可用 ${formatBytes(worst.avail)}`;
      }
      return {
        ...base,
        value,
        threshold: `≤ ${ALERT.diskAvailBytes / GB} GB`,
      };
    }
    default:
      return base;
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
        parts: partsOf(host, kind, ov, disks),
      });
    } else if (!on && was) {
      prev.delete(kind);
      await clearHostWecom({
        key: `${host}|${kind}`,
        host,
        kind,
        parts: {
          hostName: host,
          metric: metricLabel(kind),
        },
      });
    }
  }
}

async function tick(): Promise<void> {
  if (ticking) return;
  const now = Date.now();
  // 可见时 setInterval 每 5 秒一拍，后端 alert-poll-tick 也是 5 秒。
  // 只挡在途的话，请求很快返回后另一路会把同一批主机再打一遍。
  if (now - lastTickAt < POLL_MS - 400) return;
  lastTickAt = now;
  ticking = true;
  try {
    const settings = useSettingsStore();
    // 只打已订阅主机；空名单绝不 listHosts / 扫全集
    const hosts = settings.hostsWithResourceNotifySubs();
    if (hosts.length === 0) {
      prevKinds.clear();
      return;
    }
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
