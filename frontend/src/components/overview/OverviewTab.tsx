import { useEffect, useState } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Progress } from "@/components/overview/Progress";
import { LoadBadge } from "@/components/overview/LoadBadge";
import { Sparkline } from "@/components/overview/Sparkline";
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
  MemoryStick,
} from "lucide-react";

interface OverviewTabProps {
  host: string;
}

export function OverviewTab({ host }: OverviewTabProps) {
  const { data, error, loading } = usePolling<monitor.Overview>(
    () => api.collectOverview(host),
    2000,
    [host]
  );
  const { data: disks, refresh: refreshDisks } = usePolling<monitor.DiskInfo[]>(
    () => api.collectDisks(host),
    30_000,
    [host]
  );

  // 历史值：用于做 sparkline 趋势
  const [cpuHist, setCpuHist] = useState<number[]>([]);
  const [memHist, setMemHist] = useState<number[]>([]);
  useEffect(() => {
    if (data) {
      setCpuHist((h) => [...h.slice(-59), data.cpuPercent]);
      setMemHist((h) => [...h.slice(-59), data.memPercent]);
    }
  }, [data]);

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
        </CardContent>
      </Card>

      {/* 核心 4 卡 */}
      <div className="grid grid-cols-2 gap-3">
        <MetricCard
          icon={<Cpu className="h-4 w-4" />}
          title="CPU 使用率"
          value={data.cpuPercent.toFixed(1) + "%"}
          hist={cpuHist}
          color="hsl(217 91% 60%)"
        />
        <MetricCard
          icon={<MemoryStick className="h-4 w-4" />}
          title="内存使用"
          value={`${data.memPercent.toFixed(1)}%`}
          sub={`${formatBytes(data.memUsed)} / ${formatBytes(data.memTotal)}`}
          hist={memHist}
          color="hsl(280 80% 60%)"
        />

        {/* Load */}
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

        {/* Swap */}
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

      {/* 磁盘 */}
      <div className="mt-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2">
              <HardDrive className="h-4 w-4" />
              磁盘
              <button
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
  hist,
  color,
}: {
  icon: React.ReactNode;
  title: string;
  value: string;
  sub?: string;
  hist: number[];
  color: string;
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
        <Sparkline data={hist} color={color} />
      </CardContent>
    </Card>
  );
}
