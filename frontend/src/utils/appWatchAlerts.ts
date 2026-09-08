import type { agentcli } from "@/api";
import { api } from "@/api";
import { useAppStore } from "@/stores/app";
import { useSettingsStore } from "@/stores/settings";
import {
  appendAndNotifyDesktop,
  sendWecomAlertOnce,
  sendWecomRecover,
} from "@/utils/alertNotify";
import {
  appAlertKind,
  isWatchServiceName,
} from "@/utils/watchServices";

/** 上一拍各主机服务是否健康（首次只建基线，不告警） */
const prevOk = new Map<string, Map<string, boolean>>();
/** 已发本地通知、尚未恢复的键 host|service */
const firedLocal = new Set<string>();
/** 已发企微、尚未恢复的键 */
const firedWecom = new Set<string>();

const POLL_MS = 5000;

let timer: ReturnType<typeof setInterval> | null = null;
let ticking = false;

function serviceOk(st: agentcli.WatchStatus): boolean {
  if (!st.processUp || !st.healthUp) return false;
  if (st.ingressOn && !st.ingressUp) return false;
  return true;
}

function detailOf(st: agentcli.WatchStatus, ok: boolean): string {
  if (ok) return "探活已恢复";
  const parts: string[] = [];
  if (!st.processUp) parts.push("进程异常");
  if (!st.healthUp) parts.push("健康检查失败");
  if (st.ingressOn && !st.ingressUp) parts.push("入口异常");
  return parts.length ? parts.join(" · ") : "探活异常";
}

async function fireAppDown(opts: {
  host: string;
  service: string;
  detail: string;
}): Promise<void> {
  const settings = useSettingsStore();
  if (!settings.isAppNotifySubscribed(opts.host, opts.service)) return;

  const key = `${opts.host}|${opts.service}`;
  const kind = appAlertKind(opts.service);
  const title = `「${opts.host}」${opts.service} 探活异常`;
  const body = opts.detail || title;

  if (!firedLocal.has(key)) {
    firedLocal.add(key);
    await appendAndNotifyDesktop({
      host: opts.host,
      kind,
      state: "down",
      title,
      body,
    });
  }

  const webhook = settings.effectiveWecomWebhook();
  await sendWecomAlertOnce(firedWecom, key, {
    webhook,
    host: opts.host,
    kind,
    detail: opts.detail,
  });
}

async function fireAppUp(opts: {
  host: string;
  service: string;
}): Promise<void> {
  // 恢复：只有曾发出过通知才回落；当下是否仍订阅不影响（避免吞掉恢复）
  const key = `${opts.host}|${opts.service}`;
  const hadLocal = firedLocal.delete(key);
  const hadWecom = firedWecom.delete(key);
  if (!hadLocal && !hadWecom) return;

  if (hadLocal) {
    await appendAndNotifyDesktop({
      host: opts.host,
      kind: appAlertKind(opts.service),
      state: "up",
      title: `「${opts.host}」${opts.service} 已恢复`,
      body: "探活已恢复",
    });
  }

  if (!hadWecom) return;
  await sendWecomRecover({
    host: opts.host,
    kind: appAlertKind(opts.service),
  });
}

async function pollHost(host: string): Promise<void> {
  const settings = useSettingsStore();
  const subscribed = new Set(settings.listAppNotifySubs(host));
  if (!subscribed.size) {
    prevOk.delete(host);
    return;
  }

  let rows: agentcli.WatchStatus[] = [];
  try {
    rows = (await api.agentWatchStatus(host)) || [];
  } catch {
    return;
  }

  let hostMap = prevOk.get(host);
  const first = !hostMap;
  if (!hostMap) {
    hostMap = new Map();
    prevOk.set(host, hostMap);
  }

  for (const st of rows) {
    const service = (st.service || "").trim();
    if (!service || !isWatchServiceName(service)) continue;
    if (!subscribed.has(service)) continue;

    const ok = serviceOk(st);
    const prev = hostMap.get(service);
    hostMap.set(service, ok);
    if (first || prev === undefined) continue;

    if (prev && !ok) {
      await fireAppDown({
        host,
        service,
        detail: detailOf(st, false),
      });
    } else if (!prev && ok) {
      await fireAppUp({ host, service });
    }
  }
}

async function tick(): Promise<void> {
  if (ticking) return;
  ticking = true;
  try {
    const settings = useSettingsStore();
    const app = useAppStore();
    const hosts = settings
      .hostsWithAppNotifySubs()
      .filter((h) => app.isRunning(h));
    const active = new Set(hosts);
    for (const h of [...prevOk.keys()]) {
      if (!active.has(h)) prevOk.delete(h);
    }
    await Promise.all(hosts.map((h) => pollHost(h)));
  } finally {
    ticking = false;
  }
}

/** 启动全局应用探活告警轮询（面板侧；agent 企微仍关闭） */
export function startAppWatchAlertPoll(): void {
  stopAppWatchAlertPoll();
  void tick();
  timer = window.setInterval(() => {
    void tick();
  }, POLL_MS);
}

export function stopAppWatchAlertPoll(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
