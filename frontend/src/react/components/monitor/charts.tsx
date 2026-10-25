import * as echarts from "echarts";
import type { PaletteMode } from "@/react/lib/color-palettes";
import { useEffect, useRef, type ReactNode } from "react";
import { bandTone, type UsageBands, type UsageTone } from "@/react/lib/usage-tone";
import { cn, readThemeColor, seriesColorList } from "@/react/lib/utils";
import { trendLineStyle, trendTooltip } from "@/react/lib/chart-style";

/** 分档面积锚定真实纵轴坐标，横向缩放后不能把新的可见峰值误涂成危险档。 */
function anchorUsageAreas(chart: echarts.EChartsType) {
  const current = chart.getOption() as {
    series?: echarts.LineSeriesOption[];
    visualMap?: { seriesIndex?: number }[];
  };
  const indices = new Set((current.visualMap || []).map(map => map.seriesIndex));
  if (!indices.size) return;
  const series = (current.series || []).map((item, index): echarts.LineSeriesOption => {
    if (!indices.has(index)) return {};
    const color = item.areaStyle?.color;
    if (!color || typeof color !== "object" || !("colorStops" in color)) return {};
    let peak = 0;
    for (const entry of item.data || []) {
      const value = entry && typeof entry === "object" && "value" in entry ? entry.value : entry;
      const y = Array.isArray(value) ? value[1] : value;
      if (typeof y === "number" && Number.isFinite(y)) peak = Math.max(peak, y);
    }
    if (!peak) return {};
    const axis = { yAxisIndex: item.yAxisIndex || 0 };
    const top = chart.convertToPixel(axis, peak);
    const bottom = chart.convertToPixel(axis, 0);
    if (typeof top !== "number" || typeof bottom !== "number" || !Number.isFinite(top) || !Number.isFinite(bottom)) return {};
    return { areaStyle: { color: new echarts.graphic.LinearGradient(0, top, 0, bottom, color.colorStops, true) } };
  });
  chart.setOption({ series }, { silent: true });
}

export function ChartHost({
  option,
  connectGroup,
  height,
  className,
}: {
  option: echarts.EChartsOption;
  connectGroup?: string;
  height?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const chartRef = useRef<echarts.EChartsType | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    const chart = echarts.init(ref.current);
    chartRef.current = chart;
    if (connectGroup) {
      chart.group = connectGroup;
      echarts.connect(connectGroup);
    }
    // 侧栏拖宽、窗口缩放都会改容器宽度，跟着容器而不是窗口
    const observer = new ResizeObserver(() => {
      chart.resize();
      anchorUsageAreas(chart);
    });
    observer.observe(ref.current);
    chart.on("datazoom", () => anchorUsageAreas(chart));
    return () => {
      observer.disconnect();
      chart.dispose();
      chartRef.current = null;
    };
  }, [connectGroup]);

  useEffect(() => {
    chartRef.current?.setOption(
      {
        animationDuration: 240,
        animationDurationUpdate: 0,
        animationEasing: "cubicOut",
        ...option,
      },
      { notMerge: true },
    );
    if (chartRef.current) anchorUsageAreas(chartRef.current);
  }, [option]);

  return <div ref={ref} style={height == null ? undefined : { height }} className={cn("h-full w-full min-h-0 min-w-0", className)} />;
}

/**
 * 1024 进制量（字节、KB/s）的整齐刻度：按最大值选单位，再取 1 / 2 / 5 × 10ⁿ 的步长，
 * 让刻度落在 200 MB、4 GB 这类整数上，而不是 190.73 MB。
 * minExp：数值本身的单位相对字节的幂次（字节传 0，KB/s 传 -1 以便小流量退到 B/s）。
 */
