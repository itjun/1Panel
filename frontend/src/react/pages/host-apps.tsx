import { useQuery } from "@tanstack/react-query";
import * as echarts from "echarts";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/api";
import type { agentapi, agentcli } from "@/api";
import { Button } from "@/react/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@/react/components/ui/dialog";
import { Notice, Page } from "@/react/components/page";
import { readThemeColor, seriesColorList } from "@/react/lib/utils";
import { updateSettings, useSettings } from "@/react/state/settings";
import { formatBytes, formatErr, formatScaledBytes, pickByteScale } from "@/utils/format";
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
  if (!p) return "—";
  const parts = p.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts[parts.length - 1] || p;
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
  height = 200,
}: {
  option: echarts.EChartsOption;
  height?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const chartRef = useRef<echarts.EChartsType | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    const chart = echarts.init(ref.current);
    chartRef.current = chart;
    const onResize = () => chart.resize();
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
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

  return <div ref={ref} style={{ height }} className="w-full min-w-0" />;
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
  const line = readThemeColor("--color-line", "#e8e8e8");
  const danger = readThemeColor("--color-danger", "#ad352f");
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
        fontSize: 10,
        color: muted,
        formatter: bytesFmt ? (v: number) => bytesFmt.formatter(v) : undefined,
      },
      name: bytesFmt?.name,
      nameTextStyle: { fontSize: 10, color: muted },
      splitLine: { lineStyle: { color: line } },
    },
  ];

  if (opts.dualBytesOnRight) {
    const rightSeries = opts.series.find((s) => s.yAxisIndex === 1);
    const rightFmt = bytesAxisFormatter(rightSeries?.data || [0]);
    yAxes.push({
      type: "value",
      axisLabel: {
        fontSize: 10,
        color: muted,
        formatter: (v: number) => rightFmt.formatter(v),
      },
      name: rightFmt.name,
      nameTextStyle: { fontSize: 10, color: muted },
      splitLine: { show: false },
    });
  }

  return {
    color: seriesColorList(opts.series.map((s) => s.name)),
    grid: { left: 52, right: opts.dualBytesOnRight ? 52 : 16, top: 28, bottom: 28 },
    tooltip: {
      trigger: "axis",
      valueFormatter: (v) => {
        if (typeof v !== "number") return String(v ?? "");
        if (opts.unit === "bytes") return formatBytes(v);
        return String(v);
      },
    },
    legend: { top: 0, right: 0, textStyle: { fontSize: 11 } },
    xAxis: {
      type: "category",
      data: opts.xData,
      axisLabel: { fontSize: 10, color: muted },
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

const SERVICE_HUES = [212, 162, 32, 272, 346, 188, 92, 18, 236, 312, 54, 128];

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

  return (
    <section className="overflow-hidden border border-line bg-surface">
      <div className="flex items-baseline justify-between gap-3 border-b border-line px-3.5 py-2.5">
        <div className="flex min-w-0 items-baseline gap-2">
          <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
          <span className="font-mono text-[11px] tabular-nums text-muted">
            {onlineCount}/{rows.length} 在线
          </span>
        </div>
      </div>
      <div className="overflow-auto">
        <table className="w-full border-collapse text-left text-[13px]">
          <thead>
            <tr className="h-9 border-b border-line bg-raised/80 text-[11px] text-muted">
              <th className="w-10 px-2.5 text-center font-medium">序</th>
              <th className="px-3 font-medium whitespace-nowrap">标识</th>
              <th className="w-16 px-2 text-center font-medium">端口</th>
              <th className="px-3 font-medium whitespace-nowrap">部署版本</th>
              <th className="px-3 font-medium whitespace-nowrap">启动时间</th>
              <th className="px-3 font-medium whitespace-nowrap">screen</th>
              <th className="px-3 font-medium whitespace-nowrap">路径</th>
              <th className="w-[72px] px-2 text-center font-medium">状态</th>
              <th className="w-12 px-2 text-center font-medium">订阅</th>
              <th className="w-14 px-2 text-center font-medium">操作</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => {
              const latest = latestDeployVerForRow(row, latestByService);
              const latestHit = isLatestDeploy(row.deployVer || "", latest);
              const clickable = canOpenCharts(row);
              const online = isOnline(row);
              const nameColor = nameColors.get(row.service) || "var(--color-ink)";
              return (
                <tr
                  key={`${row.service}-${row.pid}-${row.port}-${idx}`}
                  className={
                    clickable
                      ? "group h-11 border-b border-line/80 last:border-b-0 hover:bg-accent-soft/50"
                      : "h-11 border-b border-line/80 text-muted last:border-b-0"
                  }
                  style={clickable ? { cursor: "pointer" } : undefined}
                  onClick={() => {
                    if (clickable) onRowClick(row);
                  }}
                >
                  <td className="px-2.5 text-center font-mono text-[11px] tabular-nums text-muted">
                    {idx + 1}
                  </td>
                  <td className="px-3 font-mono text-[13px] font-semibold">
                    <span className="inline-flex items-center gap-1.5">
                      <span
                        className="inline-block h-1.5 w-1.5 shrink-0 rounded-full"
                        style={{ background: online ? nameColor : "var(--color-line)" }}
                        aria-hidden
                      />
                      <span style={{ color: online ? nameColor : undefined }}>
                        {row.service || "—"}
                      </span>
                      {row.runtime === "bun" ? (
                        <span className="rounded-control border border-line px-1 text-[10px] font-normal text-muted">
                          Bun
                        </span>
                      ) : null}
                    </span>
                  </td>
                  <td
                    className={
                      latestHit && row.port
                        ? "px-2 text-center font-mono text-[13px] font-semibold tabular-nums text-success"
                        : "px-2 text-center font-mono text-[13px] tabular-nums"
                    }
                  >
                    {row.port || "—"}
                  </td>
                  <td className="px-3">
                    {row.deployVer ? (
                      <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                        <span
                          className={
                            latestHit
                              ? "font-mono text-[12px] font-semibold tabular-nums text-success"
                              : "font-mono text-[12px] tabular-nums"
                          }
                        >
                          {row.deployVer}
                        </span>
                        {latestHit ? (
                          <span className="rounded-control bg-success-soft px-1 py-px text-[10px] font-medium leading-none text-success">
                            最新
                          </span>
                        ) : null}
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-3 font-mono text-[12px] tabular-nums whitespace-nowrap text-muted">
                    {row.startTime || "—"}
                  </td>
                  <td className="px-3 font-mono text-[12px] whitespace-nowrap">
                    {row.screen || "—"}
                  </td>
                  <td
                    className="max-w-[200px] truncate px-3 font-mono text-[12px] text-muted"
                    title={row.jarPath || ""}
                  >
                    {shortJarPath(row.jarPath)}
                  </td>
                  <td className="px-2 text-center">
                    <span
                      className={
                        online
                          ? "inline-block rounded-control bg-success-soft px-1.5 py-0.5 text-[11px] font-medium leading-none text-success"
                          : "inline-block rounded-control bg-raised px-1.5 py-0.5 text-[11px] font-medium leading-none text-muted"
                      }
                    >
                      {online ? "在线" : "离线"}
                    </span>
                  </td>
                  <td
                    className="px-2 text-center"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {canSubscribeNotify(row.service) ? (
                      <input
                        type="checkbox"
                        checked={subscribed(row.service)}
                        title="写入通知订阅设置"
                        onChange={(event) =>
                          onToggleSubscribe(row.service, event.target.checked)
                        }
                      />
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>
                  <td
                    className="px-2 text-center"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {canShutdown(row) ? (
                      <button
                        type="button"
                        className="text-[12px] font-medium text-danger opacity-80 hover:opacity-100"
                        onClick={() => onShutdown(row)}
                      >
                        下架
                      </button>
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
  const [msg, setMsg] = useState("");
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
      setMsg(formatErr(e));
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
    setMsg("");
    await Promise.all([instances.refetch(), status.refetch()]);
  }

  async function openCfg() {
    setMsg("");
    try {
      const w = await api.agentGetWatch(host);
      setYamlText(w.yaml || "");
      setCfgOpen(true);
    } catch (e) {
      setMsg(formatErr(e));
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
      setMsg("监视配置已下发");
      await refreshAll();
    } catch (e) {
      setMsg(formatErr(e));
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
      setMsg(r.msg || (r.ok ? "已发起下架" : "下架失败"));
      setShutdownTarget(null);
      setTimeout(() => {
        void refreshAll();
      }, 1500);
    } catch (e) {
      setMsg(formatErr(e));
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
      actions={
        <>
          <Button onClick={() => void refreshAll()}>刷新</Button>
          <Button onClick={() => void openCfg()}>监视配置</Button>
        </>
      }
    >
      {instances.error ? <Notice text={formatErr(instances.error)} /> : null}
      {status.error ? <Notice text={formatErr(status.error)} /> : null}
      {msg ? <Notice text={msg} tone="warn" /> : null}

      {sections.length === 0 && !instances.isLoading ? (
        <div className="py-8 text-center text-sm text-muted">暂无监视实例</div>
      ) : (
        <div className="flex min-h-0 flex-col gap-2">
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
        <DialogContent className="w-[min(860px,calc(100%-32px))] max-h-[90vh] overflow-auto">
          <DialogTitle>
            {selectedService ? `${selectedService} · 对照（近 1 小时）` : "曲线"}
          </DialogTitle>
          <div className="mt-3 space-y-3">
            {isBun ? (
              <>
                <ChartHost option={rssOption} height={200} />
                <ChartHost option={cpuOption} height={160} />
              </>
            ) : (
              <>
                <ChartHost option={heapOption} height={200} />
                <ChartHost option={gcOption} height={160} />
              </>
            )}
            <ChartHost option={hostOption} height={160} />
            {events.length ? (
              <div className="overflow-auto border border-line bg-surface">
                <table className="w-full border-collapse text-left text-sm">
                  <thead className="bg-raised">
                    <tr className="h-10">
                      <th className="px-3 font-medium">序</th>
                      <th className="px-3 font-medium">层</th>
                      <th className="px-3 font-medium">类型</th>
                      <th className="px-3 font-medium">说明</th>
                    </tr>
                  </thead>
                  <tbody>
                    {events.map((e, i) => (
                      <tr key={`${e.ts}-${i}`} className="h-10 border-t border-line">
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
            className="mt-3 h-64 w-full rounded-control border border-line bg-canvas p-3 font-mono text-xs"
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
