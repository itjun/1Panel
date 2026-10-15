import { memo, useEffect, useMemo, useRef, useState } from "react";
import type { EChartsOption } from "echarts";
import { ChartHost, lineOption } from "@/react/components/monitor/charts";
import { Button } from "@/react/components/ui/button";
import { readThemeColor } from "@/react/lib/utils";
import { usageBands, usageTone } from "@/react/lib/usage-tone";
import { boardHistorySeries, type BoardChartPoint, type BoardHistory } from "@/utils/boardHistory";
import type { BoardHostCard } from "@/utils/boardModel";
import { formatBytes, formatMemCapacity } from "@/utils/format";

const EMPTY_POINTS: BoardHistory["points"] = [];

function timeLabel(at: number, seconds = false): string {
  return new Date(at).toLocaleTimeString("zh-CN", {
    hour12: false, hour: "2-digit", minute: "2-digit", ...(seconds ? { second: "2-digit" } : {}),
  });
}

function trendOption(data: BoardChartPoint[], label: string, from: number, to: number, fontSize: number): EChartsOption {
  const base = lineOption([], [{ name: label, data: [], bands: usageBands(100) }]);
  const muted = readThemeColor("--color-muted", "");
  const line = readThemeColor("--color-line", "");
  return {
    ...base,
    animation: false,
    // 自动更新的大屏不捕获滚轮；窄窗口滚动时也不会意外缩放时间窗。
    dataZoom: [],
    grid: { left: 8, right: fontSize * 2, top: 16, bottom: 8, containLabel: true },
    tooltip: {
      trigger: "axis", confine: true, renderMode: "richText",
      backgroundColor: readThemeColor("--color-surface", ""), borderColor: line,
      borderWidth: 1, shadowBlur: 0, padding: [8, 12],
      textStyle: { color: readThemeColor("--color-ink", ""), fontSize },
      axisPointer: { type: "line", lineStyle: { color: muted, type: "dashed" } },
      formatter: (params) => {
        const point = Array.isArray(params) ? params[0] : params;
        const values = Array.isArray(point?.value) ? point.value : [];
        const at = Number(values[0]);
        const value = values[1];
        return `${timeLabel(at, true)}\n${label}  ${typeof value === "number" ? `${value.toFixed(1)}%` : "缺少采样"}`;
      },
    },
    xAxis: {
      type: "time", min: from, max: to, splitNumber: 4,
      axisLabel: { color: muted, fontSize, hideOverlap: true, formatter: (value: number) => timeLabel(value) },
      axisLine: { lineStyle: { color: line } }, axisTick: { show: false },
      splitLine: { show: false },
    },
    yAxis: {
      type: "value", min: 0, max: 100, interval: 25,
      axisLabel: { color: muted, fontSize, formatter: "{value}%" },
      splitLine: { lineStyle: { color: line, type: "dashed" } },
    },
    series: [{
      name: label, type: "line", data, showSymbol: data.filter((p) => p[1] !== null).length === 1,
      symbolSize: 6, smooth: false, connectNulls: false,
      lineStyle: { width: Math.max(2, fontSize / 8) }, areaStyle: { opacity: 0.08 },
    }],
  };
}

const TrendPanel = memo(function TrendPanel({ label, host, value, detail, data, from, to, emptyText }: {
  label: string; host: string; value?: number; detail: string; data: BoardChartPoint[];
  from: number; to: number; emptyText: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [fontSize, setFontSize] = useState(14);
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(([entry]) => {
      setFontSize(Math.min(32, Math.max(14, Math.round(entry.contentRect.width / 60))));
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);
  const option = useMemo(() => trendOption(data, label, from, to, fontSize), [data, label, from, to, fontSize]);
  const hasData = data.some((p) => p[1] !== null);
  return (
    <section className="board-trends__panel" aria-label={`${host} ${label}`}>
      <div className="board-trends__readout">
        <span className="board-trends__label">{label}</span>
        <div className="board-trends__values">
          <strong className={value !== undefined && usageTone(value) === "danger" ? "is-danger" : undefined}>
            {value !== undefined && Number.isFinite(value) ? `${value.toFixed(1)}%` : "—"}
          </strong>
          <span>{detail}</span>
        </div>
      </div>
      <div ref={containerRef} className="board-trends__plot" role="img"
        aria-label={`${host} 最近一小时${label}曲线，${hasData ? "鼠标悬停查看采样时间与数值" : emptyText}`}>
        {hasData ? <ChartHost option={option} /> : <div className="board-trends__empty">{emptyText}</div>}
      </div>
    </section>
  );
});

export const BoardHostTrends = memo(function BoardHostTrends({ host, card, history, onRetry }: {
  host: string; card: BoardHostCard; history?: BoardHistory; onRetry: () => void;
}) {
  const points = history?.points || EMPTY_POINTS;
  const series = useMemo(() => boardHistorySeries(points, card.overview?.memTotal), [points, card.overview?.memTotal]);
  const ov = card.error ? null : card.overview;
  const from = history?.from || 0;
  const to = history?.to || 0;
  const emptyText = history?.loading || !history ? "正在读取历史采样…" : history.error ? "历史数据暂不可用" : "最近一小时暂无采样";
  return (
    <section id="board-host-trends" className="board-trends" aria-labelledby="board-trends-title" data-host={host}>
      <header className="board-trends__header">
        <h2 id="board-trends-title"><span>{host}</span><span className="board-trends__period">近 1 小时趋势</span></h2>
        <span className="board-trends__freshness">
          {history?.loading ? "正在更新…" : history?.updatedAt ? `曲线更新 ${timeLabel(history.updatedAt, true)}` : "等待采样"}
        </span>
      </header>
      {card.error || history?.error ? (
        <div className="board-trends__notice" role="status">
          <span>{card.error ? `主机连接异常：${card.error}` : `历史数据更新失败：${history?.error}`}
            {points.length ? "；下方保留最近一次成功采样" : ""}</span>
          {history?.error ? <Button size="sm" variant="ghost" onClick={onRetry} disabled={history.loading}>重试</Button> : null}
        </div>
      ) : null}
      <div className="board-trends__charts">
        <TrendPanel host={host} label="CPU 使用率" value={ov?.cpuPercent}
          detail={ov?.cpuCount ? `${ov.cpuCount} 核` : "等待主机指标"}
          data={series.cpu} from={from} to={to} emptyText={emptyText} />
        <TrendPanel host={host} label="内存使用率" value={ov?.memPercent}
          detail={ov ? `${formatBytes(ov.memUsed)} / ${formatMemCapacity(ov.memTotal)}` : "等待主机指标"}
          data={series.mem} from={from} to={to}
          emptyText={points.length && !card.overview?.memTotal ? "等待主机内存总量" : emptyText} />
      </div>
    </section>
  );
});
