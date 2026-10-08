export type SortDirection = "asc" | "desc";

export function SortableHeader<K extends string>({
  label,
  sortKey,
  activeKey,
  direction,
  onSort,
  className,
  align = "left",
}: {
  label: string;
  sortKey: K;
  activeKey: K | null;
  direction: SortDirection;
  onSort: (key: K) => void;
  className: string;
  align?: "left" | "right";
}) {
  const active = sortKey === activeKey;
  const arrow = active ? (direction === "asc" ? "↑" : "↓") : "↕";
  return (
    <th
      aria-sort={active ? (direction === "asc" ? "ascending" : "descending") : "none"}
      className={className}
    >
      <button
        type="button"
        className={`flex w-full items-center gap-1 rounded-control text-left hover:text-accent focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent ${align === "right" ? "justify-end text-right" : "justify-start"} ${active ? "text-accent" : "text-muted"}`}
        onClick={() => onSort(sortKey)}
        data-tip={`${label}：点击排序，再次点击切换升降序`}
      >
        <span>{label}</span>
        <span aria-hidden="true" className="text-xs text-muted">
          {arrow}
        </span>
      </button>
    </th>
  );
}
