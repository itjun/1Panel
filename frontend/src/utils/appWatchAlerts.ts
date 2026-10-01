import type { agentcli } from "@/api";
import { api } from "@/api";
import { settingsAccess } from "@/utils/settingsAccess";
import {
  appendAndNotifyDesktop,
  notifyMessageFor,
  sendWecomAlertOnce,
  sendWecomRecover,
} from "@/utils/alertNotify";
import type { NotifyTextParts } from "@/utils/notifyMessage";
import {
  appAlertKind,
  isWatchServiceName,
} from "@/utils/watchServices";

/** 上一拍各主机服务是否健康（首次只建基线，不告警） */
const prevOk = new Map<string, Map<string, boolean>>();
/** 已发本地通知、尚未恢复的键 host|service → 告警事件 id（恢复时配对） */
const firedLocal = new Map<string, string>();
/** 已发企微、尚未恢复的键 */
const firedWecom = new Set<string>();

const POLL_MS = 5000;

let timer: ReturnType<typeof setInterval> | null = null;
let ticking = false;
let lastTickAt = 0;

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
  const settings = settingsAccess();
  if (!settings.isAppNotifySubscribed(opts.host, opts.service)) return;
  if (!settings.isContentKindEnabled("app")) return;

  const key = `${opts.host}|${opts.service}`;
  const kind = appAlertKind(opts.service);
  const parts: NotifyTextParts = {
    hostName: opts.host,
    service: opts.service,
    metric: "应用探活",
    value: opts.detail,
  };
  const message = notifyMessageFor({ state: "down", kind: "app", parts });
  const webhook = settings.effectiveWecomWebhook();

  if (!firedLocal.has(key)) {
    firedLocal.set(key, "");
    const eventId = await appendAndNotifyDesktop({
      host: opts.host,
      kind,
      state: "down",
      message,
      parts,
      wecom: !!webhook,
    });
    if (firedLocal.has(key)) firedLocal.set(key, eventId);
  }

  await sendWecomAlertOnce(firedWecom, key, {
    webhook,
    host: opts.host,
    kind,
    message,
  });
}

async function fireAppUp(opts: {
  host: string;
  service: string;
}): Promise<void> {
  // 恢复：只有曾发出过通知才回落；去重态先清，再看闸门
  const key = `${opts.host}|${opts.service}`;
  const hadLocal = firedLocal.has(key);
  const incidentId = firedLocal.get(key) || "";
  firedLocal.delete(key);
  const hadWecom = firedWecom.delete(key);
  if (!hadLocal && !hadWecom) return;

  const settings = settingsAccess();
  if (!settings.notifyRecoverEnabled) return;
  if (!settings.isContentKindEnabled("app")) return;

  const kind = appAlertKind(opts.service);
  const parts: NotifyTextParts = {
    hostName: opts.host,
    service: opts.service,
    metric: "应用探活",
    value: "探活已恢复",
  };
  const message = notifyMessageFor({ state: "up", kind: "app", parts });
  if (hadLocal) {
    await appendAndNotifyDesktop({
      host: opts.host,
      kind,
      state: "up",
      message,
      parts,
      incidentId,
      wecom: hadWecom && !!settings.effectiveWecomWebhook(),
    });
  }

  if (!hadWecom) return;
  await sendWecomRecover({ host: opts.host, kind, message });
}

async function pollHost(host: string): Promise<void> {
  const settings = settingsAccess();
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
  const now = Date.now();
  // 与资源告警同一原因：setInterval 和 alert-poll-tick 不要各打一整轮。
  if (now - lastTickAt < POLL_MS - 400) return;
  lastTickAt = now;
  ticking = true;
  try {
    const settings = settingsAccess();
    // 只打已订阅主机；空名单绝不 listHosts / 扫全集
    const hosts = settings.hostsWithAppNotifySubs();
    if (hosts.length === 0) {
      prevOk.clear();
      return;
    }
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

export function tickAppWatchAlertPoll(): void {
  void tick();
}
