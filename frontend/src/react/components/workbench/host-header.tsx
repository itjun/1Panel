import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { Server, Terminal } from "lucide-react";
import { api } from "@/api";
import { DistroBadge } from "@/react/components/distro-badge";
import { Button } from "@/react/components/ui/button";
import { FlashNotices } from "@/react/components/page";
import { useFlashMessage } from "@/react/lib/use-flash-message";
import { readSettings } from "@/react/state/settings";
import { formatDuration, formatErr } from "@/utils/format";
import { collectionState } from "@/utils/collectionState";

export function HostWorkbenchHeader({ host, metadata, actions }: { host: string; metadata?: ReactNode; actions?: ReactNode }) {
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
    <header className="device-overview-identity">
      {data?.osRelease ? <DistroBadge boxSize={40} osRelease={data.osRelease} /> : <Server size={36} className="device-overview-identity-icon" aria-label="系统未知" />}
      <div className="device-overview-identity-copy">
        <h1>{host}</h1>
        <p>
          <span>{data?.osRelease || (status.unavailable ? "系统信息暂不可用" : "正在读取系统信息…")}</span>
          {data ? <span>已运行 {formatDuration(data.uptime)}</span> : null}
        </p>
        {metadata ? <div className="device-overview-metadata">{metadata}</div> : null}
      </div>
      <div className="device-overview-actions">
      {actions}
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
      </div>
      <FlashNotices flash={flash} />
    </header>
  );
}
