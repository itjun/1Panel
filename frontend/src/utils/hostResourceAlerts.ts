import type { monitor } from "@/api";
import { api } from "@/api";
import { settingsAccess } from "@/utils/settingsAccess";
import {
  ALERT_KIND_LABEL,
  ALL_ALERT_KINDS,
  alertReading,
  alertThresholdText,
  levelRank,
  normalizeAlertLevels,
  RESOURCE_POLL_MS,
  type AlertRates,
  type AlertReading,
  type AlertStartLevel,
  type ResourceAlertKind,
} from "@/utils/alerts";
import type { NotifyTextParts } from "@/utils/notifyMessage";
import {
  clearHostWecom,
  escalateHostWecom,
  fireHostWecom,
  repeatHostWecom,
} from "@/utils/wecomHostAlerts";

/** 每个「主机|指标」的推送状态 */
type AlertState = {
  /** 已推送到的最高档；undefined = 未告警 */
  active?: AlertStartLevel;
  startAt: number;
  lastPushAt: number;
  /** 告警期间最严重的一次读数，回落时写进恢复消息 */
  peak?: AlertReading;
  /** 连续达标 / 回落的拍数，满 alertSustain 才动作 */
  fireStreak: number;
  escalateStreak: number;
  recoverStreak: number;
};

/** 上一拍的累计计数器，用来算速率 */
type Counters = { at: number; rx: number; tx: number; read: number; write: number };

/** 已采过基线的主机（首拍只建基线，不推送） */
const baselined = new Set<string>();
const states = new Map<string, AlertState>();
const counters = new Map<string, Counters>();

const POLL_MS = RESOURCE_POLL_MS;

let timer: ReturnType<typeof setInterval> | null = null;
let ticking = false;
let lastTickAt = 0;

function stateOf(key: string): AlertState {
  let st = states.get(key);
  if (!st) {
    st = { startAt: 0, lastPushAt: 0, fireStreak: 0, escalateStreak: 0, recoverStreak: 0 };
    states.set(key, st);
  }
  return st;
}

function resetState(st: AlertState): void {
  st.active = undefined;
  st.peak = undefined;
  st.startAt = 0;
  st.lastPushAt = 0;
  st.fireStreak = 0;
  st.escalateStreak = 0;
  st.recoverStreak = 0;
}

function trackPeak(st: AlertState, reading: AlertReading): void {
  if (!st.peak || reading.severity > st.peak.severity) st.peak = reading;
}

/** 相邻两拍的累计计数器差 / 时间；第一拍或计数器变小（重启、回绕）时没有速率 */
function ratesOf(host: string, ov: monitor.Overview): AlertRates | null {
  const now: Counters = {
    at: Date.now(),
    rx: ov.netRxBytes || 0,
    tx: ov.netTxBytes || 0,
    read: ov.diskReadBytes || 0,
    write: ov.diskWriteBytes || 0,
  };
  const prev = counters.get(host);
  counters.set(host, now);
  if (!prev) return null;
  const sec = (now.at - prev.at) / 1000;
  if (sec <= 0) return null;
  const rx = now.rx - prev.rx;
  const tx = now.tx - prev.tx;
  const read = now.read - prev.read;
  const write = now.write - prev.write;
  if (rx < 0 || tx < 0 || read < 0 || write < 0) return null;
  return { rx: rx / sec, tx: tx / sec, read: read / sec, write: write / sec };
}

/** 结构化正文字段，供 notifyContentFields 勾选拼装；阈值写所在档在触发条件上的分界 */
function partsOf(
  host: string,
  kind: ResourceAlertKind,
  level: AlertStartLevel,
  reading: AlertReading,
  peak?: AlertReading
): NotifyTextParts {
  return {
    hostName: host,
    metric: ALERT_KIND_LABEL[kind],
    value: reading.text,
    threshold: alertThresholdText(kind, level, reading.condition),
    peak: peak?.text,
  };
}

