import * as echarts from "echarts";
import { paletteTokens, type ColorTokens, type PaletteMode } from "./color-palettes";
import { readThemeSignature } from "./use-theme-mode";
import { bandTone, type UsageBands } from "./usage-tone";
import { readThemeColor } from "./utils";

export type TrendDirection = "read" | "write";
export const TREND_DOT = [2, 4]; // 应用事件的竖向参考线。

/** DESGIN.md：所有趋势图共用的笔触、面积填充与浮层。每次构建 option 时重读主题。 */
export function chartPalette(mode?: PaletteMode) {
  const fallback = paletteTokens(mode ?? readThemeSignature());
  const color = (name: keyof ColorTokens) => readThemeColor(name, fallback[name], mode);
  return {
    surface: color("--color-surface"),
    raised: color("--color-raised"),
    ink: color("--color-ink"),
    muted: color("--color-muted"),
    line: color("--color-line"),
    pointer: color("--color-line-strong"),
    primary: color("--color-chart-1"),
    read: color("--color-io-read"),
    write: color("--color-io-write"),
    comparison: color("--color-chart-comparison"),
    gc: color("--color-chart-gc"),
    ok: color("--meter-ok"),
    warn: color("--meter-warn"),
    danger: color("--meter-danger"),
  };
}

/** 渐变相对曲线实际面积；阈值位置按真实数值换算，不改变数据和纵轴。 */
export function trendArea(color: string, peak = 0, bands?: UsageBands, mode?: PaletteMode) {
  const palette = chartPalette(mode);
  const peakOpacity = 0.28;
  const alpha = (value: string, opacity: number) => echarts.color.modifyAlpha(value, opacity);
  const toneColor = (value: number) => bands ? palette[bandTone(value, bands)] : color;
  const stops = [{ offset: 0, color: alpha(toneColor(peak), peakOpacity) }];
  if (bands && peak > 0) {
    for (const threshold of [bands.danger, bands.warn]) {
      if (threshold > peak) continue;
      const offset = 1 - threshold / peak;
      const opacity = peakOpacity * (1 - offset);
      // 同一位置两端的色阶明确表达档位，避免把告警稀释成另一种颜色。
      stops.push({ offset, color: alpha(toneColor(threshold), opacity) });
      stops.push({ offset, color: alpha(threshold === bands.danger ? palette.warn : palette.ok, opacity) });
    }
  }
  stops.push({ offset: 1, color: alpha(color, 0) });
  return { opacity: 1, color: new echarts.graphic.LinearGradient(0, 0, 0, 1, stops) };
}

export function trendLineStyle({ color, values, bands, muted = false, fill = true, detail = false, mode }: {
  color: string;
  values: readonly (number | null)[];
  bands?: UsageBands;
  muted?: boolean;
  fill?: boolean;
  detail?: boolean;
  mode?: PaletteMode;
}): echarts.LineSeriesOption {
  let peak = 0;
  let count = 0;
  for (const value of values) {
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    count++;
    peak = Math.max(peak, value);
  }
  const thin = muted || detail;
  const width = thin ? 1.25 : 2.4;
  const opacity = detail ? ((mode ?? readThemeSignature()) === "dark" ? 0.58 : 0.72) : 1;
  return {
    type: "line",
    smooth: 0.15,
    smoothMonotone: "x",
    connectNulls: false,
    showSymbol: count === 1 || (!thin && values.length <= 48),
    showAllSymbol: false,
    symbol: "circle",
    symbolSize: count === 1 ? 6 : 3,
    itemStyle: { borderColor: chartPalette(mode).surface, borderWidth: 1 },
    lineStyle: { width, type: "solid", opacity, cap: "round", join: "round" },
    areaStyle: fill && !thin ? trendArea(color, peak, bands, mode) : undefined,
    emphasis: { scale: 1.8, lineStyle: { width, opacity: 1 } },
  };
}

export function trendTooltip(mode?: PaletteMode): echarts.TooltipComponentOption {
  const palette = chartPalette(mode);
  return {
    trigger: "axis",
    confine: true,
    backgroundColor: palette.surface,
    borderColor: palette.line,
    borderWidth: 1,
    shadowBlur: 0,
    shadowColor: "transparent",
    shadowOffsetX: 0,
    shadowOffsetY: 0,
    padding: [8, 12],
    textStyle: { fontSize: 12, color: palette.ink },
    extraCssText: "box-shadow: none; border-radius: 6px; font-variant-numeric: tabular-nums;",
    axisPointer: { type: "line", lineStyle: { color: palette.pointer, type: "dashed", width: 1 } },
  };
}
