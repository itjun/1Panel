/** 资源占用三档阈值（DESIGN.md §4.7）：<60 ok，60–85 warn，≥85 danger。圆环、Meter、监控曲线共用 */
export const USAGE_WARN = 60;
export const USAGE_DANGER = 85;

export type UsageTone = "ok" | "warn" | "danger";

/** 分档边界，单位与曲线数值一致（百分比、负载、字节） */
export type UsageBands = { warn: number; danger: number };

export function usageTone(pct: number): UsageTone {
  if (pct >= USAGE_DANGER) return "danger";
  if (pct >= USAGE_WARN) return "warn";
  return "ok";
}

/** 按「满格」total 换算分档边界：CPU 传 100，负载传核数，内存传总字节；total 无效时不分档 */
export function usageBands(total: number | undefined): UsageBands | undefined {
  if (typeof total !== "number" || !Number.isFinite(total) || total <= 0) return undefined;
  return {
    warn: (total * USAGE_WARN) / 100,
    danger: (total * USAGE_DANGER) / 100,
  };
}

export function bandTone(value: number, bands: UsageBands): UsageTone {
  if (value >= bands.danger) return "danger";
  if (value >= bands.warn) return "warn";
  return "ok";
}
