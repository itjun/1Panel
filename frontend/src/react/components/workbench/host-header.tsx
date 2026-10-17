import { useQuery } from "@tanstack/react-query";
import { Terminal } from "lucide-react";
import { api } from "@/api";
import { DistroBadge } from "@/react/components/distro-badge";
import { Button } from "@/react/components/ui/button";
import { FlashNotices } from "@/react/components/page";
import { useFlashMessage } from "@/react/lib/use-flash-message";
import { readSettings } from "@/react/state/settings";
import { useSession } from "@/react/state/session";
import { formatErr, formatMemCapacity } from "@/utils/format";

export function HostWorkbenchHeader({ host }: { host: string }) {
  const session = useSession();
  const flash = useFlashMessage();
  const query = useQuery({
    queryKey: ["overview", host],
    queryFn: () => api.collectOverview(host),
    refetchInterval: 5000,
  });
  const config = session.hosts.find((h) => h.name === host);
  const data = query.data;
  return (
    <header className="host-workbench-heading">
      <DistroBadge boxSize={44} osRelease={data?.osRelease || ""} />
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-xl font-semibold">{host}</h1>
        <p className="mt-1 truncate text-xs text-muted" title={data?.osRelease}>
          {config?.hostName || data?.ipAddress || "等待地址"}
          {data
            ? ` · ${data.osRelease} · ${data.cpuCount} 核 ${formatMemCapacity(data.memTotal)}`
            : ""}
        </p>
      </div>
      <span
        className={`text-xs ${query.isError ? "text-danger" : data ? "text-success-text" : "text-muted"}`}
      >
        {query.isError ? "采集异常" : data ? "采集正常" : "正在连接…"}
      </span>
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
