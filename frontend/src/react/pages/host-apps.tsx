import { useQuery } from "@tanstack/react-query";
import * as echarts from "echarts";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/api";
import type { agentapi, agentcli } from "@/api";
import { Button } from "@/react/components/ui/button";
import { Checkbox } from "@/react/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@/react/components/ui/dialog";
import { FlashNotices, Notice, Page } from "@/react/components/page";
import { Tag } from "@/react/components/ui/tag";
import { useFlashMessage } from "@/react/lib/use-flash-message";
import { readThemeColor, seriesColorList } from "@/react/lib/utils";
import { updateSettings, useSettings } from "@/react/state/settings";
import {
  formatBytes,
  formatDurationLong,
  formatErr,
  formatScaledBytes,
  pickByteScale,
} from "@/utils/format";
import { settingsAccess } from "@/utils/settingsAccess";
import {
  isWatchServiceName,
  watchServiceSortKey,
} from "@/utils/watchServices";
import { patchWatchNotify } from "@/utils/watchYaml";

type InstRow = agentapi.JavaAppInstance;

function pad(n: number) {
  return n < 10 ? "0" + n : String(n);
}

function timeLabel(ts: number) {
  const d = new Date(ts * 1000);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function canSubscribeNotify(service: string) {
  return isWatchServiceName(service);
}

function canShutdown(row: InstRow) {
  if (!row.screen) return false;
  return (row.pid || 0) > 0 || (row.port || 0) > 0;
}

function shortJarPath(p: string | undefined): string {
  if (!p) return "";
  const parts = p.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts[parts.length - 1] || p;
}

/** 解析 "YYYY-MM-DD HH:mm:ss"，返回距今秒数；解析失败返回 null */
function elapsedSinceStart(startTime: string): number | null {
  const m = startTime.match(
    /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/,
  );
  if (!m) return null;
  const d = new Date(
    Number(m[1]),
    Number(m[2]) - 1,
    Number(m[3]),
    Number(m[4]),
    Number(m[5]),
    Number(m[6]),
  );
  if (Number.isNaN(d.getTime())) return null;
  return Math.floor((Date.now() - d.getTime()) / 1000);
}

function formatStartTimeCell(startTime: string | undefined): string {
  if (!startTime) return "";
  const elapsed = elapsedSinceStart(startTime);
  if (elapsed == null || elapsed <= 0) return startTime;
  const dur = formatDurationLong(elapsed);
  if (!dur || dur === "—") return startTime;
  return `${startTime}（${dur}）`;
}

function isOnline(row: InstRow) {
  return !!row.healthUp;
}

function isAppStarted(row: InstRow) {
  return (
    (row.pid || 0) > 0 ||
    (row.port || 0) > 0 ||
    !!row.processUp ||
    !!(row.screen || "").trim()
  );
}

function canOpenCharts(row: InstRow) {
  return !!row.service && isAppStarted(row) && isOnline(row);
}

function compareDeployVer(a: string, b: string): number {
  if (!a && !b) return 0;
  if (!a) return -1;
  if (!b) return 1;
  const [aDateRaw = "", aSeq = "0"] = a.split("_");
  const [bDateRaw = "", bSeq = "0"] = b.split("_");
  const aDate = aDateRaw.length === 6 ? `20${aDateRaw}` : aDateRaw;
  const bDate = bDateRaw.length === 6 ? `20${bDateRaw}` : bDateRaw;
  if (aDate !== bDate) return aDate.localeCompare(bDate);
  return (parseInt(aSeq, 10) || 0) - (parseInt(bSeq, 10) || 0);
}

function maxDeployVer(versions: Iterable<string>): string {
  let latest = "";
  for (const raw of versions) {
    const v = (raw || "").trim();
    if (!v) continue;
    if (!latest || compareDeployVer(v, latest) > 0) latest = v;
  }
  return latest;
}

function latestDeployVerInRows(rows: InstRow[]): string {
  const vers: string[] = [];
  for (const r of rows) {
    vers.push(r.deployVer || "");
    vers.push(r.latestDeployVer || "");
  }
  return maxDeployVer(vers);
}

function latestDeployVerForRow(row: InstRow, byService: Map<string, string>): string {
  return byService.get(row.service || "") || "";
}

function isLatestDeploy(deployVer: string, latest: string): boolean {
  if (!deployVer || !latest) return false;
  return compareDeployVer(deployVer.trim(), latest.trim()) === 0;
}

function sortInstances(rows: InstRow[]): InstRow[] {
  return [...rows].sort((a, b) => {
    const sa = watchServiceSortKey(a.service || "");
    const sb = watchServiceSortKey(b.service || "");
    if (sa !== sb) return sa - sb;
    return (a.port || 0) - (b.port || 0);
  });
}

function buildTableRows(
  instances: InstRow[],
  status: agentcli.WatchStatus[],
): InstRow[] {
  const bySvc = new Map(status.map((s) => [s.service || "", s]));
  const seen = new Set<string>();
  const rows: InstRow[] = instances.map((r) => {
    const name = r.service || "";
    seen.add(name);
    const st = bySvc.get(name);
    const group =
      name === "ai-agent" || name === "sapi-agent" ? "other" : r.group || "pro";
    return {
      ...r,
      group,
      runtime: r.runtime || st?.runtime || "java",
    };
  });
  for (const s of status) {
    const name = s.service || "";
    if (!name || seen.has(name)) continue;
    const group =
      name === "ai-agent" || name === "sapi-agent"
        ? "other"
        : ["oss", "im", "csp", "std", "telemetry"].includes(name)
          ? "std"
          : "pro";
    rows.push({
      service: name,
      runtime: s.runtime || "java",
      pid: 0,
      port: 0,
      deployVer: "",
      latestDeployVer: "",
      startTime: "",
      screen: "",
      jarPath: "",
      healthUp: false,
      processUp: false,
      ingressOn: false,
      ingressUp: false,
      status: "DOWN",
      group,
    });
  }
  return rows;
}

function ChartHost({
  option,
  height,
  className,
}: {
  option: echarts.EChartsOption;
  height?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const chartRef = useRef<echarts.EChartsType | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    const chart = echarts.init(ref.current);
    chartRef.current = chart;
    const onResize = () => chart.resize();
    window.addEventListener("resize", onResize);
    const ro = new ResizeObserver(onResize);
    ro.observe(ref.current);
    return () => {
      window.removeEventListener("resize", onResize);
      ro.disconnect();
      chart.dispose();
      chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    chartRef.current?.setOption(
      {
        animationDuration: 240,
        animationEasing: "cubicOut",
        ...option,
      },
      { notMerge: true },
    );
  }, [option]);

  return (
    <div
      ref={ref}
      style={height != null ? { height } : undefined}
      className={`w-full min-h-0 min-w-0 ${className || ""}`}
    />
  );
}

function bytesAxisFormatter(values: number[]) {
  const max = Math.max(0, ...values);
  const scale = pickByteScale(max || 1);
  return {
    formatter: (v: number) => formatScaledBytes(v, scale.divisor),
    name: scale.unit,
  };
}

function lineOption(opts: {
  xData: string[];
  series: { name: string; data: number[]; yAxisIndex?: number }[];
  unit?: "bytes" | "raw";
  formatStr?: string;
  markLines?: { name: string; x: string }[];
  dualBytesOnRight?: boolean;
}): echarts.EChartsOption {
  const muted = readThemeColor("--color-muted", "rgba(0, 0, 0, 0.6)");
  const line = readThemeColor("--color-line", "#dce3ee");
  const danger = readThemeColor("--color-danger", "#d54941");
  const markLineData = (opts.markLines || []).map((m) => ({
    name: m.name,
    xAxis: m.x,
  }));
  const allY = opts.series.flatMap((s) => s.data);
  const bytesFmt =
    opts.unit === "bytes" ? bytesAxisFormatter(allY) : null;

  const yAxes: echarts.YAXisComponentOption[] = [
    {
      type: "value",
      axisLabel: {
        fontSize: 12,
        color: muted,
        formatter: bytesFmt ? (v: number) => bytesFmt.formatter(v) : undefined,
      },
      name: bytesFmt?.name,
      nameTextStyle: { fontSize: 12, color: muted },
      splitLine: { lineStyle: { color: line } },
    },
  ];

  if (opts.dualBytesOnRight) {
    const rightSeries = opts.series.find((s) => s.yAxisIndex === 1);
    const rightFmt = bytesAxisFormatter(rightSeries?.data || [0]);
    yAxes.push({
      type: "value",
      axisLabel: {
        fontSize: 12,
        color: muted,
        // 单位跟在刻度后，避免轴名「GB」和图例「主机 内存」挤在右上角
        formatter: (v: number) => {
          const n = rightFmt.formatter(v);
          if (n === "0") return "0";
          return `${n} ${rightFmt.name}`;
        },
      },
      splitLine: { show: false },
    });
  }

  return {
    color: seriesColorList(opts.series.map((s) => s.name)),
    grid: { left: 8, right: 16, top: 28, bottom: 28, containLabel: true },
    tooltip: {
      trigger: "axis",
      formatter: (params) => {
        const items = Array.isArray(params) ? params : [params];
        if (!items.length) return "";
        // echarts 类型里 axis 触发时才有 axisValueLabel，CallbackDataParams 未声明，这里补上
        const first = items[0] as (typeof items)[number] & { axisValueLabel?: string };
        const head = String(first.axisValueLabel ?? first.name ?? "");
        const lines = items.map((p) => {
          const name = String(p.seriesName ?? "");
          const raw = typeof p.value === "number" ? p.value : Number(p.value);
          let text: string;
          if (!Number.isFinite(raw)) {
            text = String(p.value ?? "");
          } else if (opts.unit === "bytes") {
            text = formatBytes(raw);
          } else if (
            opts.dualBytesOnRight &&
            opts.series[p.seriesIndex ?? -1]?.yAxisIndex === 1
          ) {
            text = formatBytes(raw);
          } else if (name.includes("CPU")) {
            text = raw.toFixed(2);
          } else if (Number.isInteger(raw)) {
            text = String(raw);
          } else {
            text = raw.toFixed(2);
          }
          return `${p.marker}${name} ${text}`;
        });
        return [head, ...lines].join("<br/>");
      },
    },
    // 图表文字同样遵守桌面端最小 12px（DESIGN.md §3.2）
    legend: { top: 0, right: 0, textStyle: { fontSize: 12, color: muted } },
    xAxis: {
      type: "category",
      data: opts.xData,
      axisLabel: { fontSize: 12, color: muted },
      axisLine: { lineStyle: { color: line } },
    },
    yAxis: yAxes,
    series: opts.series.map((s, index) => ({
      name: s.name,
      type: "line" as const,
      showSymbol: false,
      smooth: true,
      data: s.data,
      yAxisIndex: s.yAxisIndex || 0,
      lineStyle: { width: 1.75 },
      areaStyle: index === 0 ? { opacity: 0.08 } : undefined,
      markLine:
        index === 0 && markLineData.length
          ? {
              symbol: "none",
              label: { show: false },
              lineStyle: { type: "dashed", color: danger, width: 1 },
              data: markLineData,
            }
          : undefined,
    })),
  };
}

type ColAlign = "left" | "right" | "center";

/**
 * 三张表共用的列定义：table-layout fixed + 同一 colgroup，保证列在卡片间垂直对齐。
 * width 为空的列平分剩余宽度；路径列 span 2，占两份剩余宽度（启动时间只占一份）。
 */
const APP_COLUMNS: {
  key: string;
  label: string;
  width?: number;
  span?: number;
  align: ColAlign;
}[] = [
  { key: "idx", label: "序", width: 40, align: "left" },
  { key: "service", label: "标识", width: 160, align: "left" },
  { key: "port", label: "端口", width: 72, align: "right" },
  { key: "deployVer", label: "部署版本", width: 200, align: "left" },
  { key: "startTime", label: "启动时间", align: "left" },
  { key: "screen", label: "会话", width: 140, align: "left" },
  { key: "jarPath", label: "路径", span: 2, align: "left" },
  { key: "status", label: "状态", width: 72, align: "left" },
  { key: "subscribe", label: "订阅", width: 56, align: "center" },
  { key: "action", label: "操作", width: 64, align: "right" },
];

/** 端口 ~ 路径 共 6 个物理列（路径占 2），未运行时合并成一格 */
const IDLE_SPAN_COLS = 6;

function alignClass(align: ColAlign) {
  if (align === "right") return "text-right";
  if (align === "center") return "text-center";
  return "text-left";
}

/** 首列左内边距 16px 与标题行对齐，末列右内边距 16px 与卡片边对齐 */
function cellPadClass(index: number) {
  if (index === 0) return "pl-4 pr-2";
  if (index === APP_COLUMNS.length - 1) return "pl-2 pr-4";
  return "px-3";
}

/* 服务名识别色（DESIGN.md §6 / §9）：色相跳过 70–170 绿色段 */
const SERVICE_HUES = [212, 18, 272, 346, 196, 32, 236, 312, 54, 290, 0, 250];

function serviceNameColors(rows: { service: string }[]): Map<string, string> {
  const names = [...new Set(rows.map((row) => row.service).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, "en"),
  );
  const colors = new Map<string, string>();
  names.forEach((name, index) => {
    const hue = SERVICE_HUES[index % SERVICE_HUES.length];
    const lap = Math.floor(index / SERVICE_HUES.length);
    colors.set(name, `hsl(${hue} 48% ${42 - lap * 3}%)`);
  });
  return colors;
}

function AppsTable({
  title,
  rows,
  latestByService,
  nameColors,
  subscribed,
  onToggleSubscribe,
  onRowClick,
  onShutdown,
}: {
  title: string;
  rows: InstRow[];
  latestByService: Map<string, string>;
  nameColors: Map<string, string>;
  subscribed: (service: string) => boolean;
  onToggleSubscribe: (service: string, on: boolean) => void;
  onRowClick: (row: InstRow) => void;
  onShutdown: (row: InstRow) => void;
}) {
  const onlineCount = rows.filter((r) => isOnline(r)).length;

  // 全部在线 ok，部分在线 warn，无在线 neutral
  let countTone: "ok" | "warn" | "neutral" = "neutral";
  if (onlineCount > 0 && onlineCount === rows.length) {
    countTone = "ok";
  } else if (onlineCount > 0) {
    countTone = "warn";
  }

  return (
    <section className="surface-float overflow-hidden">
      <div className="flex h-10 items-center justify-between gap-3 px-4">
        <h2 className="truncate text-sm font-semibold text-ink">{title}</h2>
        <Tag tone={countTone} className="tabular-nums">
          {onlineCount}/{rows.length} 在线
        </Tag>
      </div>
      <div className="overflow-auto">
        <table className="w-full table-fixed border-collapse text-left text-sm">
          <colgroup>
            {APP_COLUMNS.map((col) => (
              <col
                key={col.key}
                span={col.span}
                style={col.width ? { width: col.width } : undefined}
              />
            ))}
          </colgroup>
          <thead>
            <tr className="h-table-head border-b border-line text-xs font-normal text-muted">
              {APP_COLUMNS.map((col, i) => (
                <th
                  key={col.key}
                  colSpan={col.span}
                  className={`${cellPadClass(i)} ${alignClass(col.align)} font-normal whitespace-nowrap`}
                >
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => {
              const latest = latestDeployVerForRow(row, latestByService);
              const latestHit = isLatestDeploy(row.deployVer || "", latest);
              const clickable = canOpenCharts(row);
              const online = isOnline(row);
              const started = isAppStarted(row);
              const nameColor = nameColors.get(row.service) || "var(--color-ink)";
              return (
                <tr
                  key={`${row.service}-${row.pid}-${row.port}-${idx}`}
                  className={
                    clickable
                      ? "group h-table-row border-b border-line last:border-b-0 hover:bg-raised"
                      : "h-table-row border-b border-line text-muted last:border-b-0"
                  }
                  style={clickable ? { cursor: "pointer" } : undefined}
                  onClick={() => {
                    if (clickable) onRowClick(row);
                  }}
                >
                  <td className="pl-4 pr-2 text-left align-middle font-mono text-xs tabular-nums text-muted">
                    {idx + 1}
                  </td>
                  <td
                    className={
                      online
                        ? "px-3 align-middle font-mono text-sm font-semibold text-ink"
                        : "px-3 align-middle font-mono text-sm font-semibold text-muted"
                    }
                  >
                    <span className="inline-flex max-w-full items-center gap-1.5">
                      <span
                        className="inline-block h-2 w-2 shrink-0 rounded-full"
                        style={{ background: online ? nameColor : "var(--color-line)" }}
                        aria-hidden
                      />
                      <span className="truncate" style={{ color: online ? nameColor : undefined }}>
                        {row.service}
                      </span>
                      {row.runtime === "bun" ? <Tag>Bun</Tag> : null}
                    </span>
                  </td>
                  {started ? (
                    <>
                      <td
                        className={
                          latestHit && row.port
                            ? "px-3 text-right align-middle font-mono text-sm font-semibold tabular-nums text-success-text"
                            : "px-3 text-right align-middle font-mono text-sm tabular-nums"
                        }
                      >
                        {row.port || ""}
                      </td>
                      <td className="px-3 align-middle">
                        {row.deployVer ? (
                          <span className="inline-flex items-center gap-2 whitespace-nowrap">
                            <span
                              className={
                                latestHit
                                  ? "font-mono text-sm font-semibold tabular-nums text-success-text"
                                  : "font-mono text-sm tabular-nums"
                              }
                            >
                              {row.deployVer}
                            </span>
                            {latestHit ? <Tag tone="ok">最新</Tag> : null}
                          </span>
                        ) : null}
                      </td>
                      <td
                        className="truncate px-3 align-middle font-mono text-sm tabular-nums"
                        data-tip={formatStartTimeCell(row.startTime)} data-tip-overflow=""
                      >
                        {formatStartTimeCell(row.startTime)}
                      </td>
                      <td
                        className="truncate px-3 align-middle font-mono text-sm"
                        data-tip={row.screen || ""} data-tip-overflow=""
                      >
                        {row.screen || ""}
                      </td>
                      <td
                        colSpan={2}
                        className="truncate px-3 align-middle font-mono text-sm text-muted"
                        data-tip={row.jarPath || ""} data-tip-overflow=""
                      >
                        {shortJarPath(row.jarPath)}
                      </td>
                    </>
                  ) : (
                    // 未运行：端口 ~ 路径合并成一格，不逐格填破折号
                    <td colSpan={IDLE_SPAN_COLS} className="px-3 align-middle text-xs text-muted">
                      未运行
                    </td>
                  )}
                  <td className="px-3 align-middle">
                    {online ? <Tag tone="ok">在线</Tag> : <Tag tone="neutral">离线</Tag>}
                  </td>
                  <td
                    className="px-3 text-center align-middle"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {canSubscribeNotify(row.service) ? (
                      <Checkbox
                        aria-label="通知订阅"
                        data-tip="写入通知订阅设置"
                        checked={subscribed(row.service)}
                        onChange={(checked) => onToggleSubscribe(row.service, checked)}
                      />
                    ) : null}
                  </td>
                  <td
                    className="pl-2 pr-4 text-right align-middle"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {canShutdown(row) ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-danger"
                        onClick={() => onShutdown(row)}
                      >
                        下架
                      </Button>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function AppsPage({ host }: { host: string }) {
  const settings = useSettings();
  const flash = useFlashMessage();
  const [cfgOpen, setCfgOpen] = useState(false);
  const [yamlText, setYamlText] = useState("");
  const [saving, setSaving] = useState(false);
  const [shutdownTarget, setShutdownTarget] = useState<InstRow | null>(null);
  const [shutdownBusy, setShutdownBusy] = useState(false);

  const [chartsOpen, setChartsOpen] = useState(false);
  const [selectedService, setSelectedService] = useState("");
  const [jarPts, setJarPts] = useState<agentapi.JarRangePoint[]>([]);
  const [hostPts, setHostPts] = useState<agentapi.RangePoint[]>([]);
  const [events, setEvents] = useState<agentcli.WatchEventRow[]>([]);
  const [detailBusy, setDetailBusy] = useState(false);

  const instances = useQuery({
    queryKey: ["apps", host],
    queryFn: () => api.agentWatchInstances(host),
    refetchInterval: 8000,
  });
  const status = useQuery({
    queryKey: ["apps-status", host],
    queryFn: () => api.agentWatchStatus(host),
    refetchInterval: 8000,
  });

  const tableRows = useMemo(
    () => buildTableRows(instances.data || [], status.data || []),
    [instances.data, status.data],
  );

  const stdInstances = useMemo(
    () => sortInstances(tableRows.filter((r) => r.group === "std")),
    [tableRows],
  );
  const proInstances = useMemo(
    () => sortInstances(tableRows.filter((r) => r.group === "pro")),
    [tableRows],
  );
  const otherInstances = useMemo(
    () => sortInstances(tableRows.filter((r) => r.group === "other")),
    [tableRows],
  );

  const nameColors = useMemo(() => serviceNameColors(tableRows), [tableRows]);

  const latestByService = useMemo(() => {
    const m = new Map<string, string>();
    const bySvc = new Map<string, InstRow[]>();
    for (const r of tableRows) {
      const name = r.service || "";
      if (!name) continue;
      let list = bySvc.get(name);
      if (!list) {
        list = [];
        bySvc.set(name, list);
      }
      list.push(r);
    }
    for (const [name, list] of bySvc) {
      m.set(name, latestDeployVerInRows(list));
    }
    return m;
  }, [tableRows]);

  const sections = [
    { key: "std", title: "标准版服务", rows: stdInstances },
    { key: "pro", title: "私有化服务", rows: proInstances },
    { key: "other", title: "云组件服务", rows: otherInstances },
  ].filter((s) => s.rows.length > 0);

  const isBun = useMemo(() => {
    const row = tableRows.find((r) => r.service === selectedService);
    if (row?.runtime === "bun") return true;
    const st = (status.data || []).find((s) => s.service === selectedService);
    return st?.runtime === "bun";
  }, [tableRows, status.data, selectedService]);

  const marks = useMemo(() => {
    const xs = new Set(jarPts.map((p) => timeLabel(p.ts)));
    const out: { name: string; x: string }[] = [];
    for (const e of events) {
      if (!e.ts) continue;
      const x = timeLabel(e.ts);
      if (!xs.has(x)) continue;
      out.push({ name: `${e.layer}/${e.kind}`, x });
    }
    return out.slice(0, 20);
  }, [jarPts, events]);

  const jarX = useMemo(() => jarPts.map((p) => timeLabel(p.ts)), [jarPts]);
  const hostX = useMemo(() => hostPts.map((p) => timeLabel(p.ts)), [hostPts]);

  const heapOption = useMemo(
    () =>
      lineOption({
        xData: jarX,
        series: [
          { name: "堆已用", data: jarPts.map((p) => p.heapUsed || 0) },
          { name: "RSS", data: jarPts.map((p) => p.rss || 0) },
        ],
        unit: "bytes",
        markLines: marks,
      }),
    [jarX, jarPts, marks],
  );

  const rssOption = useMemo(
    () =>
      lineOption({
        xData: jarX,
        series: [{ name: "RSS", data: jarPts.map((p) => p.rss || 0) }],
        unit: "bytes",
        markLines: marks,
      }),
    [jarX, jarPts, marks],
  );

  const gcOption = useMemo(
    () =>
      lineOption({
        xData: jarX,
        series: [
          { name: "GC pause", data: jarPts.map((p) => p.gcPauseMs || 0) },
          { name: "进程 CPU%", data: jarPts.map((p) => p.cpuPercent || 0) },
        ],
        formatStr: "ms / %",
        unit: "raw",
      }),
    [jarX, jarPts],
  );

  const cpuOption = useMemo(
    () =>
      lineOption({
        xData: jarX,
        series: [
          { name: "进程 CPU%", data: jarPts.map((p) => p.cpuPercent || 0) },
        ],
        formatStr: "%",
        unit: "raw",
      }),
    [jarX, jarPts],
  );

  const hostOption = useMemo(
    () =>
      lineOption({
        xData: hostX,
        series: [
          { name: "主机 CPU%", data: hostPts.map((p) => p.cpuPercent || 0) },
          {
            name: "主机内存",
            data: hostPts.map((p) => p.memUsed || 0),
            yAxisIndex: 1,
          },
        ],
        formatStr: "%",
        unit: "raw",
        dualBytesOnRight: true,
      }),
    [hostX, hostPts],
  );

  async function loadDetail(service: string) {
    if (!service) return;
    setDetailBusy(true);
    const to = Math.floor(Date.now() / 1000);
    const from = to - 3600;
    try {
      const [jr, hr, ev] = await Promise.all([
        api.agentWatchRange(host, service, from, to),
        api.agentRange(host, from, to, "raw"),
        api.agentWatchEvents(host, service, from, to),
      ]);
      setJarPts(jr.points || []);
      setHostPts(hr.points || []);
      setEvents(ev || []);
    } catch (e) {
      flash.showError(formatErr(e));
    } finally {
      setDetailBusy(false);
    }
  }

  function openCharts(row: InstRow) {
    if (!canOpenCharts(row)) return;
    const service = row.service;
    setSelectedService(service);
    setChartsOpen(true);
    void loadDetail(service);
  }

  async function refreshAll() {
    // 只清错误：保存 / 下架后会调这里刷新，成功提示要留着自己淡出
    flash.clearError();
    await Promise.all([instances.refetch(), status.refetch()]);
  }

  async function openCfg() {
    flash.clear();
    try {
      const w = await api.agentGetWatch(host);
      setYamlText(w.yaml || "");
      setCfgOpen(true);
    } catch (e) {
      flash.showError(formatErr(e));
    }
  }

  async function saveCfg() {
    setSaving(true);
    try {
      const merged = patchWatchNotify(yamlText, {
        wecomWebhook: settingsAccess().effectiveWecomWebhook(),
      });
      setYamlText(merged);
      await api.agentPutWatch(host, merged);
      setCfgOpen(false);
      flash.showToast("监视配置已下发");
      await refreshAll();
    } catch (e) {
      flash.showError(formatErr(e));
    } finally {
      setSaving(false);
    }
  }

  async function confirmShutdown() {
    if (!shutdownTarget) return;
    setShutdownBusy(true);
    try {
      const req: agentapi.AppShutdownReq = {
        service: shutdownTarget.service,
        pid: shutdownTarget.pid,
        port: shutdownTarget.port,
        screen: shutdownTarget.screen,
      };
      const r = await api.agentAppShutdown(host, req);
      if (r.ok) flash.showToast(r.msg || "已发起下架");
      else flash.showError(r.msg || "下架失败");
      setShutdownTarget(null);
      setTimeout(() => {
        void refreshAll();
      }, 1500);
    } catch (e) {
      flash.showError(formatErr(e));
    } finally {
      setShutdownBusy(false);
    }
  }

  function isSubscribed(service: string) {
    return (settings.hostAppNotifySubs[host] || []).includes(service);
  }

  function toggleSubscribe(service: string, on: boolean) {
    const current = settings.hostAppNotifySubs;
    const list = new Set(current[host] || []);
    if (on) list.add(service);
    else list.delete(service);
    // 与「通知 → 订阅」同一套 hostAppNotifySubs / setNotifySubs
    updateSettings({ hostAppNotifySubs: { ...current, [host]: [...list] } });
  }

  useEffect(() => {
    setSelectedService("");
    setChartsOpen(false);
    setJarPts([]);
    setHostPts([]);
    setEvents([]);
  }, [host]);

  return (
    <Page
      title="应用"
      onRefresh={() => void refreshAll()}
      actions={
        <Button variant="ghost" size="sm" onClick={() => void openCfg()}>
          监视配置
        </Button>
      }
    >
      {instances.error ? <Notice text={formatErr(instances.error)} /> : null}
      {status.error ? <Notice text={formatErr(status.error)} /> : null}
      <FlashNotices flash={flash} />

      {sections.length === 0 && !instances.isLoading ? (
        <div className="py-8 text-center text-sm text-muted">暂无监视实例</div>
      ) : (
        <div className="flex flex-col gap-section">
        {sections.map((sec) => (
          <AppsTable
            key={sec.key}
            title={sec.title}
            rows={sec.rows}
            latestByService={latestByService}
            nameColors={nameColors}
            subscribed={isSubscribed}
            onToggleSubscribe={toggleSubscribe}
            onRowClick={openCharts}
            onShutdown={setShutdownTarget}
          />
        ))}
        </div>
      )}

      <Dialog
        open={chartsOpen}
        onOpenChange={(v) => {
          if (!v) setChartsOpen(false);
        }}
      >
        <DialogContent className="flex h-[95vh] max-h-[95vh] w-[95vw] max-w-[95vw] flex-col overflow-hidden px-6 py-5">
          <DialogTitle className="shrink-0">
            {selectedService ? `${selectedService} · 对照（近 1 小时）` : "曲线"}
          </DialogTitle>
          <div className="mt-3 flex min-h-0 flex-1 flex-col gap-3">
            <div className="flex min-h-0 flex-[1.25] flex-col">
              {isBun ? (
                <ChartHost option={rssOption} className="h-full flex-1" />
              ) : (
                <ChartHost option={heapOption} className="h-full flex-1" />
              )}
            </div>
            <div className="flex min-h-0 flex-1 flex-col">
              {isBun ? (
                <ChartHost option={cpuOption} className="h-full flex-1" />
              ) : (
                <ChartHost option={gcOption} className="h-full flex-1" />
              )}
            </div>
            <div className="flex min-h-0 flex-1 flex-col">
              <ChartHost option={hostOption} className="h-full flex-1" />
            </div>
            {events.length ? (
              <div className="surface-float max-h-[22%] shrink-0 overflow-auto">
                <table className="w-full border-collapse text-left text-sm">
                  <thead className="sticky top-0 z-[1] bg-surface text-xs font-normal text-muted">
                    <tr className="h-table-head border-b border-line">
                      <th className="px-3 font-normal">序</th>
                      <th className="px-3 font-normal">层</th>
                      <th className="px-3 font-normal">类型</th>
                      <th className="px-3 font-normal">说明</th>
                    </tr>
                  </thead>
                  <tbody>
                    {events.map((e, i) => (
                      <tr key={`${e.ts}-${i}`} className="h-table-row border-t border-line">
                        <td className="px-3 text-center">{i + 1}</td>
                        <td className="px-3">{e.layer || "—"}</td>
                        <td className="px-3">{e.kind || "—"}</td>
                        <td className="px-3">{e.msg || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={cfgOpen} onOpenChange={(v) => !v && setCfgOpen(false)}>
        <DialogContent className="w-[min(720px,calc(100%-32px))]">
          <DialogTitle>下发 watch.yml</DialogTitle>
          <textarea
            className="motion-field mt-3 h-64 w-full rounded-control p-3 font-mono text-xs text-ink"
            value={yamlText}
            onChange={(e) => setYamlText(e.target.value)}
          />
          <DialogFooter>
            <Button onClick={() => setCfgOpen(false)}>取消</Button>
            <Button variant="primary" disabled={saving} onClick={() => void saveCfg()}>
              下发
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!shutdownTarget}
        onOpenChange={(v) => !v && setShutdownTarget(null)}
      >
        <DialogContent className="w-[min(480px,calc(100%-32px))]">
          <DialogTitle>确认下架</DialogTitle>
          <DialogDescription>
            将直接终止进程并退出 screen 会话，此操作不可撤销。
          </DialogDescription>
          {shutdownTarget ? (
            <div className="mt-3 space-y-2 text-sm">
              <Kv label="服务" value={shutdownTarget.service} />
              <Kv label="PID" value={String(shutdownTarget.pid || "—")} />
              <Kv label="端口" value={String(shutdownTarget.port || "—")} />
              <Kv label="screen" value={shutdownTarget.screen || "—"} />
              <Kv label="部署版本" value={shutdownTarget.deployVer || "—"} />
            </div>
          ) : null}
          <DialogFooter>
            <Button onClick={() => setShutdownTarget(null)}>取消</Button>
            <Button
              variant="danger"
              disabled={shutdownBusy}
              onClick={() => void confirmShutdown()}
            >
              确认下架
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Page>
  );
}

function Kv({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[88px_1fr] gap-2">
      <span className="text-muted">{label}</span>
      <b className="break-all font-mono text-xs font-semibold">{value}</b>
    </div>
  );
}
