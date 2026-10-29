import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import type { EChartsOption } from "echarts";
import { api, type monitor } from "@/api";
import { ChartHost, lineOption } from "@/react/components/monitor/charts";
import { Button } from "@/react/components/ui/button";
import { Select } from "@/react/components/ui/select";
import { DateRangePicker } from "@/react/components/ui/date-range-picker";
import { useThemeSignature } from "@/react/lib/use-theme-mode";
import { trendLineStyle, trendTooltip } from "@/react/lib/chart-style";
import { readThemeColor } from "@/react/lib/utils";
import { USAGE_DANGER, usageBands } from "@/react/lib/usage-tone";
import {
  boardHistorySeries,
  normalizeBoardHistory,
  type BoardChartPoint,
} from "@/utils/boardHistory";
import { collectionState } from "@/utils/collectionState";
import { formatErr } from "@/utils/format";
import type { TrendMetric, TrendRange } from "./state";

export const timeText = (at: number) =>
  new Date(at).toLocaleTimeString("zh-CN", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
  });
const dateInput = (at: number) => {
  const d = new Date(at);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}T${timeText(at)}`;
};
export function RangeControls({
  value,
  onChange,
  from,
  to,
}: {
  value: TrendRange;
  onChange: (value: TrendRange) => void;
  from: number;
  to: number;
}) {
  return (
    <div className="workbench-range">
      <Select
        aria-label="趋势时间范围"
        value={value.custom ? "custom" : String(value.minutes)}
        options={[
          { value: "30", label: "近 30 分钟" },
          { value: "60", label: "近 1 小时" },
          { value: "360", label: "近 6 小时" },
          { value: "custom", label: "自定义时间" },
        ]}
        onChange={(v) =>
          onChange(
            v === "custom"
              ? {
                  minutes: value.minutes,
                  custom: [dateInput(from), dateInput(to)],
                }
              : { minutes: Number(v) },
          )
        }
      />
      {value.custom ? (
        <DateRangePicker
          value={value.custom}
          onChange={(custom) => onChange({ ...value, custom })}
        />
      ) : (
        <span className="text-xs text-muted">
          {new Date(from).toLocaleDateString("zh-CN")} {timeText(from)} —{" "}
          {timeText(to)}
        </span>
      )}
    </div>
  );
}
function chartOption(
  data: BoardChartPoint[],
  label: string,
  from: number,
  to: number,
): EChartsOption {
  const color = (name: string) => readThemeColor(name, "");
  return {
    ...lineOption([], [{ name: label, data: [], bands: usageBands(100) }]),
    animation: false,
    dataZoom: [],
    grid: { left: 42, right: 20, top: 20, bottom: 30 },
    tooltip: {
      ...trendTooltip(),
      trigger: "axis",
      confine: true,
      renderMode: "richText",
      backgroundColor: color("--color-surface"),
      borderColor: color("--color-line"),
      shadowBlur: 0,
      textStyle: { color: color("--color-ink"), fontSize: 12 },
      formatter: (params) => {
        const p = Array.isArray(params) ? params[0] : params;
        const v = Array.isArray(p?.value) ? p.value : [];
        return `${timeText(Number(v[0]))}\n${label} ${typeof v[1] === "number" ? v[1].toFixed(1) + "%" : "缺少采样"}`;
      },
    },
    xAxis: {
      type: "time",
      min: from,
      max: to,
      splitNumber: 3,
      axisLabel: {
        color: color("--color-muted"),
        fontSize: 12,
        hideOverlap: true,
        alignMinLabel: "left",
        alignMaxLabel: "right",
        formatter: (v: number) => timeText(v),
      },
      axisLine: { lineStyle: { color: color("--color-line") } },
      axisTick: { show: false },
    },
    yAxis: {
      min: 0,
      max: 100,
      interval: 50,
      axisLabel: {
        color: color("--color-muted"),
        fontSize: 12,
        formatter: "{value}%",
      },
      splitLine: {
        lineStyle: { color: color("--color-line"), type: "dashed" },
      },
    },
    series: [
      {
        ...trendLineStyle({ color: color("--meter-ok"), values: data.map(p => p[1]), bands: usageBands(100) }),
        name: label,
        data,
        connectNulls: false,
        markLine: data.some((p) => p[1] !== null && p[1] >= USAGE_DANGER)
          ? {
              silent: true,
              symbol: "none",
              label: {
                formatter: `${USAGE_DANGER}%`,
                position: "insideStartTop",
                color: color("--color-danger"),
              },
              lineStyle: { color: color("--color-danger"), type: "dashed" },
              data: [{ yAxis: USAGE_DANGER }],
            }
          : undefined,
      },
    ],
  };
}
export function ResourceTrends({
  host,
  overview,
  from,
  to,
  primary,
  currentAvailable = true,
  onOpen,
}: {
  host: string;
  overview?: monitor.Overview | null;
  from: number;
  to: number;
  primary?: TrendMetric;
  currentAvailable?: boolean;
  onOpen?: (metric: TrendMetric) => void;
}) {
  const theme = useThemeSignature();
  const history = useQuery({
    queryKey: ["workbench-history", host, from, to],
    queryFn: () =>
      api.agentRange(
        host,
        Math.floor(from / 1000),
        Math.floor(to / 1000),
        "auto",
      ),
    enabled: Number.isFinite(from) && Number.isFinite(to) && from < to,
    staleTime: 15000,
    gcTime: 60000,
    retry: 1,
    placeholderData: (previous, query) =>
      query?.queryKey[1] === host &&
      Number(query.queryKey[3]) - Number(query.queryKey[2]) === to - from
        ? previous
        : undefined,
  });
  const series = useMemo(
    () =>
      boardHistorySeries(
        normalizeBoardHistory(history.data?.points || [], from, to),
        overview?.memTotal,
      ),
    [history.data, from, to, overview?.memTotal],
  );
  const options = useMemo(
    () => ({
      cpu: chartOption(series.cpu, "CPU", from, to),
      mem: chartOption(series.mem, "内存", from, to),
    }),
    [series, from, to, theme],
  );
  const metrics: TrendMetric[] = ["cpu", "mem"];
  const hasHistory = metrics.some(metric => series[metric].some(p => p[1] !== null));
  const historyState = collectionState(history);
  return (
    <div className={`resource-trends${onOpen ? " is-group" : ""}${!hasHistory ? " is-empty" : ""}`}>
      {historyState.unavailable || !hasHistory ? (
        <div className="resource-trends__notice" role="status">
          <span title={history.error ? formatErr(history.error) : undefined}>
            {historyState.unavailable ? hasHistory ? "历史数据更新失败，保留上次曲线" : "历史数据暂不可用" : history.isPending ? "正在读取历史采样…" : "所选时段暂无采样"}
          </span>
          {historyState.unavailable && <Button size="sm" variant="ghost" disabled={history.isFetching} onClick={() => void history.refetch()}>{history.isFetching ? "重试中" : "重试"}</Button>}
        </div>
      ) : null}
      {metrics.map((metric) => {
        const label = metric === "cpu" ? "CPU" : "内存";
        const value = !currentAvailable
          ? undefined
          : metric === "cpu"
            ? overview?.cpuPercent
            : overview?.memPercent;
        return (
          <section key={metric} aria-label={`${host} ${label}趋势`} className={primary === metric ? "is-focused" : undefined}>
            <div className="resource-trends__label">
              <span>{label}</span>
              {primary === metric && <span className="resource-trends__focus" title="从分组曲线进入时选中的指标">来自分组选择</span>}
              {onOpen && (
                <strong>{value == null ? "—" : `${value.toFixed(1)}%`}</strong>
              )}
            </div>
            <div
              className="resource-trends__plot"
              role={onOpen ? "button" : "img"}
              aria-label={`${host} ${label}曲线`}
              tabIndex={onOpen ? 0 : undefined}
              onClick={() => onOpen?.(metric)}
              onKeyDown={(e) => {
                if (onOpen && ["Enter", " "].includes(e.key)) {
                  e.preventDefault();
                  onOpen(metric);
                }
              }}
            >
              {series[metric].some((p) => p[1] !== null) ? (
                <ChartHost option={options[metric]} />
              ) : (
                <div className="resource-trends__empty">
                  {hasHistory ? metric === "mem" && !overview?.memTotal ? "缺少内存容量，无法换算占比" : "该指标暂无采样" : null}
                </div>
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}
