import type { alerthistory } from "@/api";
import { isResourceAlertKind, type AlertStartLevel } from "@/utils/alerts";
import { parseAppAlertKind } from "@/utils/watchServices";

export type AlertEvent = alerthistory.Event;

/**
 * 一次事件：告警 + 它的恢复（按 incidentId 配对）。
 * - active：资源 / 应用告警还没回落
 * - resolved：已回落 / 已恢复
 * - unclosed：没收到回落（面板重启前触发，或之后同类又触发过），不再算进行中
 * - notice：证书、巡检这类单点提醒，本来就没有「回落」
 */
export type IncidentStatus = "active" | "resolved" | "unclosed" | "notice";

export type Incident = {
  id: string;
  host: string;
  kind: string;
  /** 应用探活的服务名；非应用为空 */
  service: string;
  down?: AlertEvent;
  /** 起推档为警告时，升到危险档的那条 */
  escalation?: AlertEvent;
  /** 未回落期间的重复提醒，按时间先后 */
  repeats: AlertEvent[];
  up?: AlertEvent;
  /** 事件到过的最高档；旧记录与非资源类为 undefined */
  level?: AlertStartLevel;
  status: IncidentStatus;
  startAt: number;
  endAt: number;
  /** 列表排序用：最后一次变化 */
  lastAt: number;
  unread: boolean;
  eventIds: string[];
  channels: string[];
};

export function isAppKind(kind: string): boolean {
  return !!parseAppAlertKind(kind) || (kind || "").startsWith("app:");
}

function hasRecovery(kind: string): boolean {
  return isResourceAlertKind(kind) || isAppKind(kind);
}

/** 本次打开面板的时间：之前触发的告警，回落不会再被记录 */
const SESSION_START =
  typeof performance !== "undefined" && performance.timeOrigin
    ? performance.timeOrigin
    : Date.now();

export function buildIncidents(events: AlertEvent[]): Incident[] {
  const groups = new Map<string, AlertEvent[]>();
  for (const ev of events) {
    const key = ev.incidentId || ev.id;
    const list = groups.get(key);
    if (list) list.push(ev);
    else groups.set(key, [ev]);
  }

  const incidents: Incident[] = [];
  for (const [id, unsorted] of groups) {
    const list = [...unsorted].sort((a, b) => (a.at || 0) - (b.at || 0));
    const downs = list.filter((e) => e.state !== "up");
    const down = downs[0];
    const escalation =
      downs.find((e) => e.stage === "escalate") ||
      downs.slice(1).find((e) => !e.stage && e.level === "danger");
    const repeats = downs.filter((e) => e.stage === "repeat");
    const up = list.find((e) => e.state === "up");
    const level = maxLevel(downs);
    const first = down || up || list[0];
    const kind = first.kind || "";
    const startAt = down?.at || up?.at || 0;
    const endAt = up?.at || 0;
    let status: IncidentStatus;
    if (!hasRecovery(kind)) status = "notice";
    else if (up) status = "resolved";
    else status = "active";
    const channels = new Set<string>();
    for (const e of list) for (const c of e.channels || []) channels.add(c);
    incidents.push({
      id,
      host: first.host || "",
      kind,
      service: first.service || parseAppAlertKind(kind),
      down,
      escalation,
      repeats,
      up,
      level,
      status,
      startAt,
      endAt,
      lastAt: Math.max(...list.map((e) => e.at || 0)),
      unread: list.some((e) => !e.read),
      eventIds: list.map((e) => e.id).filter(Boolean),
      channels: [...channels],
    });
  }

  incidents.sort((a, b) => b.lastAt - a.lastAt);

  // 同主机同类型只有最新一条可能还在进行；更早的、或面板重启前触发的都等不到回落了
  const latestByKey = new Map<string, Incident>();
  for (const inc of incidents) {
    const key = `${inc.host}|${inc.kind}`;
    if (!latestByKey.has(key)) latestByKey.set(key, inc);
  }
  for (const inc of incidents) {
    if (inc.status !== "active") continue;
    const latest = latestByKey.get(`${inc.host}|${inc.kind}`);
    if (latest !== inc || inc.startAt < SESSION_START) inc.status = "unclosed";
  }
  return incidents;
}

function maxLevel(events: AlertEvent[]): AlertStartLevel | undefined {
  let out: AlertStartLevel | undefined;
  for (const e of events) {
    if (e.level === "danger") return "danger";
    if (e.level === "warn") out = "warn";
  }
  return out;
}

