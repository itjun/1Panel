import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api";
import { agentInstall, openAgentInstall, useAgentInstall } from "@/react/state/agent-install";
import { AgentInstallProgress } from "@/react/components/agent-install-progress";
import { Button } from "@/react/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/react/components/ui/dialog";

export function AgentInstallDialogHost() {
  const task = useAgentInstall();
  const client = useQueryClient();
  const isRunning = task.phase === "running";
  const isConfirm = task.phase === "confirm";
  const isDone = task.phase === "done";
  const latest = useQuery({
    queryKey: ["agent-latest"], queryFn: () => api.agentLatestVersion(),
    enabled: task.phase !== "idle",
  });
  const failed = task.rows.filter(row => row.state === "error");
  const completed = task.rows.filter(row => row.state === "done").length;

  useEffect(() => {
    if (task.phase !== "done") return;
    for (const key of ["agent-status", "overview", "disks", "net", "group-overview", "overview-history", "workbench-history"]) {
      void client.invalidateQueries({ queryKey: [key] });
    }
  }, [client, task.phase]);

  return (
    <Dialog open={task.phase !== "idle"} onOpenChange={isOpen => { if (!isOpen) agentInstall.close(); }}>
      <DialogContent className="w-[min(560px,calc(100vw-32px))]"
        onEscapeKeyDown={event => { if (isRunning) event.preventDefault(); }}
        onPointerDownOutside={event => { if (isRunning) event.preventDefault(); }}>
        <DialogTitle>安装 Agent</DialogTitle>
        <DialogDescription>
          {isConfirm
            ? `将向以下 ${task.rows.length} 台主机安装${latest.data ? ` v${latest.data}` : "面板内置版本"}，已安装的更新到此版本；最新版本自动跳过，历史数据保留。`
            : isRunning ? `正在安装 · 已结束 ${completed + failed.length}/${task.rows.length} 台`
              : `安装结束 · ${completed} 台完成${failed.length ? `，${failed.length} 台失败` : ""}`}
        </DialogDescription>
        <div className="mt-4 max-h-[min(52vh,420px)] space-y-5 overflow-auto">
          {task.rows.map(row => (
            <div key={row.host} className="min-w-0 space-y-2.5">
              <div className="flex items-start justify-between gap-3 text-sm">
                <span className="min-w-0 break-all font-semibold">{row.host}</span>
                {!isConfirm ? <span className={`shrink-0 text-xs ${row.state === "error" ? "text-danger" : row.state === "done" ? "text-success-text" : "text-muted"}`}>
                  {row.state === "done" ? "✓ 完成" : row.state === "error" ? "× 失败" : row.state === "pending" ? "等待安装" : "安装中"}
                </span> : null}
              </div>
              <AgentInstallProgress row={row} />
              {!isConfirm ? <p role={row.state === "error" ? "alert" : "status"}
                className={`break-words text-xs ${row.state === "error" ? "text-danger" : "text-muted"}`}>
                {row.text}
              </p> : null}
            </div>
          ))}
        </div>
        <DialogFooter>
          {isConfirm ? <>
            <Button onClick={() => agentInstall.close()}>取消</Button>
            <Button variant="primary" onClick={() => void agentInstall.start()}>开始安装</Button>
          </> : isRunning ? <Button variant="primary" disabled>安装中…</Button> : isDone ? <>
            {failed.length ? <Button onClick={() => openAgentInstall(failed.map(row => row.host))}>重试失败主机</Button> : null}
            <Button variant="primary" onClick={() => agentInstall.close()}>完成</Button>
          </> : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
