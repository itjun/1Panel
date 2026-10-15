import type { BoardHostBrief } from "@/api/board-http";
import { BoardAppList } from "./board-app-list";
import { BoardHostIdentity, BoardTrendButton, BoardUsageCell } from "./board-host-fields";
import { isCpuAlert, isDiskFull, isLoadAlert, isMemAlert, summarizeDisks } from "@/utils/alerts";
import type { BoardHostCard } from "@/utils/boardModel";
import { formatBytes, formatMemCapacity } from "@/utils/format";

export type BoardHostsProps = {
  hosts: BoardHostBrief[]; cards: Record<string, BoardHostCard>;
  selectedHost: string; now: number; onSelect: (name: string) => void; onApps: (name: string) => void;
};

export function HostBoardTable({ hosts, cards, selectedHost, now, onSelect, onApps }: BoardHostsProps) {
  return <table className="board-table" aria-label="主机实时总览">
    <colgroup>
      <col className="board-table__host-col" /><col className="board-table__cpu-col" />
      <col className="board-table__memory-col" /><col className="board-table__load-col" />
      <col className="board-table__disk-col" /><col className="board-table__apps-col" /><col className="board-table__trend-col" />
    </colgroup>
    <thead><tr>
      <th scope="col">主机</th><th scope="col">CPU</th><th scope="col">内存</th>
      <th scope="col">系统负载</th><th scope="col">磁盘</th><th scope="col">应用订阅</th><th scope="col">趋势</th>
    </tr></thead>
    <tbody>{hosts.map((host) => {
      const card = cards[host.name] || { loading: true };
      const ov = card.error ? null : card.overview;
      const disk = card.error ? null : summarizeDisks(card.disks);
      const selected = selectedHost === host.name;
      return <tr key={host.name} className={selected ? "is-selected" : undefined} data-host={host.name}>
        <th scope="row"><BoardHostIdentity host={host.name} card={card} now={now} selected={selected} onSelect={onSelect} /></th>
        <td><BoardUsageCell value={ov?.cpuPercent} alert={isCpuAlert(ov)} /></td>
        <td><BoardUsageCell value={ov?.memPercent} alert={isMemAlert(ov)}
          detail={ov ? `${formatBytes(ov.memUsed)} / ${formatMemCapacity(ov.memTotal)}` : undefined} /></td>
        <td><strong className={`board-host__number${isLoadAlert(ov) ? " is-danger" : ""}`}>{ov ? ov.load1.toFixed(2) : "—"}</strong>
          <span className="board-host__secondary">核均 {ov?.cpuCount ? (ov.load1 / ov.cpuCount).toFixed(2) : "—"}</span></td>
        <td><BoardUsageCell value={disk?.percent} alert={!card.error && isDiskFull(card.disks)}
          detail={disk ? `${formatBytes(disk.used)} / ${formatBytes(disk.total)}` : undefined} /></td>
        <td><BoardAppList host={host.name} items={card.appSubItems} loading={card.appSubLoading} onExpand={() => onApps(host.name)} /></td>
        <td><BoardTrendButton host={host.name} selected={selected} onSelect={onSelect} /></td>
      </tr>;
    })}</tbody>
  </table>;
}
