export type TrendMetric = "cpu" | "memory" | "load";
type TrendPoint = [number, number | null];
export type OverviewTrendSeries = Record<TrendMetric, TrendPoint[]>;
export type OverviewHistorySample = { ts: number; cpuPercent?: number; memUsed?: number; load1?: number };

function nonNegative(value: number | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

/** 保留真实采样时间，缺测断线，内存总量未知时不把字节伪装为百分比。 */
export function overviewTrendSeries(samples: OverviewHistorySample[], memTotal?: number): OverviewTrendSeries {
  const byTime = new Map<number, OverviewHistorySample>();
  for (const sample of samples) {
    if (Number.isFinite(sample.ts) && sample.ts > 0) byTime.set(sample.ts, sample);
  }
  const points = [...byTime.values()].sort((a, b) => a.ts - b.ts);
  const intervals = points.slice(1).map((p, i) => p.ts - points[i].ts).sort((a, b) => a - b);
  const cadence = intervals[Math.floor(intervals.length / 2)] || 5;
  const gapLimit = Math.max(30, cadence * 3);
  const isTotalKnown = typeof memTotal === "number" && Number.isFinite(memTotal) && memTotal > 0;
  const series: OverviewTrendSeries = { cpu: [], memory: [], load: [] };
  points.forEach((point, index) => {
    const previous = points[index - 1];
    if (previous && point.ts - previous.ts > gapLimit) {
      for (const values of Object.values(series)) values.push([(previous.ts + cadence) * 1000, null]);
    }
    const cpu = nonNegative(point.cpuPercent);
    const used = nonNegative(point.memUsed);
    const memory = isTotalKnown && used !== null ? used / memTotal * 100 : null;
    series.cpu.push([point.ts * 1000, cpu !== null && cpu <= 100 ? cpu : null]);
    series.memory.push([point.ts * 1000, memory !== null && memory <= 100 ? memory : null]);
    series.load.push([point.ts * 1000, nonNegative(point.load1)]);
  });
  return series;
}

