import { useQuery } from "@tanstack/react-query";
import { Server, Terminal } from "lucide-react";
import { api } from "@/api";
import { DistroBadge } from "@/react/components/distro-badge";
import { Button } from "@/react/components/ui/button";
import { FlashNotices } from "@/react/components/page";
import { useFlashMessage } from "@/react/lib/use-flash-message";
import { readSettings } from "@/react/state/settings";
import { formatErr } from "@/utils/format";
import { collectionState } from "@/utils/collectionState";
import { useSession } from "@/react/state/session";

export function HostWorkbenchHeader({ host }: { host: string }) {
  const session = useSession();
  const flash = useFlashMessage();
  const query = useQuery({
    queryKey: ["overview", host],
    queryFn: () => api.collectOverview(host),
    refetchInterval: 5000,
  });
  const data = query.data;
  const agent = useQuery({ queryKey: ["agent-status", host], queryFn: () => api.agentStatus(host) });
  const status = collectionState(query, !!agent.data && !agent.data.ok);
  return (
    <header className="host-workbench-heading">
      {data?.osRelease ? <DistroBadge boxSize={44} osRelease={data.osRelease} /> : <Server size={44} className="shrink-0 text-muted" aria-label="系统未知" />}
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-xl font-semibold">{host}</h1>
        <p className="mt-1 truncate text-xs text-muted" title={data?.osRelease}>
          {data?.osRelease || (status.unavailable ? "系统信息暂不可用" : "正在读取系统信息…")}
        </p>
      </div>
      {session.activeTool !== "overview" && <span
        className={`text-xs ${status.unavailable ? "text-danger" : data ? "text-success-text" : "text-muted"}`}
      >
        {status.label}
      </span>}
      <Button
        onClick={() => {
          const s = readSettings();
          void api
            .openHostsInTerminal([host], s.terminalOpenMode, s.terminalApp)
            .catch((e) => flash.showError(formatErr(e)));
        }}
      >
        <Terminal size={16} />
        打开终端
      </Button>
      <FlashNotices flash={flash} />
    </header>
  );
}
