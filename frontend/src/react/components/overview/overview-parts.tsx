import type { ReactNode } from "react";
import type { monitor } from "@/api";
import { Meter } from "@/react/components/ui/meter";
import { formatBytes } from "@/utils/format";

/** 概览里的一项「标签 + 值」 */
export function OverviewFact({
  label,
  children,
  mono = false,
  className = "",
}: {
  label: string;
  children: ReactNode;
  mono?: boolean;
  className?: string;
}) {
  return (
    <div className={`min-w-0 ${className}`}>
      <div className="text-xs text-muted">{label}</div>
      <div
        className={`mt-1 truncate text-sm text-ink ${mono ? "font-mono tabular-nums" : ""}`}
        data-tip-overflow=""
        data-tip={typeof children === "string" ? children : undefined}
      >
        {children}
      </div>
    </div>
  );
}

export type OverviewColumn = { key: string; label: string; align?: "right" };

/** 概览内的紧凑表：行数随数据，不像 SimpleRows 那样占最小高度 */
export function OverviewTable({
  columns,
  rows,
}: {
  columns: OverviewColumn[];
  rows: { id: string; cells: ReactNode[] }[];
}) {
  return (
    <table className="w-full border-collapse text-left text-sm">
      <thead className="text-xs text-muted">
        <tr className="h-table-head border-b border-line">
          {columns.map((column) => (
            <th
              key={column.key}
              className={`px-3 font-normal ${column.align === "right" ? "text-right" : ""}`}
            >
              {column.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.id} className="h-table-row border-b border-line">
            {row.cells.map((cell, index) => (
              <td
                key={columns[index]?.key || index}
                className={`max-w-[320px] truncate px-3 ${
                  columns[index]?.align === "right" ? "text-right font-mono tabular-nums" : ""
                }`}
              >
                {cell}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** 物理盘 / zpool 容量行（概览与磁盘页共用） */
export function PhysicalDiskRows({ disks }: { disks: monitor.DiskInfo[] }) {
  if (!disks.length) return null;
  return (
    <div>
      <div className="flex flex-col">
        {disks.map((d) => (
          <div
            key={d.filesystem || d.mount}
            className="grid h-table-row grid-cols-[minmax(96px,160px)_96px_200px_minmax(0,1fr)] items-center gap-4 border-b border-line px-3 text-sm"
          >
            <span className="truncate font-mono" data-tip={d.filesystem}>
              {d.mount || d.filesystem}
            </span>
            <span className="text-right font-mono tabular-nums">{formatBytes(d.total)}</span>
            <Meter value={d.percent || 0} className="w-full" />
            <span className="truncate font-mono text-xs tabular-nums text-muted">
              已用 {formatBytes(d.used)}，可用 {formatBytes(d.avail)}
            </span>
          </div>
        ))}
      </div>
      {disks.length > 1 && disks[0]!.fsType === "disk" ? (
        <p className="mt-2 text-xs text-muted">多块盘时已用量按容量比例估算</p>
      ) : null}
    </div>
  );
}
