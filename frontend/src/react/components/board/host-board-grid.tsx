import { BoardAppList } from "./board-app-list";
import { BoardHostIdentity, BoardTrendButton, BoardUsageCell } from "./board-host-fields";
import type { BoardHostsProps } from "./host-board-table";
import { isCpuAlert, isDiskFull, isLoadAlert, isMemAlert, summarizeDisks } from "@/utils/alerts";

export function HostBoardGrid({ hosts, cards, selectedHost, now, onSelect, onApps }: BoardHostsProps) {
  return <div className="board-rack" role="list" aria-label="主机实时总览">
    {hosts.map((host) => {
      const card = cards[host.name] || { loading: true };
      const ov = card.error ? null : card.overview;
      const disk = card.error ? null : summarizeDisks(card.disks);
      const selected = selectedHost === host.name;
      return <section className={`board-rack__host${selected ? " is-selected" : ""}`} key={host.name} data-host={host.name} role="listitem" aria-label={host.name}>
        <header className="board-rack__header">
          <BoardHostIdentity host={host.name} card={card} now={now} selected={selected} onSelect={onSelect} />
          <BoardTrendButton host={host.name} selected={selected} onSelect={onSelect} />
        </header>
        <div className="board-rack__metrics">
          <div><span className="board-rack__label">CPU</span><BoardUsageCell value={ov?.cpuPercent} alert={isCpuAlert(ov)} /></div>
          <div><span className="board-rack__label">内存</span><BoardUsageCell value={ov?.memPercent} alert={isMemAlert(ov)} /></div>
          <div><span className="board-rack__label">磁盘</span><BoardUsageCell value={disk?.percent} alert={!card.error && isDiskFull(card.disks)} /></div>
          <div><span className="board-rack__label">负载</span><strong className={`board-host__number${isLoadAlert(ov) ? " is-danger" : ""}`}>{ov ? ov.load1.toFixed(2) : "—"}</strong></div>
        </div>
        <div className="board-rack__apps"><span className="board-rack__label">应用订阅</span>
          <BoardAppList host={host.name} items={card.appSubItems} loading={card.appSubLoading} onExpand={() => onApps(host.name)} />
        </div>
      </section>;
    })}
  </div>;
}
