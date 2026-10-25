import * as echarts from "echarts";
import type { PaletteMode } from "./color-palettes";
import { bandTone, type UsageBands } from "./usage-tone";
import { readThemeColor } from "./utils";

/** DESGIN.md：所有趋势图共用的笔触、面积填充与浮层。每次构建 option 时重读主题。 */
export function chartPalette(mode?: PaletteMode) {
  return {
    surface: readThemeColor("--color-surface", "#ffffff", mode),
    ink: readThemeColor("--color-ink", "#1f2937", mode),
    muted: readThemeColor("--color-muted", "#636a76", mode),
    line: readThemeColor("--color-line", "#e5e7eb", mode),
    pointer: readThemeColor("--color-line-strong", "#9ca3af", mode),
    ok: readThemeColor("--meter-ok", "#2ba471", mode),
    warn: readThemeColor("--meter-warn", "#f08a24", mode),
    danger: readThemeColor("--meter-danger", "#d54941", mode),
  };
}

/** 渐变相对曲线实际面积；阈值位置按真实数值换算，不改变数据和纵轴。 */
export function trendArea(color: string, peak = 0, bands?: UsageBands, mode?: PaletteMode) {
  const palette = chartPalette(mode);
  const alpha = (value: string, opacity: number) => echarts.color.modifyAlpha(value, opacity);
  const toneColor = (value: number) => bands ? palette[bandTone(value, bands)] : color;
  const stops = [{ offset: 0, color: alpha(toneColor(peak), 0.28) }];
  if (bands && peak > 0) {
    for (const threshold of [bands.danger, bands.warn]) {
      if (threshold > peak) continue;
      const offset = 1 - threshold / peak;
      const opacity = 0.28 * (1 - offset);
      // 同一位置两端的色阶明确表达档位，避免把告警稀释成另一种颜色。
      stops.push({ offset, color: alpha(toneColor(threshold), opacity) });
      stops.push({ offset, color: alpha(threshold === bands.danger ? palette.warn : palette.ok, opacity) });
    }
  }
  stops.push({ offset: 1, color: alpha(color, 0) });
  return { opacity: 1, color: new echarts.graphic.LinearGradient(0, 0, 0, 1, stops) };
}

export function trendLineStyle({ color, values, bands, muted = false, fill = true, mode }: {
  color: string;
  values: readonly (number | null)[];
  bands?: UsageBands;
  muted?: boolean;
  fill?: boolean;
  mode?: PaletteMode;
}): echarts.LineSeriesOption {
  let peak = 0;
  let count = 0;
  for (const value of values) {
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    count++;
    peak = Math.max(peak, value);
  }
  return {
    type: "line",
    smooth: 0.15,
    smoothMonotone: "x",
    connectNulls: false,
    showSymbol: count === 1 || (!muted && values.length <= 48),
    showAllSymbol: false,
    symbol: "circle",
    symbolSize: count === 1 ? 6 : 3,
    itemStyle: { borderColor: chartPalette(mode).surface, borderWidth: 1 },
    lineStyle: { width: muted ? 1.25 : 2.25, type: muted ? "dashed" : "solid", cap: "round", join: "round" },
    areaStyle: fill && !muted ? trendArea(color, peak, bands, mode) : undefined,
    emphasis: { scale: 1.8, lineStyle: { width: muted ? 1.25 : 2.25 } },
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
