import { ChartNoAxesColumnIncreasing } from "lucide-react";
import { Button } from "@/react/components/ui/button";
import { Meter } from "@/react/components/ui/meter";
import { boardHealthOf, type BoardHostCard, type BoardHealth } from "@/utils/boardModel";

const HEALTH_LABEL: Record<BoardHealth, string> = {
  healthy: "正常", attention: "注意", critical: "严重", unknown: "待采集",
};

export function BoardHostIdentity({ host, card, now, selected, onSelect }: {
  host: string; card: BoardHostCard; now: number; selected: boolean; onSelect: (host: string) => void;
}) {
  const health = boardHealthOf(card, now);
  const ov = card.error ? null : card.overview;
  return <div className="board-host__identity">
    <button type="button" className="board-host__name" onClick={() => onSelect(host)}
      title={host} aria-label={`查看 ${host} 的监控曲线`} aria-haspopup="dialog" aria-expanded={selected}>
      {host}
    </button>
    <span className={`board-host__status health-${health}`} title={card.error || undefined}>
      <span className="board-host__dot" aria-hidden="true" />{card.error ? "连接异常" : HEALTH_LABEL[health]}
    </span>
    <span className="board-host__cores">{ov?.cpuCount ? `${ov.cpuCount} 核` : card.loading ? "正在采集" : "—"}</span>
  </div>;
}

export function BoardTrendButton({ host, selected, onSelect }: {
  host: string; selected: boolean; onSelect: (host: string) => void;
}) {
  return <Button variant="ghost" size="sm" className="board-host__trend" onClick={() => onSelect(host)}
    aria-label={`展开 ${host} 的趋势`} aria-haspopup="dialog" aria-expanded={selected}>
    <ChartNoAxesColumnIncreasing size={18} strokeWidth={1.5} /><span>趋势</span>
  </Button>;
}

export function BoardUsageCell({ value, detail, alert }: { value?: number; detail?: string; alert?: boolean }) {
  const known = typeof value === "number" && Number.isFinite(value);
  return <>
    <div className="board-host__usage">
      <strong className={alert ? "is-danger" : undefined}>{known ? `${value.toFixed(1)}%` : "—"}</strong>
      <Meter value={value} showValue={false} tone={alert ? "danger" : "auto"} />
    </div>
    {detail ? <span className="board-host__secondary">{detail}</span> : null}
  </>;
}
