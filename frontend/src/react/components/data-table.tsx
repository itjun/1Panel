import {
  createColumnHelper,
  tableFeatures,
  useTable,
  type ColumnDef,
} from "@tanstack/react-table";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { cn } from "@/react/lib/utils";
import {
  moveColumn,
  resolveResizeTarget,
  type HeaderColumnBox,
} from "@/utils/groupTableState";

const features = tableFeatures({});

export function createAppColumnHelper<T extends Record<string, unknown>>() {
  return createColumnHelper<typeof features, T>();
}

export function DataTable<T extends Record<string, unknown>>({
  columns,
  data,
  empty = "暂无数据",
}: {
  columns: ColumnDef<typeof features, T, any>[];
  data: T[];
  empty?: string;
}) {
  const table = useTable({ features, columns, data });
  const rows = table.getRowModel().rows;

  return (
    <div className="overflow-hidden border border-line bg-surface">
      <table className="w-full border-collapse text-left text-sm">
        <thead className="bg-[#f7f8fa] text-ink">
          {table.getHeaderGroups().map((group) => (
            <tr key={group.id} className="h-10">
              {group.headers.map((header) => (
                <th key={header.id} className="px-3 font-medium">
                  {header.isPlaceholder ? null : (
                    <table.FlexRender header={header} />
                  )}
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr className="h-12">
              <td
                colSpan={table.getAllColumns().length || 1}
                className="px-3 text-muted"
              >
                {empty}
              </td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr key={row.id} className="h-12 border-t border-line">
                {row.getAllCells().map((cell) => (
                  <td key={cell.id} className={cn("px-3 text-ink")}>
                    <table.FlexRender cell={cell} />
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

export type InteractiveColumn<T> = {
  key: string;
  label: string;
  width: number;
  minWidth?: number;
  sortable?: boolean;
  align?: "left" | "center" | "right";
  /** 单元格里有进度条时不要用单行截断，避免把条裁掉。 */
  wrap?: boolean;
  render: (row: T, index: number) => ReactNode;
};

export type InteractiveSortOrder = "ascending" | "descending" | null;

/** 支持列排序、列宽拖拽、列顺序的表格（分组页用）。 */
export function InteractiveDataTable<T>({
  columns,
  data,
  columnOrder,
  columnWidths,
  sortKey,
  sortOrder,
  empty = "暂无数据",
  onColumnOrderChange,
  onColumnWidthsChange,
  onSortChange,
  onRowDoubleClick,
  getRowId,
}: {
  columns: InteractiveColumn<T>[];
  data: T[];
  columnOrder: string[];
  columnWidths: Record<string, number>;
  sortKey: string | null;
  sortOrder: InteractiveSortOrder;
  empty?: string;
  onColumnOrderChange: (order: string[]) => void;
  onColumnWidthsChange: (widths: Record<string, number>) => void;
  onSortChange: (key: string | null, order: InteractiveSortOrder) => void;
  onRowDoubleClick?: (row: T) => void;
  getRowId?: (row: T, index: number) => string;
}) {
  const byKey = useMemo(() => {
    const map = new Map<string, InteractiveColumn<T>>();
    for (const column of columns) map.set(column.key, column);
    return map;
  }, [columns]);

  const ordered = useMemo(
    () =>
      columnOrder
        .map((key) => byKey.get(key))
        .filter((column): column is InteractiveColumn<T> => !!column),
    [byKey, columnOrder],
  );

  const headerRef = useRef<HTMLTableRowElement>(null);
  const [draggingKey, setDraggingKey] = useState<string | null>(null);
  const dragSkipClick = useRef(false);

  const measureBoxes = useCallback((): HeaderColumnBox[] => {
    const row = headerRef.current;
    if (!row) return [];
    const cells = Array.from(row.querySelectorAll<HTMLElement>("[data-col-key]"));
    return cells.map((cell) => {
      const rect = cell.getBoundingClientRect();
      const key = cell.dataset.colKey || "";
      return {
        key,
        left: rect.left,
        right: rect.right,
        width: rect.width,
      };
    });
  }, []);

  function cycleSort(key: string) {
    if (dragSkipClick.current) {
      dragSkipClick.current = false;
      return;
    }
    const column = byKey.get(key);
    if (!column || column.sortable === false) return;
    if (sortKey !== key) {
      onSortChange(key, "ascending");
      return;
    }
    if (sortOrder === "ascending") {
      onSortChange(key, "descending");
      return;
    }
    onSortChange(null, null);
  }

  function onHeaderPointerDown(event: ReactPointerEvent<HTMLTableCellElement>, key: string) {
    if (event.button !== 0) return;
    const boxes = measureBoxes();
    const resize = resolveResizeTarget(boxes, key, event.clientX, 8);
    if (resize) {
      event.preventDefault();
      event.stopPropagation();
      const startX = event.clientX;
      const startWidth = columnWidths[resize.key] ?? byKey.get(resize.key)?.width ?? 100;
      const min = byKey.get(resize.key)?.minWidth ?? 48;
      const pointerId = event.pointerId;
      const target = event.currentTarget as HTMLElement;
      target.setPointerCapture(pointerId);

      function onMove(moveEvent: PointerEvent) {
        if (moveEvent.pointerId !== pointerId) return;
        const next = Math.max(min, Math.round(startWidth + (moveEvent.clientX - startX)));
        onColumnWidthsChange({ ...columnWidths, [resize!.key]: next });
      }
      function onUp(upEvent: PointerEvent) {
        if (upEvent.pointerId !== pointerId) return;
        target.releasePointerCapture(pointerId);
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        dragSkipClick.current = true;
      }
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      return;
    }

    // 列顺序拖拽
    const startX = event.clientX;
    const startY = event.clientY;
    let active = false;
    const pointerId = event.pointerId;
    const target = event.currentTarget as HTMLElement;
    target.setPointerCapture(pointerId);

    function onMove(moveEvent: PointerEvent) {
      if (moveEvent.pointerId !== pointerId) return;
      if (!active) {
        if (Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) < 6) return;
        active = true;
        setDraggingKey(key);
        dragSkipClick.current = true;
      }
      const boxes = measureBoxes();
      const hit = boxes.find(
        (box) => moveEvent.clientX >= box.left && moveEvent.clientX <= box.right,
      );
      if (!hit || hit.key === key) return;
      const after = moveEvent.clientX > (hit.left + hit.right) / 2;
      const next = moveColumn(columnOrder, key, hit.key, after);
      if (next.some((item, index) => item !== columnOrder[index])) {
        onColumnOrderChange(next);
      }
    }
    function onUp(upEvent: PointerEvent) {
      if (upEvent.pointerId !== pointerId) return;
      target.releasePointerCapture(pointerId);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      setDraggingKey(null);
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  useEffect(() => {
    const row = headerRef.current;
    if (!row) return;
    function onMove(event: MouseEvent) {
      const el = (event.target as HTMLElement).closest("[data-col-key]") as HTMLElement | null;
      if (!el || !row?.contains(el)) {
        row!.style.cursor = "";
        return;
      }
      const boxes = measureBoxes();
      const resize = resolveResizeTarget(boxes, el.dataset.colKey || "", event.clientX, 8);
      row!.style.cursor = resize ? "col-resize" : draggingKey ? "grabbing" : "grab";
    }
    row.addEventListener("mousemove", onMove);
    return () => row.removeEventListener("mousemove", onMove);
  }, [draggingKey, measureBoxes]);

  return (
    <div className="overflow-auto border border-line bg-surface">
      <table className="w-full border-collapse text-left text-sm" style={{ tableLayout: "fixed" }}>
        <thead className="bg-[#f7f8fa] text-ink">
          <tr ref={headerRef} className="h-10">
            {ordered.map((column) => {
              const width = columnWidths[column.key] ?? column.width;
              const sorted = sortKey === column.key ? sortOrder : null;
              return (
                <th
                  key={column.key}
                  data-col-key={column.key}
                  className={cn(
                    "relative select-none px-3 font-medium",
                    column.align === "center" && "text-center",
                    column.align === "right" && "text-right",
                    draggingKey === column.key && "bg-accent/10",
                    column.sortable !== false && "cursor-pointer",
                  )}
                  style={{ width, minWidth: column.minWidth ?? 48 }}
                  onPointerDown={(event) => onHeaderPointerDown(event, column.key)}
                  onClick={() => cycleSort(column.key)}
                >
                  <span className="inline-flex items-center gap-1">
                    {column.label}
                    {sorted === "ascending" ? " ↑" : null}
                    {sorted === "descending" ? " ↓" : null}
                  </span>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {data.length === 0 ? (
            <tr className="h-12">
              <td colSpan={ordered.length || 1} className="px-3 text-muted">
                {empty}
              </td>
            </tr>
          ) : (
            data.map((row, index) => (
              <tr
                key={getRowId?.(row, index) ?? String(index)}
                className="h-12 border-t border-line hover:bg-accent/5"
                onDoubleClick={() => onRowDoubleClick?.(row)}
              >
                {ordered.map((column) => (
                  <td
                    key={column.key}
                    className={cn(
                      "px-3 text-ink",
                      column.wrap ? "whitespace-normal align-middle" : "truncate",
                      column.align === "center" && "text-center",
                      column.align === "right" && "text-right",
                    )}
                    style={{ width: columnWidths[column.key] ?? column.width }}
                  >
                    {column.render(row, index)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