export function kindLabel(kind: string): string {
  const svc = parseAppAlertKind(kind);
  if (svc) return svc;
  switch (kind) {
    case "cpu":
      return "CPU";
    case "mem":
      return "内存";
    case "disk":
      return "磁盘";
    case "load":
      return "负载";
    case "net":
      return "网络";
    case "diskio":
      return "磁盘 IO";
    case "cert":
      return "证书";
    default:
      if (kind.startsWith("inspect:") || kind.startsWith("menu:")) return "巡检";
      return kind || "—";
  }
}

export function statusLabel(inc: Incident): string {
  const app = isAppKind(inc.kind);
  switch (inc.status) {
    case "active":
      return app ? "异常中" : "进行中";
    case "resolved":
      return app ? "已恢复" : "已回落";
    case "unclosed":
      return "未记录回落";
    default:
      if (inc.kind === "cert") return inc.up ? "已续期" : "到期提醒";
      return "异常";
  }
}

export function formatDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} 秒`;
  const m = Math.floor(s / 60);
  if (m < 60) {
    const rest = s % 60;
    return rest ? `${m} 分 ${rest} 秒` : `${m} 分钟`;
  }
  const h = Math.floor(m / 60);
  if (h < 48) {
    const rest = m % 60;
    return rest ? `${h} 小时 ${rest} 分` : `${h} 小时`;
  }
  return `${Math.floor(h / 24)} 天`;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export function formatClock(at: number, withSeconds = false): string {
  if (!at) return "—";
  const d = new Date(at);
  const base = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return withSeconds ? `${base}:${pad(d.getSeconds())}` : base;
}

export function formatDateTime(at: number): string {
  if (!at) return "—";
  const d = new Date(at);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${formatClock(at, true)}`;
}

const WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

function startOfDay(at: number): number {
  const d = new Date(at);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** 列表日期分组标题：今天 / 昨天 / 9月27日 周六 */
export function dayLabel(at: number, now = Date.now()): string {
  const diff = Math.round((startOfDay(now) - startOfDay(at)) / 86_400_000);
  if (diff === 0) return "今天";
  if (diff === 1) return "昨天";
  const d = new Date(at);
  const md = `${d.getMonth() + 1}月${d.getDate()}日 ${WEEKDAYS[d.getDay()]}`;
  return d.getFullYear() === new Date(now).getFullYear() ? md : `${d.getFullYear()}年${md}`;
}

export function dayKey(at: number): number {
  return startOfDay(at);
}

/** 从读数文字取占比，供 Meter 使用：CPU / 内存 = 百分比，负载 / 网络 / 磁盘 IO = 括号里的折算占比，磁盘 = 已用百分比；旧版磁盘读数无占比返回 undefined */
export function usagePercent(kind: string, text?: string): number | undefined {
  const v = (text || "").trim();
  if (!v) return undefined;
  if (kind === "cpu" || kind === "mem") {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : undefined;
  }
  const tail = v.match(/（([\d.]+)%）/);
  if ((kind === "load" || kind === "net" || kind === "diskio") && tail) return parseFloat(tail[1]);
  if (kind === "load") {
    const m = v.match(/^([\d.]+)\s*\/\s*(\d+)/);
    if (!m) return undefined;
    const load = parseFloat(m[1]);
    const cores = parseInt(m[2], 10);
    return cores > 0 ? (load / cores) * 100 : undefined;
  }
  if (kind === "disk") {
    const m = v.match(/已用\s*([\d.]+)%/);
    return m ? parseFloat(m[1]) : undefined;
  }
  return undefined;
}

/** 同主机同类型近 N 天的事件，及触发时段是否扎堆（同一小时占一半以上） */
export function recurrence(
  target: Incident,
  all: Incident[],
  days = 7,
  now = Date.now()
): { list: Incident[]; peakHour: number | null } {
  const since = now - days * 86_400_000;
  const list = all.filter(
    (inc) =>
      inc.host === target.host &&
      inc.kind === target.kind &&
      inc.startAt >= since
  );
  let peakHour: number | null = null;
  if (list.length >= 3) {
    const counts = new Array<number>(24).fill(0);
    for (const inc of list) counts[new Date(inc.startAt).getHours()] += 1;
    const max = Math.max(...counts);
    if (max * 2 >= list.length) peakHour = counts.indexOf(max);
  }
  return { list, peakHour };
}
