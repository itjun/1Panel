import { useEffect, useState } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Progress } from "@/components/overview/Progress";
import { LoadBadge } from "@/components/overview/LoadBadge";
import { LoadingState, ErrorState } from "@/components/overview/States";
import { api } from "@/lib/api";
import { usePolling } from "@/hooks/usePolling";
import { formatBytes, formatDuration } from "@/lib/utils";
import type { monitor } from "@wailsjs/go/models";
import {
  Activity,
  Clock,
  Cpu,
  HardDrive,
  Loader2,
  MemoryStick,
  RefreshCw,
} from "lucide-react";

interface OverviewTabProps {
  host: string;
}

export function OverviewTab({ host }: OverviewTabProps) {
  // 仅进入页面时拉一次；不做 2s 秒级轮询（太卡）
  const { data, error, loading, refresh } = usePolling<monitor.Overview>(
    () => api.collectOverview(host),
    0,
    [host]
  );
  const { data: disks, refresh: refreshDisks } = usePolling<monitor.DiskInfo[]>(
    () => api.collectDisks(host),
    0,
    [host]
  );

  // Top10 大文件：概览打开后异步加载，不挡主卡片
  const [largeFiles, setLargeFiles] = useState<monitor.LargeFilesResult | null>(
    null
  );
  const [lfLoading, setLfLoading] = useState(false);
  const [lfError, setLfError] = useState<string | null>(null);

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

  const rescanLargeFiles = () => {
    setLfLoading(true);
    setLfError(null);
    api
      .collectLargestFiles(host, 10)
      .then(setLargeFiles)
      .catch((e) => setLfError(String(e)))
      .finally(() => setLfLoading(false));
  };

  const refreshAll = () => {
    refresh();
    refreshDisks();
  };

  if (loading && !data) return <LoadingState />;
  if (error && !data) return <ErrorState message={error} />;
  if (!data) return null;

  return (
    <div className="h-full overflow-auto pr-1">
      {/* 主机摘要 */}
      <Card className="mb-3">
        <CardContent className="flex flex-wrap items-center gap-x-6 gap-y-2 p-4">
          <InfoCell label="操作系统" value={data.osRelease || "—"} />
          <InfoCell label="内核" value={data.kernel || "—"} />
          <InfoCell
            label="CPU 型号"
            value={`${data.cpuCount} 核 · ${data.cpuModel || "—"}`}
          />
          <InfoCell
            label="运行时长"
            value={
              <span className="flex items-center gap-1">
                <Clock className="h-3 w-3 text-muted-foreground" />
                {formatDuration(data.uptime)}
              </span>
            }
          />
          <button
            type="button"
            onClick={refreshAll}
            className="ml-auto flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[10px] text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <RefreshCw className="h-3 w-3" />
            刷新指标
          </button>
        </CardContent>
      </Card>

      {/* 核心 4 卡：瞬时值，无曲线、无秒级监听 */}
      <div className="grid grid-cols-2 gap-3">
        <MetricCard
          icon={<Cpu className="h-4 w-4" />}
          title="CPU 使用率"
          value={data.cpuPercent.toFixed(1) + "%"}
        >
          <Progress value={data.cpuPercent} className="h-1.5" />
        </MetricCard>
        <MetricCard
          icon={<MemoryStick className="h-4 w-4" />}
          title="内存使用"
          value={`${data.memPercent.toFixed(1)}%`}
          sub={`${formatBytes(data.memUsed)} / ${formatBytes(data.memTotal)}`}
        >
          <Progress value={data.memPercent} className="h-1.5" />
        </MetricCard>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2">
              <Activity className="h-4 w-4" />
              系统负载
            </CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-3 gap-2">
            <LoadBox label="1 min" value={data.load1} cpus={data.cpuCount} />
            <LoadBox label="5 min" value={data.load5} cpus={data.cpuCount} />
            <LoadBox label="15 min" value={data.load15} cpus={data.cpuCount} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2">
              <MemoryStick className="h-4 w-4" />
              Swap
            </CardTitle>
          </CardHeader>
          <CardContent>
            {data.swapTotal === 0 ? (
              <span className="text-xs text-muted-foreground">未启用 Swap</span>
            ) : (
              <>
                <div className="mb-2 flex items-baseline justify-between">
                  <span className="text-2xl font-semibold tabular-nums">
                    {data.swapPercent.toFixed(1)}%
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    {formatBytes(data.swapUsed)} / {formatBytes(data.swapTotal)}
                  </span>
                </div>
                <Progress value={data.swapPercent} className="h-1.5" />
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* 磁盘分区 */}
      <div className="mt-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2">
              <HardDrive className="h-4 w-4" />
              磁盘
              <button
                type="button"
                onClick={refreshDisks}
                className="ml-auto text-[10px] font-normal text-muted-foreground hover:text-foreground"
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
                <span className="col-span-3 truncate font-medium">{d.mount}</span>
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

      {/* Top10 大文件（异步） */}
      <div className="mt-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2">
              <HardDrive className="h-4 w-4" />
              最大文件 Top 10
              <button
                type="button"
                onClick={rescanLargeFiles}
                disabled={lfLoading}
                className="ml-auto flex items-center gap-1 text-[10px] font-normal text-muted-foreground hover:text-foreground disabled:opacity-50"
              >
                {lfLoading ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <RefreshCw className="h-3 w-3" />
                )}
                {lfLoading ? "扫描中…" : "重新扫描"}
              </button>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {lfLoading && !largeFiles && (
              <div className="flex items-center justify-center gap-2 py-6 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                后台扫描根分区大文件…
              </div>
            )}
            {lfError && !largeFiles && (
              <div className="py-4 text-center text-xs text-destructive">
                {lfError}
              </div>
            )}
            {largeFiles && (
              <>
                {(largeFiles.incomplete || largeFiles.message) && (
                  <div className="mb-2 rounded-md bg-warning/10 px-2 py-1 text-[10px] text-warning">
                    {largeFiles.message || "扫描未完成，结果可能不完整"}
                    {largeFiles.elapsedMs > 0 &&
                      ` · 耗时 ${(largeFiles.elapsedMs / 1000).toFixed(1)}s`}
                  </div>
                )}
                {(!largeFiles.files || largeFiles.files.length === 0) && (
                  <div className="py-4 text-center text-xs text-muted-foreground">
                    {largeFiles.message || "暂无数据"}
                  </div>
                )}
                {(largeFiles.files || []).length > 0 && (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead>
                        <tr className="border-b border-border text-[10px] text-muted-foreground">
                          <th className="pb-1.5 pr-2 font-medium">文件</th>
                          <th className="pb-1.5 pr-2 font-medium">所在目录</th>
                          <th className="pb-1.5 text-right font-medium">大小</th>
                        </tr>
                      </thead>
                      <tbody>
                        {largeFiles.files.map((f) => (
                          <tr
                            key={f.path}
                            className="border-b border-border/50 last:border-0"
                          >
                            <td
                              className="max-w-[140px] truncate py-1.5 pr-2 font-medium"
                              title={f.path}
                            >
                              {f.name}
                            </td>
                            <td
                              className="max-w-[220px] truncate py-1.5 pr-2 text-muted-foreground"
                              title={f.dir}
                            >
                              {f.dir}
                            </td>
                            <td className="py-1.5 text-right tabular-nums">
                              {formatBytes(f.size)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function InfoCell({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex flex-col">
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span className="text-sm font-medium">{value}</span>
    </div>
  );
}

function LoadBox({
  label,
  value,
  cpus,
}: {
  label: string;
  value: number;
  cpus: number;
}) {
  return (
    <div className="flex flex-col items-center rounded-md border border-border p-2">
      <span className="text-[10px] text-muted-foreground">{label}</span>
      <span className="text-base font-semibold tabular-nums">
        {value.toFixed(2)}
      </span>
      <LoadBadge value={value} cpus={cpus} />
    </div>
  );
}

function MetricCard({
  icon,
  title,
  value,
  sub,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  value: string;
  sub?: string;
  children?: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2">
          {icon}
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="mb-2 flex items-baseline justify-between">
          <span className="text-2xl font-semibold tabular-nums">{value}</span>
          {sub && (
            <span className="text-[10px] text-muted-foreground">{sub}</span>
          )}
        </div>
        {children}
      </CardContent>
    </Card>
  );
}
