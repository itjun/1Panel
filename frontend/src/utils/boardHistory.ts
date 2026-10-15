import type { agentcli } from "../api";

export type BoardHistoryPoint = { at: number; cpu: number | null; memUsed: number | null };
export type BoardHistory = {
  points: BoardHistoryPoint[];
  from: number;
  to: number;
  loading: boolean;
  updatedAt?: number;
  error?: string;
};
export type BoardChartPoint = [number, number | null];

function nonNegative(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

/** 保留真实采样时间与峰值；缺测不能变成零，也不能按索引重造时间轴。 */
export function normalizeBoardHistory(points: agentcli.RangeResponse["points"], from: number, to: number): BoardHistoryPoint[] {
  const byTime = new Map<number, BoardHistoryPoint>();
  for (const point of points || []) {
    const at = point.ts * 1000;
    if (!Number.isFinite(at) || at < from || at > to) continue;
    const cpu = nonNegative(point.cpuPercent);
    byTime.set(at, { at, cpu: cpu !== null && cpu <= 100 ? cpu : null, memUsed: nonNegative(point.memUsed) });
  }
  return [...byTime.values()].sort((a, b) => a.at - b.at);
}

/** 历史先返回时，overview 到达后直接按内存总量换算，无需重发历史请求。 */
export function boardHistorySeries(points: BoardHistoryPoint[], memTotal?: number) {
  const cpu: BoardChartPoint[] = [];
  const mem: BoardChartPoint[] = [];
  const intervals = points.slice(1).map((p, i) => p.at - points[i].at).sort((a, b) => a - b);
  const cadence = intervals[Math.floor(intervals.length / 2)] || 5000;
  const gapLimit = Math.max(30_000, cadence * 3);
  const hasTotal = typeof memTotal === "number" && Number.isFinite(memTotal) && memTotal > 0;
  for (let i = 0; i < points.length; i++) {
    const point = points[i];
    const previous = points[i - 1];
    if (previous && point.at - previous.at > gapLimit) {
      // 断开离线区间，避免把没有采样的时间画成平稳运行。
      cpu.push([previous.at + cadence, null]);
      mem.push([previous.at + cadence, null]);
    }
    cpu.push([point.at, point.cpu]);
    const percent = hasTotal && point.memUsed !== null ? point.memUsed / memTotal * 100 : null;
    mem.push([point.at, percent !== null && percent <= 100 ? percent : null]);
  }
  return { cpu, mem };
}
