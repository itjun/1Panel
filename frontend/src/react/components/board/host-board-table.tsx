import type { BoardHostBrief } from "@/api/board-http";
import { Meter } from "@/react/components/ui/meter";
import { isCpuAlert, isDiskFull, isLoadAlert, isMemAlert, summarizeDisks } from "@/utils/alerts";
import { boardHealthOf, type BoardHostCard, type BoardHealth } from "@/utils/boardModel";
import { formatBytes, formatMemCapacity } from "@/utils/format";

const HEALTH_LABEL: Record<BoardHealth, string> = {
  healthy: "正常", attention: "注意", critical: "严重", unknown: "待采集",
};

function UsageCell({ value, detail, alert }: { value?: number; detail?: string; alert?: boolean }) {
  const known = typeof value === "number" && Number.isFinite(value);
  return <>
    <div className="board-table__usage">
      <strong className={alert ? "is-danger" : undefined}>{known ? `${value.toFixed(1)}%` : "—"}</strong>
      <Meter value={value} showValue={false} tone={alert ? "danger" : "auto"} />
    </div>
    {detail ? <span className="board-table__secondary">{detail}</span> : null}
  </>;
}

export function HostBoardTable({ hosts, cards, selectedHost, now, onSelect }: {
  hosts: BoardHostBrief[]; cards: Record<string, BoardHostCard>;
  selectedHost: string; now: number; onSelect: (name: string) => void;
}) {
  return (
    <section className="board-table-wrap" aria-label="主机实时总览">
      <table className="board-table">
        <colgroup>
          <col className="board-table__host-col" /><col className="board-table__status-col" />
          <col /><col /><col className="board-table__load-col" /><col /><col className="board-table__apps-col" />
        </colgroup>
        <thead><tr>
          <th scope="col">主机</th><th scope="col">状态</th><th scope="col">CPU</th>
          <th scope="col">内存</th><th scope="col">系统负载</th><th scope="col">磁盘</th><th scope="col">应用订阅</th>
        </tr></thead>
        <tbody>
          {hosts.map((host, index) => {
            const card = cards[host.name] || { loading: true };
            const health = boardHealthOf(card, now);
            const ov = card.error ? null : card.overview;
            const disk = card.error ? null : summarizeDisks(card.disks);
            const selected = selectedHost === host.name;
            const status = card.error ? "连接异常" : HEALTH_LABEL[health];
            return (
              <tr key={host.name} className={selected ? "is-selected" : undefined} onClick={() => onSelect(host.name)}>
                <th scope="row">
                  <button type="button" className="board-table__host-button" aria-pressed={selected}
                    aria-controls="board-host-trends" aria-label={`查看 ${host.name} 的监控曲线`}
                    onKeyDown={(event) => {
                      const nextIndex = event.key === "ArrowDown" ? Math.min(hosts.length - 1, index + 1)
                        : event.key === "ArrowUp" ? Math.max(0, index - 1)
                        : event.key === "Home" ? 0 : event.key === "End" ? hosts.length - 1 : -1;
                      if (nextIndex < 0) return;
                      event.preventDefault();
                      onSelect(hosts[nextIndex].name);
                      const buttons = event.currentTarget.closest("tbody")?.querySelectorAll<HTMLButtonElement>(".board-table__host-button");
                      buttons?.[nextIndex]?.focus({ preventScroll: true });
                      buttons?.[nextIndex]?.scrollIntoView({ block: "nearest", inline: "nearest" });
                    }}>
                    <span className="board-table__host-name" data-tip={host.name} data-tip-overflow="">{host.name}</span>
                  </button>
                  <span className="board-table__secondary">{ov?.cpuCount ? `${ov.cpuCount} 核` : card.loading ? "正在采集" : "—"}</span>
                </th>
                <td>
                  <span className={`board-table__status health-${health}`} data-tip={card.error || undefined}>
                    <span className="board-table__status-dot" aria-hidden="true" />{status}
                  </span>
                  {health === "attention" && !card.appSubLoading && !card.appSubItems?.some((item) => item.status === "unknown") ? (
                    <span className="board-table__secondary">数据待更新</span>
                  ) : null}
                </td>
                <td><UsageCell value={ov?.cpuPercent} alert={isCpuAlert(ov)} /></td>
                <td><UsageCell value={ov?.memPercent} alert={isMemAlert(ov)}
                  detail={ov ? `${formatBytes(ov.memUsed)} / ${formatMemCapacity(ov.memTotal)}` : undefined} /></td>
                <td>
                  <strong className={`board-table__number${isLoadAlert(ov) ? " is-danger" : ""}`}>{ov ? ov.load1.toFixed(2) : "—"}</strong>
                  <span className="board-table__secondary">核均 {ov?.cpuCount ? (ov.load1 / ov.cpuCount).toFixed(2) : "—"}</span>
                </td>
                <td><UsageCell value={disk?.percent} alert={isDiskFull(card.disks)}
                  detail={disk ? `${formatBytes(disk.used)} / ${formatBytes(disk.total)}` : undefined} /></td>
                <td><div className="board-table__apps">
                  {card.appSubItems?.length ? card.appSubItems.map((item) => (
                    <span key={item.name} className={`board-table__app health-${item.status}`}>
                      {item.name} <b>{item.status === "unknown" ? "—" : item.count}</b>
                    </span>
                  )) : <span className="board-table__secondary">{card.appSubLoading ? "探活中…" : card.appSubItems === null ? "未配置" : "暂无订阅"}</span>}
                </div></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
