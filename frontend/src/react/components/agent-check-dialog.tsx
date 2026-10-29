import { useQuery } from "@tanstack/react-query";
import { api } from "@/api";
import { AgentCheckReport } from "@/react/components/agent-check-report";
import { Button } from "@/react/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogTitle } from "@/react/components/ui/dialog";
import { formatErr } from "@/utils/format";
import { agentRepairFor } from "@/utils/agentFleetCheck";
import { startAgentRepair, useAgentInstall } from "@/react/state/agent-install";

export function AgentCheckDialog({ host, onClose }: { host: string; onClose: () => void }) {
  return (
    <Dialog open={!!host} onOpenChange={isOpen => { if (!isOpen) onClose(); }}>
      {host ? <AgentCheckContent key={host} host={host} onClose={onClose} /> : null}
    </Dialog>
  );
}

function AgentCheckContent({ host, onClose }: { host: string; onClose: () => void }) {
  // 按主机隔离结果；关闭后切换主机，旧请求的迟到结果不会覆盖当前报告。
  const query = useQuery({
    queryKey: ["agent-check", host],
    queryFn: () => api.checkAgent(host),
    retry: false,
    refetchOnMount: "always",
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  const isChecking = query.isPending || query.isFetching;
  const installTask = useAgentInstall();
  const latest = useQuery({ queryKey: ["agent-latest"], queryFn: () => api.agentLatestVersion() });
  const repair = query.data ? agentRepairFor(query.data, latest.data || "") : "none";

  return (
    <DialogContent aria-describedby={undefined} className="w-[min(560px,calc(100vw-32px))]">
      <DialogTitle className="break-words text-base font-semibold text-ink">检查 Agent · {host}</DialogTitle>
      {isChecking ? (
        <p role="status" className="mt-4 text-sm text-muted">正在检查 Agent…</p>
      ) : query.isError ? (
        <p role="alert" className="mt-4 whitespace-pre-wrap break-words text-sm text-danger">
          检查失败：{formatErr(query.error)}
        </p>
      ) : query.data ? <AgentCheckReport report={query.data} /> : null}
      <DialogFooter>
        <Button disabled={isChecking} onClick={() => void query.refetch({ cancelRefetch: false })}>
          {isChecking ? "检查中" : "重新检查"}
        </Button>
        <Button onClick={onClose}>关闭</Button>
        {repair !== "none" ? <Button variant="primary" disabled={isChecking || installTask.phase === "running"} onClick={() => {
          startAgentRepair([{ host, action: repair }]);
          onClose();
        }}>立即处理</Button> : null}
      </DialogFooter>
    </DialogContent>
  );
}
