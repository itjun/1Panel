import type { appsession } from "@/api";

export type RunLogRange = "7d" | "30d" | "all";
export type RunLogStatus = "running" | "normal" | "abnormal";

export type RunLogEntry = {
  id: string;
  startAt: number;
  /** 运行中为 0 */
  endAt: number;
  /** 运行中按 now 计算 */
  durationMs: number;
  status: RunLogStatus;
  version: string;
};

export type RunLogSummary = {
  launches: number;
  totalMs: number;
  avgMs: number;
  maxMs: number;
  abnormal: number;
};

export type RunLogDay = {
  day: number;
  launches: number;
  totalMs: number;
};

function startOfDay(at: number): number {
  const d = new Date(at);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function nextDay(dayStart: number): number {
  const d = new Date(dayStart);
  d.setDate(d.getDate() + 1);
  return d.getTime();
}

export function toEntries(sessions: appsession.Session[], now: number): RunLogEntry[] {
  return sessions.map((s) => {
    const running = !s.endAt;
    let status: RunLogStatus = "running";
    if (!running) status = s.endReason === "abnormal" ? "abnormal" : "normal";
    const end = running ? now : s.endAt;
    return {
      id: s.id,
      startAt: s.startAt,
      endAt: running ? 0 : s.endAt,
      durationMs: Math.max(0, end - s.startAt),
      status,
      version: s.version || "",
    };
  });
}

/** 范围起点：近 N 天含今天，按自然日对齐；全部返回 0 */
export function rangeStart(range: RunLogRange, now: number): number {
  if (range === "all") return 0;
  const days = range === "7d" ? 7 : 30;
  const d = new Date(startOfDay(now));
  d.setDate(d.getDate() - (days - 1));
  return d.getTime();
}

/** 启动时间落在范围内的会话 */
export function filterByRange(entries: RunLogEntry[], from: number): RunLogEntry[] {
  return entries.filter((e) => e.startAt >= from);
}

export function summarize(entries: RunLogEntry[]): RunLogSummary {
  let totalMs = 0;
  let maxMs = 0;
  let abnormal = 0;
  for (const e of entries) {
    totalMs += e.durationMs;
    if (e.durationMs > maxMs) maxMs = e.durationMs;
    if (e.status === "abnormal") abnormal += 1;
  }
  return {
    launches: entries.length,
    totalMs,
    avgMs: entries.length ? totalMs / entries.length : 0,
    maxMs,
    abnormal,
  };
}

/** 按自然日汇总（新→旧）：启动次数计在启动当天，在线时长跨天按日拆分 */
export function dailyBreakdown(entries: RunLogEntry[], from: number): RunLogDay[] {
  const map = new Map<number, RunLogDay>();
  const get = (day: number) => {
    let row = map.get(day);
    if (!row) {
      row = { day, launches: 0, totalMs: 0 };
      map.set(day, row);
    }
    return row;
  };
  for (const e of entries) {
    get(startOfDay(e.startAt)).launches += 1;
    const end = e.startAt + e.durationMs;
    let cursor = e.startAt;
    while (cursor < end) {
      const day = startOfDay(cursor);
      const sliceEnd = Math.min(end, nextDay(day));
      if (day >= from) get(day).totalMs += sliceEnd - cursor;
      cursor = sliceEnd;
    }
  }
  return [...map.values()].sort((a, b) => b.day - a.day);
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** 2小时13分05秒 / 13分05秒 / 5秒；超过 24 小时继续累加小时 */
export function formatSpan(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}小时${pad(m)}分${pad(s)}秒`;
  if (m > 0) return `${m}分${pad(s)}秒`;
  return `${s}秒`;
}

export function formatDayLabel(day: number, now: number): string {
  const d = new Date(day);
  const base = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const today = startOfDay(now);
  if (day === today) return `${base}（今天）`;
  if (nextDay(day) === today) return `${base}（昨天）`;
  return base;
}
