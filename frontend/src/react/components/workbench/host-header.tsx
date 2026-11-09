import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { Server, Terminal } from "lucide-react";
import { api } from "@/api";
import { DistroBadge } from "@/react/components/distro-badge";
import { Button } from "@/react/components/ui/button";
import { FlashNotices } from "@/react/components/page";
import { useFlashMessage } from "@/react/lib/use-flash-message";
import { readSettings } from "@/react/state/settings";
import { formatDurationLong, formatMemCapacity, formatErr } from "@/utils/format";
import { DetailFact, OverviewDetails } from "@/react/components/local/overview-details";
import { collectionState } from "@/utils/collectionState";

export function HostWorkbenchHeader({ host, metadata, actions }: { host: string; metadata?: ReactNode; actions?: ReactNode }) {
  const flash = useFlashMessage();
  const query = useQuery({
    queryKey: ["overview", host],
    queryFn: () => api.collectOverview(host),
    refetchInterval: 5000,
  });
  const data = query.data;
  const agent = useQuery({
    queryKey: ["agent-status", host],
    queryFn: () => api.agentStatus(host, true),
    refetchInterval: 15000,
  });
  const status = collectionState(query, !!agent.data && !agent.data.ok);
  return (
    <header className="local-summary-identity remote-summary-identity">
      <OverviewDetails label="主机设备详情" className="local-summary-device" trigger={data?.osRelease ? <DistroBadge boxSize={40} osRelease={data.osRelease} /> : <Server size={40} strokeWidth={1.5} aria-hidden />}>
        <h2><Server size={20} aria-hidden />主机设备</h2>
        {status.unavailable ? <p>{data ? "系统采集异常，以下为最后已知信息" : "系统信息暂不可用"}</p> : null}
        <dl>
          <DetailFact label="主机名">{data?.hostname || host}</DetailFact>
          <DetailFact label="系统">{data?.osRelease || "—"}</DetailFact>
          <DetailFact label="CPU 型号">{data?.cpuModel || "—"}</DetailFact>
          <DetailFact label="CPU 核心">{data ? `${data.cpuCount} 核` : "—"}</DetailFact>
          <DetailFact label="内存">{data ? formatMemCapacity(data.memTotal) : "—"}</DetailFact>
          <DetailFact label="内核">{data?.kernel || "—"}</DetailFact>
          <DetailFact label="架构">{data?.arch || "—"}</DetailFact>
          <DetailFact label="已运行">{data ? formatDurationLong(data.uptime) : "—"}</DetailFact>
        </dl>
      </OverviewDetails>
      <div className="local-summary-host remote-summary-host">
        <h2>{host}</h2>
        <p>
          <span>{data?.osRelease || (status.unavailable ? "系统信息暂不可用" : "正在读取系统信息…")}</span>
          {data ? <span>{data.cpuCount} 核 / {formatMemCapacity(data.memTotal)}</span> : null}
        </p>
        {metadata ? <div className="device-overview-metadata">{metadata}</div> : null}
      </div>
      {data ? <p className="local-summary-uptime">已运行 {formatDurationLong(Math.floor(data.uptime / 60) * 60).replace(/ 0秒$/, "")}</p> : null}
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
        <Terminal size={16} strokeWidth={1.5} aria-hidden />
        打开终端
      </Button>
      </div>
      <FlashNotices flash={flash} />
    </header>
  );
}
