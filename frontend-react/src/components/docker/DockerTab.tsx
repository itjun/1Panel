import {
  Activity,
  Boxes,
  Play,
  RotateCcw,
  Square,
} from "lucide-react";
import { useState } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/overview/Progress";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { api } from "@/lib/api";
import { usePolling } from "@/hooks/usePolling";
import { cn, formatBytes } from "@/lib/utils";
import type { monitor } from "@wailsjs/go/models";
import { LoadingState, ErrorState } from "@/components/overview/States";

interface DockerTabProps {
  host: string;
}

export function DockerTab({ host }: DockerTabProps) {
  const { data, error, loading, refresh } = usePolling<monitor.DockerInfo>(
    () => api.collectDocker(host),
    5000,
    [host]
  );

  if (loading && !data) return <LoadingState />;
  if (error && !data) return <ErrorState message={error} />;
  if (!data) return null;

  if (!data.available) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <Boxes className="mx-auto mb-2 h-8 w-8 text-muted-foreground" />
          <div className="text-sm font-medium">目标机未安装 Docker</div>
          <div className="mt-1 text-xs text-muted-foreground">
            或当前用户没有 docker 使用权限
          </div>
        </div>
      </div>
    );
  }

  // 把 container 与 stat 关联
  const statMap = new Map((data.stats || []).map((s) => [s.name, s]));

  return (
    <div className="h-full overflow-auto pr-1">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs text-muted-foreground">
          共 {data.containers?.length || 0} 个容器
        </span>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-[11px]"
          onClick={refresh}
        >
          刷新
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {(data.containers || []).map((c) => {
          const stat = statMap.get(c.name);
          const running = c.state === "running";
          return (
            <Card key={c.id}>
              <CardHeader className="pb-2">
                <div className="flex items-center gap-2">
                  <span
                    className={cn(
                      "h-2 w-2 rounded-full",
                      running ? "bg-success" : "bg-muted-foreground"
                    )}
                  />
                  <CardTitle className="flex-1 truncate text-xs">
                    {c.name}
                  </CardTitle>
                  <StateBadge state={c.state} />
                  <ContainerActions host={host} container={c.name} running={running} onDone={refresh} />
                </div>
                <div className="truncate text-[10px] text-muted-foreground">
                  {c.image}
                </div>
              </CardHeader>
              <CardContent className="space-y-1.5">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="flex items-center gap-1 text-muted-foreground">
                    <Activity className="h-3 w-3" />
                    CPU
                  </span>
                  <span
                    className={cn(
                      "tabular-nums font-medium",
                      (stat?.cpuPercent || 0) > 80 ? "text-warning" : ""
                    )}
                  >
                    {(stat?.cpuPercent || 0).toFixed(2)}%
                  </span>
                </div>
                <div>
                  <div className="mb-1 flex items-center justify-between text-[11px]">
                    <span className="text-muted-foreground">内存</span>
                    <span className="tabular-nums">
                      {formatBytes(stat?.memUsage || 0)} /{" "}
                      {formatBytes(stat?.memLimit || 0)}
                    </span>
                  </div>
                  <Progress
                    value={stat?.memPercent || 0}
                    className="h-1"
                  />
                </div>
                <div className="flex items-center justify-between pt-1 text-[10px] text-muted-foreground">
                  <span>
                    Net ↑{formatBytes(stat?.netOut || 0)} ↓
                    {formatBytes(stat?.netIn || 0)}
                  </span>
                  <span>
                    IO R:{formatBytes(stat?.blockIn || 0)} W:
                    {formatBytes(stat?.blockOut || 0)}
                  </span>
                </div>
                <div className="truncate pt-1 text-[10px] text-muted-foreground" title={c.status}>
                  {c.status}
                </div>
              </CardContent>
            </Card>
          );
        })}
        {data.containers?.length === 0 && (
          <div className="col-span-2 py-16 text-center text-xs text-muted-foreground">
            没有正在运行的容器
          </div>
        )}
      </div>
    </div>
  );
}

function StateBadge({ state }: { state: string }) {
  const map: Record<string, "success" | "warning" | "secondary" | "destructive"> = {
    running: "success",
    paused: "warning",
    exited: "secondary",
    created: "secondary",
    restarting: "warning",
    dead: "destructive",
  };
  return (
    <Badge variant={map[state] || "secondary"} className="h-4 px-1.5 text-[9px]">
      {state}
    </Badge>
  );
}

function ContainerActions({
  host,
  container,
  running,
  onDone,
}: {
  host: string;
  container: string;
  running: boolean;
  onDone: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const run = async (action: "start" | "stop" | "restart") => {
    setBusy(true);
    try {
      await api.dockerAction(host, action, container);
      onDone();
    } catch (e) {
      alert(`操作失败: ${e}`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-5 w-5"
          disabled={busy}
        >
          <span className="text-xs">⋯</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          onClick={() => run("start")}
          disabled={running}
        >
          <Play className="h-3.5 w-3.5" />
          启动
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => run("stop")}
          disabled={!running}
        >
          <Square className="h-3.5 w-3.5" />
          停止
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => run("restart")}>
          <RotateCcw className="h-3.5 w-3.5" />
          重启
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
