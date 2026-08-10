import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Progress } from "@/components/overview/Progress";
import { GaugeChart } from "@/components/overview/GaugeChart";
import {
  TrafficChart,
  bytesToKBps,
  type TrafficPoint,
} from "@/components/overview/TrafficChart";
import { LoadingState, ErrorState } from "@/components/overview/States";
import { Badge } from "@/components/ui/badge";
import { api } from "@/lib/api";
import { usePolling } from "@/hooks/usePolling";
import { cn, formatBytes } from "@/lib/utils";
import type { monitor } from "@wailsjs/go/models";
import {
  Box,
  HardDrive,
  Loader2,
  Pencil,
  RefreshCw,
  Save,
  Server,
  X,
} from "lucide-react";

interface OverviewTabProps {
  host: string;
}

/** 流量历史最多保留点数（约 5 分钟 @ 3s） */
const TRAFFIC_HISTORY_MAX = 100;
/** 概览轮询间隔：对齐 1Panel 实时感，但避免 1–2s 过密 */
const OVERVIEW_POLL_MS = 3000;

export function OverviewTab({ host }: OverviewTabProps) {
  const { data, error, loading, refresh } = usePolling<monitor.Overview>(
    () => api.collectOverview(host),
    OVERVIEW_POLL_MS,
    [host]
  );
  const { data: disks, refresh: refreshDisks } = usePolling<monitor.DiskInfo[]>(
    () => api.collectDisks(host),
    0,
    [host]
  );

  // Docker 列表作右侧「应用」替代（异步，不挡主视图）
  const [docker, setDocker] = useState<monitor.DockerInfo | null>(null);
  const [dockerLoading, setDockerLoading] = useState(false);

  // Top10 大文件
  const [largeFiles, setLargeFiles] = useState<monitor.LargeFilesResult | null>(
    null
  );
  const [lfLoading, setLfLoading] = useState(false);
  const [lfError, setLfError] = useState<string | null>(null);

  // 备忘录（本地 per-host）
  const memoKey = `ipannel.memo.${host}`;
  const [memo, setMemo] = useState(() => {
    try {
      return localStorage.getItem(memoKey) || "";
    } catch {
      return "";
    }
  });
  const [memoEditing, setMemoEditing] = useState(false);
  const [memoDraft, setMemoDraft] = useState(memo);

  // 流量历史
  const [traffic, setTraffic] = useState<TrafficPoint[]>([]);
  const [rates, setRates] = useState({ upBps: 0, downBps: 0 });
  const lastNetRef = useRef<{
    rx: number;
    tx: number;
    ts: number;
  } | null>(null);

  // host 切换时重置
  useEffect(() => {
    setTraffic([]);
    setRates({ upBps: 0, downBps: 0 });
    lastNetRef.current = null;
    setDocker(null);
    setLargeFiles(null);
    setMemoEditing(false);
    try {
      const m = localStorage.getItem(`ipannel.memo.${host}`) || "";
      setMemo(m);
      setMemoDraft(m);
    } catch {
      setMemo("");
      setMemoDraft("");
    }
  }, [host]);

  // 根据 overview 累计字节推算速率并写入历史
  useEffect(() => {
    if (!data) return;
    const now = Date.now();
    const rx = Number(data.netRxBytes) || 0;
    const tx = Number(data.netTxBytes) || 0;
    const prev = lastNetRef.current;
    lastNetRef.current = { rx, tx, ts: now };

    if (!prev || now <= prev.ts) return;
    // 计数器回绕或重启
    if (rx < prev.rx || tx < prev.tx) return;

    const deltaMs = now - prev.ts;
    const upKBps = bytesToKBps(tx - prev.tx, deltaMs);
    const downKBps = bytesToKBps(rx - prev.rx, deltaMs);
    setRates({
      upBps: ((tx - prev.tx) / deltaMs) * 1000,
      downBps: ((rx - prev.rx) / deltaMs) * 1000,
    });

    const time = new Date(now).toLocaleTimeString("zh-CN", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
    setTraffic((hist) => {
      const next = [...hist, { time, ts: now, up: upKBps, down: downKBps }];
      if (next.length > TRAFFIC_HISTORY_MAX) {
        return next.slice(next.length - TRAFFIC_HISTORY_MAX);
      }
      return next;
    });
  }, [data]);

  // 异步拉 Docker
  useEffect(() => {
    let cancelled = false;
    setDockerLoading(true);
    api
      .collectDocker(host)
      .then((d) => {
        if (!cancelled) setDocker(d);
      })
      .catch(() => {
        if (!cancelled) setDocker(null);
      })
      .finally(() => {
        if (!cancelled) setDockerLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [host]);

  // 异步大文件
  useEffect(() => {
    let cancelled = false;
    setLargeFiles(null);
    setLfError(null);
    setLfLoading(true);
    const timer = window.setTimeout(() => {
      api
        .collectLargestFiles(host, 10)
        .then((r) => {
          if (!cancelled) setLargeFiles(r);
        })
        .catch((e) => {
          if (!cancelled) setLfError(String(e));
        })
        .finally(() => {
          if (!cancelled) setLfLoading(false);
        });
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [host]);

  const saveMemo = useCallback(() => {
    setMemo(memoDraft);
    try {
      localStorage.setItem(memoKey, memoDraft);
    } catch {
      /* ignore */
    }
    setMemoEditing(false);
  }, [memoDraft, memoKey]);

  const refreshAll = () => {
    refresh();
    refreshDisks();
  };

  // 根分区磁盘
  const rootDisk = useMemo(() => {
    if (!disks || disks.length === 0) return null;
    return (
      disks.find((d) => d.mount === "/") ||
      disks.slice().sort((a, b) => b.total - a.total)[0]
    );
  }, [disks]);

  // 负载百分比：load1 / cpuCount * 100，封顶 100
  const loadPercent = useMemo(() => {
    if (!data || !data.cpuCount) return 0;
    return Math.min(100, (data.load1 / data.cpuCount) * 100);
  }, [data]);

  const loadLabel = useMemo(() => {
    if (!data) return "—";
    if (loadPercent < 50) return "运行流畅";
    if (loadPercent < 80) return "负载适中";
    return "负载较高";
  }, [data, loadPercent]);

  const dockerRunning = useMemo(
    () =>
      (docker?.containers || []).filter(
        (c) => (c.state || "").toLowerCase() === "running"
      ).length,
    [docker]
  );

  if (loading && !data) return <LoadingState />;
  if (error && !data) return <ErrorState message={error} />;
  if (!data) return null;

  const bootTime =
    data.uptime > 0
      ? new Date(Date.now() - data.uptime * 1000).toLocaleString("zh-CN", {
          hour12: false,
        })
      : "—";

  return (
    <div className="h-full overflow-auto pr-1">
      {/* 双栏：左 2/3 概览+状态+监控，右 1/3 系统信息+备忘+应用 */}
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
        {/* ========== 左栏 ========== */}
        <div className="flex flex-col gap-3 xl:col-span-2">
          {/* 概览：四个统计数字 */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2 pt-3">
              <CardTitle>
                <span className="panel-section-title">概览</span>
              </CardTitle>
              <button
                type="button"
                onClick={refreshAll}
                className="panel-link flex items-center gap-1"
              >
                <RefreshCw className="h-3 w-3" />
                刷新
              </button>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <StatCell
                  label="CPU 核心"
                  value={String(data.cpuCount || 0)}
                />
                <StatCell
                  label="磁盘分区"
                  value={String(disks?.length ?? "—")}
                />
                <StatCell
                  label="Docker 容器"
                  value={
                    dockerLoading && !docker
                      ? "…"
                      : String(docker?.containers?.length ?? 0)
                  }
                />
                <StatCell
                  label="运行中容器"
                  value={
                    dockerLoading && !docker ? "…" : String(dockerRunning)
                  }
                />
              </div>
            </CardContent>
          </Card>

          {/* 状态：四个环形仪表盘 */}
          <Card>
            <CardHeader className="pb-1 pt-3">
              <CardTitle>
                <span className="panel-section-title">状态</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {/* 1Panel status：polar 环（Pie.vue） */}
              <div className="grid grid-cols-2 gap-1 sm:grid-cols-4">
                <GaugeChart
                  value={loadPercent}
                  title="负载"
                  label={loadLabel}
                  subLabel={loadLabel}
                />
                <GaugeChart
                  value={data.cpuPercent}
                  title="CPU"
                  label="CPU"
                  subLabel={`( ${data.cpuPercent.toFixed(2)} / ${data.cpuCount} ) 核`}
                />
                <GaugeChart
                  value={data.memPercent}
                  title="内存"
                  label="内存"
                  subLabel={`${formatBytes(data.memUsed)} / ${formatBytes(data.memTotal)}`}
                />
                <GaugeChart
                  value={rootDisk?.percent ?? 0}
                  title={rootDisk?.mount || "/"}
                  label="磁盘"
                  subLabel={
                    rootDisk
                      ? `${formatBytes(rootDisk.used)} / ${formatBytes(rootDisk.total)}`
                      : "—"
                  }
                />
              </div>
            </CardContent>
          </Card>

          {/* 监控：流量面积图 */}
          <Card>
            <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 pb-2 pt-3">
              <CardTitle>
                <span className="panel-section-title">监控</span>
              </CardTitle>
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="panel-tag">
                  上行: {formatBytes(rates.upBps)}/s
                </span>
                <span className="panel-tag">
                  下行: {formatBytes(rates.downBps)}/s
                </span>
                <span className="panel-tag">
                  总发送: {formatBytes(Number(data.netTxBytes) || 0)}
                </span>
                <span className="panel-tag">
                  总接收: {formatBytes(Number(data.netRxBytes) || 0)}
                </span>
              </div>
            </CardHeader>
            <CardContent>
              <div className="mb-1 flex items-center gap-3 text-[11px] text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  <span className="inline-block h-2 w-2 rounded-full bg-primary" />
                  下行
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="inline-block h-2 w-2 rounded-full bg-warning" />
                  上行
                </span>
                <span className="ml-auto text-[10px]">
                  每 {OVERVIEW_POLL_MS / 1000}s 采样
                </span>
              </div>
              <TrafficChart data={traffic} height={240} />
            </CardContent>
          </Card>

          {/* 磁盘分区明细 */}
          <Card>
            <CardHeader className="pb-2 pt-3">
              <CardTitle className="flex items-center gap-2">
                <span className="panel-section-title">磁盘</span>
                <button
                  type="button"
                  onClick={refreshDisks}
                  className="panel-link ml-auto"
                >
                  刷新
                </button>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {(!disks || disks.length === 0) && (
                <div className="py-4 text-center text-xs text-muted-foreground">
                  {loading ? "加载中..." : "暂无磁盘数据"}
                </div>
              )}
              {(disks || []).map((d) => (
                <div
                  key={d.mount}
                  className="grid grid-cols-12 items-center gap-2 text-xs"
                >
                  <span className="col-span-3 truncate font-medium">
                    {d.mount}
                  </span>
                  <span className="col-span-5">
                    <Progress
                      value={d.percent}
                      className="h-1.5"
                      colorClass={
                        d.percent > 90
                          ? "bg-destructive"
                          : d.percent > 75
                          ? "bg-warning"
                          : ""
                      }
                    />
                  </span>
                  <span className="col-span-4 text-right tabular-nums text-muted-foreground">
                    {formatBytes(d.used)} / {formatBytes(d.total)}
                  </span>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        {/* ========== 右栏 ========== */}
        <div className="flex flex-col gap-3">
          {/* 系统信息 */}
          <Card>
            <CardHeader className="pb-2 pt-3">
              <CardTitle className="flex items-center gap-2">
                <span className="panel-section-title">系统信息</span>
                <Server className="ml-auto h-3.5 w-3.5 text-muted-foreground" />
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <InfoTable
                rows={[
                  { label: "主机名称", value: data.hostname || host },
                  { label: "发行版本", value: data.osRelease || "—" },
                  { label: "内核版本", value: data.kernel || "—" },
                  { label: "系统类型", value: data.arch || "—" },
                  { label: "主机地址", value: data.ipAddress || "—" },
                  { label: "CPU 型号", value: data.cpuModel || "—" },
                  { label: "启动时间", value: bootTime },
                  {
                    label: "运行时间",
                    value: formatDurationLong(data.uptime),
                  },
                ]}
              />
            </CardContent>
          </Card>

          {/* 备忘录 */}
          <Card>
            <CardHeader className="flex flex-row items-center pb-2 pt-3">
              <CardTitle>
                <span className="panel-section-title">备忘录</span>
              </CardTitle>
              <div className="ml-auto flex items-center gap-1">
                {memoEditing ? (
                  <>
                    <button
                      type="button"
                      onClick={saveMemo}
                      className="panel-link flex items-center gap-0.5"
                    >
                      <Save className="h-3 w-3" />
                      保存
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setMemoDraft(memo);
                        setMemoEditing(false);
                      }}
                      className="panel-link flex items-center gap-0.5 text-muted-foreground"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setMemoDraft(memo);
                      setMemoEditing(true);
                    }}
                    className="panel-link flex items-center gap-0.5"
                  >
                    <Pencil className="h-3 w-3" />
                    编辑
                  </button>
                )}
              </div>
            </CardHeader>
            <CardContent>
              {memoEditing ? (
                <textarea
                  autoFocus
                  value={memoDraft}
                  onChange={(e) => setMemoDraft(e.target.value)}
                  placeholder="记录此主机的备注信息…"
                  className="min-h-[100px] w-full resize-y rounded border border-input bg-card p-2 text-xs leading-relaxed text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary/20"
                />
              ) : (
                <div
                  className={cn(
                    "min-h-[80px] whitespace-pre-wrap text-xs leading-relaxed",
                    memo
                      ? "text-foreground"
                      : "text-muted-foreground"
                  )}
                >
                  {memo || "点击编辑按钮启用编辑"}
                </div>
              )}
            </CardContent>
          </Card>

          {/* 应用（Docker 容器列表） */}
          <Card className="flex min-h-0 flex-1 flex-col">
            <CardHeader className="pb-2 pt-3">
              <CardTitle className="flex items-center gap-2">
                <span className="panel-section-title">应用</span>
                <span className="ml-auto text-[11px] font-normal text-muted-foreground">
                  Docker
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {dockerLoading && !docker && (
                <div className="flex items-center justify-center gap-2 py-6 text-xs text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  加载容器…
                </div>
              )}
              {docker && !docker.available && (
                <div className="py-4 text-center text-xs text-muted-foreground">
                  目标机未检测到 Docker
                </div>
              )}
              {docker?.available &&
                (!docker.containers || docker.containers.length === 0) && (
                  <div className="py-4 text-center text-xs text-muted-foreground">
                    暂无容器
                  </div>
                )}
              {(docker?.containers || []).slice(0, 12).map((c) => {
                const running = (c.state || "").toLowerCase() === "running";
                return (
                  <div
                    key={c.id || c.name}
                    className="panel-card-selectable flex items-center gap-2.5 px-2.5 py-2"
                  >
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded bg-primary-soft text-primary">
                      <Box className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] font-medium">
                        {c.name || c.id?.slice(0, 12)}
                      </div>
                      <div className="truncate text-[11px] text-muted-foreground">
                        {c.image || c.status || "—"}
                      </div>
                    </div>
                    <Badge
                      variant={running ? "soft" : "outline"}
                      className="shrink-0 text-[10px]"
                    >
                      {running ? "运行中" : c.state || "停止"}
                    </Badge>
                  </div>
                );
              })}
            </CardContent>
          </Card>

          {/* 最大文件 Top10（压缩展示） */}
          <Card>
            <CardHeader className="pb-2 pt-3">
              <CardTitle className="flex items-center gap-2">
                <span className="panel-section-title">最大文件</span>
                <HardDrive className="h-3.5 w-3.5 text-muted-foreground" />
                <button
                  type="button"
                  onClick={() => {
                    setLfLoading(true);
                    setLfError(null);
                    api
                      .collectLargestFiles(host, 10)
                      .then(setLargeFiles)
                      .catch((e) => setLfError(String(e)))
                      .finally(() => setLfLoading(false));
                  }}
                  disabled={lfLoading}
                  className="panel-link ml-auto flex items-center gap-1 disabled:opacity-50"
                >
                  {lfLoading ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <RefreshCw className="h-3 w-3" />
                  )}
                  {lfLoading ? "扫描中…" : "扫描"}
                </button>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {lfLoading && !largeFiles && (
                <div className="flex items-center justify-center gap-2 py-4 text-xs text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  后台扫描…
                </div>
              )}
              {lfError && !largeFiles && (
                <div className="py-3 text-center text-xs text-destructive">
                  {lfError}
                </div>
              )}
              {largeFiles &&
                (!largeFiles.files || largeFiles.files.length === 0) && (
                  <div className="py-3 text-center text-xs text-muted-foreground">
                    {largeFiles.message || "暂无数据"}
                  </div>
                )}
              {(largeFiles?.files || []).slice(0, 8).map((f) => (
                <div
                  key={f.path}
                  className="flex items-center gap-2 border-b border-border/50 py-1.5 text-xs last:border-0"
                >
                  <span className="min-w-0 flex-1 truncate" title={f.path}>
                    {f.name}
                  </span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">
                    {formatBytes(f.size)}
                  </span>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function StatCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col items-center justify-center rounded border border-card-border bg-primary-soft/30 px-2 py-3">
      <span className="text-[12px] text-muted-foreground">{label}</span>
      <button
        type="button"
        className="mt-1 text-[18px] font-medium tabular-nums text-primary"
      >
        {value}
      </button>
    </div>
  );
}

function InfoTable({
  rows,
}: {
  rows: { label: string; value: string }[];
}) {
  return (
    <table className="w-full text-left text-[13px]">
      <tbody>
        {rows.map((r) => (
          <tr
            key={r.label}
            className="border-b border-border/60 last:border-0"
          >
            <td className="w-[88px] whitespace-nowrap px-4 py-2 text-muted-foreground">
              {r.label}
            </td>
            <td
              className="max-w-0 truncate px-3 py-2 font-medium text-foreground"
              title={r.value}
            >
              {r.value}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** 1Panel 风格长时长：X天 X小时 X分钟 */
function formatDurationLong(seconds: number): string {
  if (!seconds || seconds <= 0) return "—";
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const parts: string[] = [];
  if (d > 0) parts.push(`${d}天`);
  if (h > 0 || d > 0) parts.push(`${h}小时`);
  if (m > 0 || h > 0 || d > 0) parts.push(`${m}分钟`);
  parts.push(`${s}秒`);
  return parts.join(" ");
}