export function binaryAxis(values: number[], minExp: number): { max: number; interval: number } | null {
  let peak = 0;
  for (const v of values) {
    if (Number.isFinite(v) && v > peak) peak = v;
  }
  if (peak <= 0) return null;
  let exp = Math.floor(Math.log(peak) / Math.log(1024));
  if (exp < minExp) exp = minExp;
  const unit = Math.pow(1024, exp);
  const rough = peak / unit / 5;
  const magnitude = Math.pow(10, Math.floor(Math.log10(rough)));
  let step = 10 * magnitude;
  for (const candidate of [1, 2, 5]) {
    if (candidate * magnitude >= rough) {
      step = candidate * magnitude;
      break;
    }
  }
  const interval = step * unit;
  return { max: Math.ceil(peak / interval) * interval, interval };
}

export type LineSeries = {
  name: string;
  data: number[];
  /** 占用类指标按 §4.7 三档分段着色（--meter-ok / warn / danger），不传则按系列名取色 */
  bands?: UsageBands;
  /** 陪衬曲线（如交换）：muted 细虚线，不与分段色抢语义 */
  muted?: boolean;
};

/** 读数的档位：有分档时取值所在档，无分档返回 undefined */
export function readoutTone(value: number | undefined, bands: UsageBands | undefined): UsageTone | undefined {
  if (!bands || typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return bandTone(value, bands);
}

export type LineOptionOpts = {
  colorMode?: PaletteMode;
  yMax?: number;
  yInterval?: number;
  yFormatter?: (v: number) => string;
  /** 坐标轴刻度专用格式；不传时与 tooltip 共用 yFormatter */
  axisFormatter?: (v: number) => string;
};

export function lineOption(
  xData: string[],
  series: LineSeries[],
  opts?: LineOptionOpts,
): echarts.EChartsOption {
  const mode = opts?.colorMode;
  const axisFormatter = opts?.axisFormatter || opts?.yFormatter;
  const muted = readThemeColor("--color-muted", "rgba(0, 0, 0, 0.6)", mode);
  const line = readThemeColor("--color-line", "#e5e7eb", mode);
  const meterOk = readThemeColor("--meter-ok", "#2ba471", mode);
  const meterWarn = readThemeColor("--meter-warn", "#f08a24", mode);
  const meterDanger = readThemeColor("--meter-danger", "#d54941", mode);
  const colors = seriesColorList(series.map((s) => s.name), mode).map((c, idx) => {
    if (series[idx]?.muted) return muted;
    if (series[idx]?.bands) return meterOk;
    return c;
  });
  const visualMap: echarts.VisualMapComponentOption[] = [];
  series.forEach((s, idx) => {
    if (!s.bands) return;
    visualMap.push({
      type: "piecewise",
      show: false,
      seriesIndex: idx,
      dimension: 1,
      pieces: [
        { lt: s.bands.warn, color: meterOk },
        { gte: s.bands.warn, lt: s.bands.danger, color: meterWarn },
        { gte: s.bands.danger, color: meterDanger },
      ],
    });
  });
  return {
    textStyle: { fontFamily: readThemeColor("--app-font-family", readThemeColor("--font-sans", "sans-serif", mode)) },
    color: colors,
    visualMap: visualMap.length ? visualMap : undefined,
    grid: { left: 8, right: 16, top: 16, bottom: 8, containLabel: true },
    // 扁平浮层：surface 底 + 1px line 描边，无阴影（docs/design/specification.md §8.1）
    tooltip: {
      ...trendTooltip(mode),
      valueFormatter: (v) => {
        const n = typeof v === "number" ? v : Number(v);
        if (!Number.isFinite(n)) return String(v ?? "");
        if (opts?.yFormatter) return opts.yFormatter(n);
        return n.toFixed(2);
      },
    },
    // 图例由面板标题行的读数承担，图内不再画
    legend: { show: false },
    // 滚轮缩放、拖动平移（与 Vue VChartLine zoomable 一致）
    dataZoom: [
      {
        type: "inside",
        xAxisIndex: 0,
        zoomOnMouseWheel: true,
        moveOnMouseWheel: false,
        moveOnMouseMove: true,
      },
    ],
    xAxis: {
      type: "category",
      data: xData,
      boundaryGap: false,
      axisTick: { show: false },
      axisLabel: { fontSize: 12, color: muted, hideOverlap: true, margin: 8, alignMinLabel: "left", alignMaxLabel: "right" },
      axisLine: { lineStyle: { color: line } },
    },
    yAxis: {
      type: "value",
      min: 0,
      splitNumber: 5,
      max: opts?.yMax,
      interval: opts?.yInterval,
      axisLabel: {
        fontSize: 12,
        color: muted,
        formatter: axisFormatter ? (v: number) => axisFormatter(v) : undefined,
      },
      splitLine: { lineStyle: { color: line } },
    },
    series: series.map((s, idx) => ({
      ...trendLineStyle({ mode, color: colors[idx]!, values: s.data, bands: s.bands, muted: s.muted }),
      name: s.name,
      data: s.data,
    })),
  };
}

/** 流量方向说明，网络页表头 / 流量格与监控面板读数共用一份文案 */
export const RX_TIP =
  "流入：从外面进到这台机器的数据。比如用户访问时发来的请求、nginx 从后端服务拿回来的内容";
export const TX_TIP =
  "流出：从这台机器发出去的数据。比如把网页、接口结果返回给用户；云服务器按流量收费，一般收的就是流出";

export type MonitorReadout = {
  label: string;
  value: string;
  /** 与曲线同色的短横线，兼作图例；ok / warn / danger 对应分段曲线当前档 */
  swatch?: "read" | "write" | "muted" | UsageTone;
  /** 标签悬停说明（流入 / 流出的方向解释等） */
  tip?: string;
  /** 数值档位：危险档数值走 danger 文字色，与圆环中心一致；ok / warn 不改文字色 */
  tone?: UsageTone;
};

function ReadoutSwatch({ swatch }: { swatch: NonNullable<MonitorReadout["swatch"]> }) {
  if (swatch === "read") return <span className="h-0.5 w-3 self-center bg-io-read" aria-hidden />;
  if (swatch === "write") return <span className="h-0.5 w-3 self-center bg-io-write" aria-hidden />;
  if (swatch === "muted") {
    return <span className="w-3 self-center border-t border-dashed border-muted" aria-hidden />;
  }
  return (
    <span
      className="h-0.5 w-3 self-center"
      style={{ backgroundColor: `var(--meter-${swatch})` }}
      aria-hidden
    />
  );
}

/** 监控面板单元：标题行即图例 + 读数，下方固定高度曲线 */
export function MonitorPanel({
  title,
  readouts,
  note,
  className = "",
  grow = false,
  children,
}: {
  title: string;
  readouts: MonitorReadout[];
  note?: string;
  className?: string;
  /** 曲线区撑满单元剩余高度（至少 200px），用于最后一行填满页面 */
  grow?: boolean;
  children: ReactNode;
}) {
  let chartClass = "h-[200px]";
  if (grow) chartClass = "min-h-[200px] flex-1";
  return (
    <section className={cn("flex min-w-0 flex-col bg-surface px-4 pb-2 pt-3", className)}>
      <div className="flex min-h-8 flex-wrap items-baseline gap-x-6 gap-y-1">
        <span className="text-sm font-semibold text-ink">{title}</span>
        {readouts.map((item) => (
          <span key={item.label} className="inline-flex items-baseline gap-2">
            {item.swatch ? <ReadoutSwatch swatch={item.swatch} /> : null}
            <span
              data-tip={item.tip}
              className={cn(
                "text-xs text-muted",
                item.tip && "cursor-help underline decoration-dotted underline-offset-4",
              )}
            >
              {item.label}
            </span>
            <span
              className={cn(
                "font-mono text-xl font-semibold tabular-nums",
                item.tone === "danger" ? "text-danger" : "text-ink",
              )}
            >
              {item.value}
            </span>
          </span>
        ))}
        {note ? <span className="ml-auto text-xs text-muted">{note}</span> : null}
      </div>
      <div className={chartClass}>{children}</div>
    </section>
  );
}
