import { Pencil } from "lucide-react";
import { DistroBadge } from "@/react/components/distro-badge";
import { ResourceRing } from "@/react/components/ui/resource-ring";
import { hostCardView } from "@/utils/hostCardModel";
import type { HostCardEntry } from "@/utils/hostCardPoller";
import "./host-card.css";

export function HostCardContent({ name, entry, now, latestAgentVersion, osRelease, onEdit }: {
  name: string;
  entry?: HostCardEntry;
  now: number;
  latestAgentVersion?: string;
  osRelease?: string;
  onEdit: () => void;
}) {
  const view = hostCardView(entry, now, latestAgentVersion);
  const agentTip = view.isAgentOutdated
    ? `${view.agentLabel}，低于内置版本 v${latestAgentVersion?.trim().replace(/^v/, "")}，可更新`
    : view.agentLabel;
  return <>
    <div className="host-card-identity">
      <DistroBadge boxSize={22} osRelease={view.osRelease || osRelease} />
      <span className="host-card-name" data-tip={name} data-tip-overflow="">{name}</span>
      <button type="button" aria-label={`编辑主机 ${name}`} data-tip="编辑主机"
        className="host-card-edit"
        onPointerDown={event => event.stopPropagation()}
        onDoubleClick={event => event.stopPropagation()}
        onClick={event => { event.stopPropagation(); onEdit(); }}><Pencil size={14} aria-hidden="true" /></button>
    </div>
    <div className="host-card-status-line">
      <span className="host-card-status" data-tone={view.tone} data-tip={view.detail}>
        <span className="host-card-status-dot" aria-hidden="true" />{view.statusLabel}
      </span>
      <span className="host-card-agent" data-state={view.agentState} data-outdated={view.isAgentOutdated || undefined}
        tabIndex={view.isAgentOutdated ? 0 : undefined} role={view.isAgentOutdated ? "note" : undefined}
        aria-label={view.isAgentOutdated ? agentTip : undefined}
        data-tip={agentTip} data-tip-overflow={view.isAgentOutdated ? undefined : ""}>{view.agentLabel}</span>
    </div>
    <div className="host-card-metrics" aria-label={`${name} 资源占用`}>
      {view.metrics.map(metric => <div key={metric.label} className="host-card-metric"
        data-tone={metric.tone} data-tip={`${metric.label}${metric.value != null ? `：${metric.value.toFixed(1)}%` : ""}\n${metric.detail}`}>
        <ResourceRing label={`${name} ${metric.label}`} value={metric.value} tone={metric.tone}
          valueText={metric.value != null ? `${metric.value.toFixed(1)}%` : "暂无有效读数"}>
          <strong>{metric.value != null ? <>{Math.round(metric.value)}<span className="host-card-percent">%</span></> : "—"}</strong>
        </ResourceRing>
        <span className="host-card-metric-label">{metric.label}</span>
      </div>)}
    </div>
  </>;
}
