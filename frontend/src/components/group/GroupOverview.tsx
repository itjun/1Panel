import { Cpu, HardDrive, MemoryStick, Activity, AlertCircle } from "lucide-react";
import {
  Card,
  CardContent,
} from "@/components/ui/card";
import { Progress } from "@/components/overview/Progress";
import { DistroLogo } from "@/components/common/DistroLogo";
import { api } from "@/lib/api";
import { usePolling } from "@/hooks/usePolling";
import { cn, formatBytes } from "@/lib/utils";
import type { main } from "@wailsjs/go/models";

interface GroupOverviewProps {
  groupID: string;
  groupName: string;
  onPickHost: (host: string) => void;
}

// 预警阈值（行业常规）
const THRESHOLDS = {
  cpu: 80,
  mem: 85,
  disk: 90,
  loadRatio: 1.0, // load1 / cpu核数
};

export function GroupOverview({
  groupID,
  groupName,
  onPickHost,
}: GroupOverviewProps) {
  // 只采当前分组，避免全量扫导致长时间「加载中」
  const { data: group, error, loading } = usePolling<main.GroupOverview>(
    () => api.listOneGroupOverview(groupID),
    5000,
    [groupID]
  );

  if (loading && !group) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
        加载中...
      </div>
    );
  }
  if (error && !group) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-destructive">
        加载失败: {error}
      </div>
    );
  }
  if (!group || !group.hosts || group.hosts.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
        分组「{groupName}」暂无主机
      </div>
    );
  }

  const okCount = group.hosts.filter((h) => !h.error && !isHostAlert(h)).length;
  const alertCount = group.hosts.filter(
    (h) => !h.error && isHostAlert(h)
  ).length;
  const errCount = group.hosts.filter((h) => h.error).length;

  return (
    <div className="h-full overflow-auto pr-1">
      {/* 分组摘要条 */}
      <div className="mb-3 flex items-center gap-4 px-1 text-xs">
        <span className="font-semibold text-foreground">{groupName}</span>
        <span className="text-muted-foreground">
          共 {group.hosts.length} 台
        </span>
        <span className="text-success">正常 {okCount}</span>
        {alertCount > 0 && (
          <span className="text-warning">告警 {alertCount}</span>
        )}
        {errCount > 0 && (
          <span className="text-destructive">连接失败 {errCount}</span>
        )}
      </div>

      {/* 卡片网格 */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 2xl:grid-cols-4">
        {group.hosts.map((h) => (
          <HostCard key={h.name} host={h} onPick={() => onPickHost(h.name)} />
        ))}
      </div>
    </div>
  );
}

function HostCard({
  host,
  onPick,
}: {
  host: main.HostOverviewSnapshot;
  onPick: () => void;
}) {
  const error = host.error;
  const isAlert = !error && isHostAlert(host);

  return (
    <Card
      onClick={onPick}
      className={cn(
        "group relative cursor-pointer p-4 transition-all hover:-translate-y-0.5 hover:shadow-lg",
        error && "border-destructive/50",
        isAlert && "border-warning/60",
        !error && !isAlert && "hover:border-primary/40"
      )}
    >
      {/* 状态指示灯 */}
      <div
        className={cn(
          "absolute right-3 top-3 h-2 w-2 rounded-full",
          error
            ? "bg-destructive"
            : isAlert
            ? "bg-warning"
            : "bg-success"
        )}
        title={
          error ? "连接失败" : isAlert ? "存在告警" : "全部正常"
        }
      />

      <div className="flex items-start gap-3">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-secondary">
          {error ? (
            <AlertCircle className="h-6 w-6 text-destructive" />
          ) : (
            <DistroLogo
              osRelease={host.overview.osRelease}
              size={28}
            />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="truncate text-sm font-semibold">{host.name}</div>
          <div className="truncate text-[10px] text-muted-foreground">
            {error ? (
              <span className="text-destructive">{error}</span>
            ) : (
              host.overview.osRelease || host.hostName
            )}
          </div>
          {!error && (
            <div className="mt-0.5 text-[10px] text-muted-foreground">
              {host.overview.cpuCount} 核 ·{" "}
              {formatBytes(host.overview.memTotal)}
            </div>
          )}
        </div>
      </div>

      {!error && (
        <div className="mt-3 space-y-1.5">
          <MetricRow
            icon={<Cpu className="h-3 w-3" />}
            label="CPU"
            percent={host.overview.cpuPercent}
            alert={host.overview.cpuPercent > THRESHOLDS.cpu}
            display={`${host.overview.cpuPercent.toFixed(1)}%`}
          />
          <MetricRow
            icon={<MemoryStick className="h-3 w-3" />}
            label="MEM"
            percent={host.overview.memPercent}
            alert={host.overview.memPercent > THRESHOLDS.mem}
            display={`${host.overview.memPercent.toFixed(1)}%`}
            sub={`${formatBytes(host.overview.memUsed)}`}
          />
          <MetricRow
            icon={<HardDrive className="h-3 w-3" />}
            label="DISK"
            percent={host.disks?.[0]?.percent ?? 0}
            alert={(host.disks?.[0]?.percent ?? 0) > THRESHOLDS.disk}
            display={`${(host.disks?.[0]?.percent ?? 0).toFixed(1)}%`}
            sub={
              host.disks?.[0]
                ? `${formatBytes(host.disks[0].used)}`
                : undefined
            }
          />
          <MetricRow
            icon={<Activity className="h-3 w-3" />}
            label="LOAD"
            percent={
              host.overview.cpuCount > 0
                ? Math.min(
                    100,
                    (host.overview.load1 / host.overview.cpuCount) * 50
                  )
                : 0
            }
            alert={
              host.overview.cpuCount > 0 &&
              host.overview.load1 / host.overview.cpuCount >
                THRESHOLDS.loadRatio
            }
            display={host.overview.load1.toFixed(2)}
            sub={`/ ${host.overview.cpuCount}`}
          />
        </div>
      )}
    </Card>
  );
}

function MetricRow({
  icon,
  label,
  percent,
  alert,
  display,
  sub,
}: {
  icon: React.ReactNode;
  label: string;
  percent: number;
  alert: boolean;
  display: string;
  sub?: string;
}) {
  return (
    <div className="flex items-center gap-2 text-[11px]">
      <span className="flex w-10 items-center gap-1 text-muted-foreground">
        {icon}
        {label}
      </span>
      <span className="flex-1">
        <Progress
          value={Math.min(100, percent)}
          className="h-1"
          colorClass={
            alert ? "bg-destructive" : ""
          }
        />
      </span>
      <span
        className={cn(
          "w-12 text-right tabular-nums",
          alert ? "text-destructive font-medium" : "text-foreground"
        )}
      >
        {display}
      </span>
      {sub && (
        <span className="w-16 text-right tabular-nums text-[10px] text-muted-foreground">
          {sub}
        </span>
      )}
    </div>
  );
}

// isHostAlert 判断一台主机是否处于告警状态（任一指标超阈值）
function isHostAlert(h: main.HostOverviewSnapshot): boolean {
  if (h.error) return false;
  if (h.overview.cpuPercent > THRESHOLDS.cpu) return true;
  if (h.overview.memPercent > THRESHOLDS.mem) return true;
  if ((h.disks?.[0]?.percent ?? 0) > THRESHOLDS.disk) return true;
  if (
    h.overview.cpuCount > 0 &&
    h.overview.load1 / h.overview.cpuCount > THRESHOLDS.loadRatio
  )
    return true;
  return false;
}
