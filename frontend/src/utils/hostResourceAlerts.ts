import type { monitor } from "@/api";
import { api } from "@/api";
import { settingsAccess } from "@/utils/settingsAccess";
import {
  ALL_ALERT_KINDS,
  alertThresholdText,
  levelRank,
  normalizeAlertLevels,
  RESOURCE_POLL_MS,
  resourceReading,
  type AlertStartLevel,
  type ResourceAlertKind,
  type ResourceReading,
} from "@/utils/alerts";
import type { NotifyTextParts } from "@/utils/notifyMessage";
import {
  clearHostWecom,
  escalateHostWecom,
  fireHostWecom,
} from "@/utils/wecomHostAlerts";

/** 已采过基线的主机（首拍只建基线，不推送） */
const baselined = new Set<string>();
/** 告警中的「主机|指标」→ 已推送到的最高档；不在表里即未告警 */
const activeLevels = new Map<string, AlertStartLevel>();
/** 告警期间读数最高的一次（主机|指标 → 峰值），回落时写进恢复消息 */
const peaks = new Map<string, ResourceReading>();

const POLL_MS = RESOURCE_POLL_MS;

let timer: ReturnType<typeof setInterval> | null = null;
let ticking = false;
let lastTickAt = 0;

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

function trackPeak(key: string, reading: ResourceReading): void {
  const prev = peaks.get(key);
  if (!prev || reading.percent > prev.percent) peaks.set(key, reading);
}

/** 结构化正文字段，供 notifyContentFields 勾选拼装；阈值写所在档的分界 */
function partsOf(
  host: string,
  kind: ResourceAlertKind,
  level: AlertStartLevel,
  reading: ResourceReading,
  peak?: ResourceReading
): NotifyTextParts {
  return {
    hostName: host,
    metric: metricLabel(kind),
    value: reading.text,
    threshold: alertThresholdText(kind, level),
    peak: peak?.text,
  };
}

function forgetHost(host: string): void {
  baselined.delete(host);
  for (const kind of ALL_ALERT_KINDS) {
    activeLevels.delete(`${host}|${kind}`);
    peaks.delete(`${host}|${kind}`);
  }
}

/**
 * 每个「主机|指标」的档位状态机：
 * 起推档 = 订阅里最低的一档。低于起推档 → 达到起推档推告警；
 * 警告、危险都订时升到危险档推升级；
 * 跌回起推档以下推回落；危险档降回警告档不推，只继续记峰值。
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

  const first = !baselined.has(host);
  baselined.add(host);

  for (const kind of ALL_ALERT_KINDS) {
    const key = `${host}|${kind}`;
    const active = activeLevels.get(key);
    if (!subscribed.has(kind)) {
      if (active) {
        activeLevels.delete(key);
        peaks.delete(key);
        void clearHostWecom({ key, host, kind });
      }
      continue;
    }
    const reading = resourceReading(kind, ov, disks);
    if (!reading) continue;
    const levels = normalizeAlertLevels(settings.alertLevels[kind]);
    const start = levels[0];
    const level = reading.level;
    const reached = level !== "ok" && levelRank(level) >= levelRank(start);

    if (first) {
      if (reached) activeLevels.set(key, level);
      continue;
    }

    if (reached) {
      trackPeak(key, reading);
      if (!active) {
        activeLevels.set(key, level);
        await fireHostWecom({
          key,
          host,
          kind,
          level,
          parts: partsOf(host, kind, level, reading),
        });
      } else if (active === "warn" && level === "danger") {
        activeLevels.set(key, "danger");
        // 只订了警告档：升到危险档只记档位与峰值，不再推送
        if (levels.includes("danger")) {
          await escalateHostWecom({
            key,
            host,
            kind,
            parts: partsOf(host, kind, "danger", reading),
          });
        }
      }
    } else if (active) {
      activeLevels.delete(key);
      const peak = peaks.get(key);
      peaks.delete(key);
      await clearHostWecom({
        key,
        host,
        kind,
        level: active,
        parts: partsOf(host, kind, start, reading, peak),
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
      activeLevels.clear();
      peaks.clear();
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