function forgetHost(host: string): void {
  baselined.delete(host);
  counters.delete(host);
  for (const kind of ALL_ALERT_KINDS) states.delete(`${host}|${kind}`);
}

/**
 * 每个「主机|指标」的档位状态机（分界固定 60 / 85）：
 * 起推档 = 订阅里最低的一档。连续 N 拍达到起推档推告警；
 * 警告、危险都订时连续 N 拍到危险档推升级；连续 N 拍低于起推档推回落；
 * 未回落时每 M 分钟重复提醒；危险档降回警告档不推，只继续记峰值。
 */
async function pollHost(host: string): Promise<void> {
  const settings = settingsAccess();
  const subscribed = new Set(settings.listResourceNotifySubs(host));
  if (!subscribed.size) {
    forgetHost(host);
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

  const rates = ratesOf(host, ov);
  const first = !baselined.has(host);
  baselined.add(host);
  const sustain = Math.max(1, settings.alertSustain || 1);
  const repeatMs = Math.max(0, settings.alertRepeatMinutes || 0) * 60_000;
  const now = Date.now();

  for (const kind of ALL_ALERT_KINDS) {
    const key = `${host}|${kind}`;
    const st = stateOf(key);
    if (!subscribed.has(kind)) {
      if (st.active) void clearHostWecom({ key, host, kind });
      states.delete(key);
      continue;
    }
    const reading = alertReading(kind, { ov, disks, rates }, settings.alertLoadWindow);
    if (!reading) continue;
    const levels = normalizeAlertLevels(settings.alertLevels[kind]);
    const start = levels[0];
    const level = reading.level;
    const reached = level !== "ok" && levelRank(level) >= levelRank(start);

    if (first) {
      if (reached) {
        st.active = level;
        st.startAt = now;
        st.lastPushAt = now;
      }
      continue;
    }

    if (!st.active) {
      st.fireStreak = reached ? st.fireStreak + 1 : 0;
      if (!reached || st.fireStreak < sustain) continue;
      st.active = level;
      st.startAt = now;
      st.lastPushAt = now;
      st.fireStreak = 0;
      trackPeak(st, reading);
      await fireHostWecom({ key, host, kind, level, parts: partsOf(host, kind, level, reading) });
      continue;
    }

    if (!reached) {
      st.recoverStreak += 1;
      st.escalateStreak = 0;
      if (st.recoverStreak < sustain) continue;
      const active = st.active;
      const peak = st.peak;
      resetState(st);
      await clearHostWecom({
        key,
        host,
        kind,
        level: active,
        parts: partsOf(host, kind, start, reading, peak),
      });
      continue;
    }

    st.recoverStreak = 0;
    trackPeak(st, reading);
    if (st.active === "warn" && level === "danger") {
      st.escalateStreak += 1;
      if (st.escalateStreak >= sustain) {
        st.active = "danger";
        st.escalateStreak = 0;
        // 只订了警告档：升到危险档只记档位与峰值，不再推送
        if (levels.includes("danger")) {
          st.lastPushAt = now;
          await escalateHostWecom({ key, host, kind, parts: partsOf(host, kind, "danger", reading) });
          continue;
        }
      }
    } else {
      st.escalateStreak = 0;
    }

    if (repeatMs > 0 && now - st.lastPushAt >= repeatMs) {
      st.lastPushAt = now;
      await repeatHostWecom({
        key,
        host,
        kind,
        level: st.active,
        durationMs: now - st.startAt,
        parts: partsOf(host, kind, st.active, reading),
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
    const settings = settingsAccess();
    // 只打已订阅主机；空名单绝不 listHosts / 扫全集
    const hosts = settings.hostsWithResourceNotifySubs();
    if (hosts.length === 0) {
      baselined.clear();
      states.clear();
      counters.clear();
      return;
    }
    const active = new Set(hosts);
    for (const h of [...baselined]) {
      if (!active.has(h)) forgetHost(h);
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
