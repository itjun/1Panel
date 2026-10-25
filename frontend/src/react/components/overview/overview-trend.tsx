import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import type { EChartsOption } from "echarts";
import { api } from "@/api";
import { ChartHost, lineOption } from "@/react/components/monitor/charts";
import { RadioGroup } from "@/react/components/ui/radio-group";
import { chartPalette, trendLineStyle, trendTooltip } from "@/react/lib/chart-style";
import { useThemeSignature } from "@/react/lib/use-theme-mode";
import { usageBands } from "@/react/lib/usage-tone";
import { readThemeColor } from "@/react/lib/utils";
import { collectionState } from "@/utils/collectionState";
import { formatErr } from "@/utils/format";
import { overviewTrendSeries, type OverviewTrendSeries, type TrendMetric } from "./overview-trend-model";

const METRICS = [
  { value: "cpu" as const, label: "CPU" },
  { value: "memory" as const, label: "内存" },
  { value: "load" as const, label: "负载" },
];

function timeLabel(at: number) {
  return new Date(at).toLocaleTimeString("zh-CN", { hour12: false, hour: "2-digit", minute: "2-digit" });
}

export function OverviewTrend({ title, series, from, to, cpuCount, isLoading, error, isUnavailable }: {
  title: string;
  series: OverviewTrendSeries;
  from: number;
  to: number;
  cpuCount?: number;
  isLoading?: boolean;
  error?: string;
  isUnavailable?: boolean;
}) {
  const [metric, setMetric] = useState<TrendMetric>("cpu");
  const theme = useThemeSignature();
  const points = series[metric];
  const values = points.flatMap(point => point[1] === null ? [] : [point[1]]);
  const label = METRICS.find(item => item.value === metric)!.label;
  const valueText = (value: number) => metric === "load" ? value.toFixed(2) : `${value.toFixed(1)}%`;
  const peak = values.length ? Math.max(...values) : 0;
  const mean = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
  const option = useMemo((): EChartsOption => {
    const colors = chartPalette();
    const bands = usageBands(metric === "load" ? cpuCount : 100);
    const base = lineOption([], [{ name: label, data: [], bands }]);
    return {
      ...base,
      animation: false,
      dataZoom: [],
      grid: { left: 8, right: 16, top: 16, bottom: 8, containLabel: true },
      tooltip: {
        ...trendTooltip(), trigger: "axis", confine: true, renderMode: "richText",
        backgroundColor: colors.surface, borderColor: colors.line, borderWidth: 0.5, shadowBlur: 0,
        axisPointer: { type: "line", lineStyle: { color: colors.muted, type: "dashed", width: 0.5 } },
        textStyle: { color: colors.ink, fontSize: 12 },
        formatter: (params) => {
          const entry = Array.isArray(params) ? params[0] : params;
          const value = Array.isArray(entry?.value) ? entry.value : [];
          return `${timeLabel(Number(value[0]))}\n${label} ${typeof value[1] === "number" ? (metric === "load" ? value[1].toFixed(2) : `${value[1].toFixed(1)}%`) : "缺少采样"}`;
        },
      },
      xAxis: {
        type: "time", min: from, max: Math.max(from + 1000, to), splitNumber: 3,
        axisTick: { show: false }, axisLine: { lineStyle: { color: colors.line, width: 0.5 } },
        axisLabel: { color: colors.muted, fontSize: 12, hideOverlap: true, alignMinLabel: "left", alignMaxLabel: "right", formatter: timeLabel },
      },
      yAxis: {
        type: "value", min: 0, splitNumber: 3,
        axisLabel: { color: colors.muted, fontSize: 12, formatter: (v: number) => metric === "load" ? String(v) : `${v}%` },
        splitLine: { lineStyle: { color: colors.line, type: "dashed", width: 0.5 } },
      },
      series: [{ ...trendLineStyle({ color: bands ? colors.ok : readThemeColor("--color-chart-1", ""), values: points.map(point => point[1]), bands }), itemStyle: { borderColor: colors.surface, borderWidth: 0.5 }, name: label, data: points }],
    };
  }, [metric, label, points, from, to, cpuCount, theme]);
  return (
    <section className="device-overview-trend" aria-label={title}>
      <div className="device-overview-section-heading">
        <h2>{title}</h2>
        <div className="device-overview-trend-controls">
          <RadioGroup value={metric} onChange={setMetric} options={METRICS} aria-label="概览趋势指标" />
        </div>
      </div>
      {error && values.length ? <p className="device-overview-trend-error" role="status" title={error}>历史更新失败</p> : null}
      <div className="device-overview-trend-plot" role="img" aria-label={`${label}趋势，${values.length ? "悬停查看采样" : isLoading ? "正在读取" : "暂无采样"}`}>
        {values.length ? <ChartHost option={option} /> : <div className="device-overview-trend-empty" role="status" title={error}>{isLoading ? "读取中…" : error ? "历史不可用，请刷新重试" : "暂无采样"}</div>}
      </div>
      {values.length ? <p className="device-overview-trend-note"><span>峰值 {valueText(peak)}</span><span>平均 {valueText(mean)}</span>{isUnavailable ? <span>采集中断</span> : null}</p> : null}
    </section>
  );
}

export function HostOverviewTrend({ host, memTotal, cpuCount, isAvailable }: {
  host: string; memTotal?: number; cpuCount?: number; isAvailable: boolean;
}) {
  const history = useQuery({
    queryKey: ["overview-history", host],
    queryFn: async () => {
      const to = Math.floor(Date.now() / 1000);
      const from = to - 30 * 60;
      return { ...await api.agentRange(host, from, to, "auto"), from: from * 1000, to: to * 1000 };
    },
    enabled: isAvailable,
    refetchInterval: 30000,
    staleTime: 15000,
    retry: 1,
  });
  const series = useMemo(() => overviewTrendSeries(history.data?.points || [], memTotal), [history.data, memTotal]);
  const state = collectionState(history);
  return <OverviewTrend title="最近 30 分钟" series={series} from={history.data?.from || 0} to={history.data?.to || 0}
    cpuCount={cpuCount} isLoading={history.isFetching && !history.data}
    error={state.unavailable ? formatErr(history.error || history.failureReason) : undefined}
    isUnavailable={!isAvailable} />;
}
