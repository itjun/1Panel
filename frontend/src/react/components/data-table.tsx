import {
  createColumnHelper,
  tableFeatures,
  useTable,
  type ColumnDef,
} from "@tanstack/react-table";
import {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { cn } from "@/react/lib/utils";
import { fitColumnWidths, moveColumn } from "@/utils/groupTableState";

const features = tableFeatures({});

/* 表格行高 40 / 表头 36：与 globals.css 同源（--spacing-table-row / --spacing-table-head），
   只通过 h-table-row / h-table-head 使用，不要在这里写死像素。 */

/** 吸顶表头的底线画在 th::after 上：collapse 表格的边框会随内容滚走；手写吸顶表格（如通知页）复用同一串 */
export const TH_STICKY_LINE =
  "after:pointer-events-none after:absolute after:inset-x-0 after:bottom-0 after:h-px after:bg-line";

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
    <div className="surface-float overflow-hidden">
      <table className="w-full border-collapse text-left text-sm">
        {/* 表头无底色，只留下方 1px line（DESIGN.md §4.4） */}
        <thead className="text-xs font-normal text-muted">
          {table.getHeaderGroups().map((group) => (
            <tr key={group.id} className="h-table-head border-b border-line">
              {group.headers.map((header) => (
                <th key={header.id} className="px-3 font-normal">
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
            <tr className="h-table-row">
              <td
                colSpan={table.getAllColumns().length || 1}
                className="px-3 text-muted"
              >
                {empty}
              </td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr key={row.id} className="h-table-row border-b border-line hover:bg-raised">
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
  /** 未提供 measure 时作为自然宽度 */
  width: number;
  /** 自适应压缩与手动拖拽的下限 */
  minWidth?: number;
  sortable?: boolean;
  align?: "left" | "center" | "right";
  /** 单元格里有进度条时不要用单行截断，避免把条裁掉。 */
  wrap?: boolean;
  /** 单元格显示的文字，用于测量自然宽度 */
  measure?: (row: T) => string;
  /** measure 文字的字体：表格正文 / 等宽正文 / 等宽小号（Meter 数字） */
  font?: "sans" | "mono" | "mono-xs";
  /** 文字之外固定占用的宽度（图标按钮、Meter 轨道等） */
  extra?: number;
  /** 有富余空间时的分配权重，0 / 不填为定宽 */
  flex?: number;
  /** 空间不够时允许压到 minWidth（文字截断） */
  shrink?: boolean;
  render: (row: T, index: number) => ReactNode;
};

export type InteractiveSortOrder = "ascending" | "descending" | null;

/** 单元格左右内边距（px-3 × 2）+ 取整余量 */
const CELL_PAD = 26;
/** 表头排序箭头占位 */
const SORT_MARK_W = 16;
const RESIZE_HANDLE_W = 8;
const DRAG_THRESHOLD = 4;

type TableFonts = { sans: string; mono: string; monoXs: string; head: string };

let measureCtx: CanvasRenderingContext2D | null = null;
function textWidth(text: string, font: string): number {
  if (!text) return 0;
  measureCtx ??= document.createElement("canvas").getContext("2d");
  if (!measureCtx) return text.length * 8;
  measureCtx.font = font;
  return measureCtx.measureText(text).width;
}

function readFonts(table: HTMLTableElement, head: HTMLElement): TableFonts {
  const cell = getComputedStyle(table);
  const th = getComputedStyle(head);
  const monoFamily =
    getComputedStyle(document.documentElement).getPropertyValue("--font-mono").trim() ||
    "monospace";
  return {
    sans: `${cell.fontWeight} ${cell.fontSize} ${cell.fontFamily}`,
    mono: `${cell.fontWeight} ${cell.fontSize} ${monoFamily}`,
    monoXs: `${cell.fontWeight} ${th.fontSize} ${monoFamily}`,
    head: `${th.fontWeight} ${th.fontSize} ${th.fontFamily}`,
  };
}

type ColumnDrag = { key: string; target: { key: string; after: boolean } | null };

/** 支持列排序、列宽自适应 / 拖拽、列顺序拖拽的表格（分组页用）。 */
export function InteractiveDataTable<T>({
  columns,
  data,
  columnOrder,
  manualWidths,
  sortKey,
  sortOrder,
  empty = "暂无数据",
  onColumnOrderChange,
  onManualWidthsChange,
  onSortChange,
  onRowDoubleClick,
  getRowId,
}: {
  columns: InteractiveColumn<T>[];
  data: T[];
  columnOrder: string[];
  /** 用户手动拖过的列宽；其余列按内容与容器宽度自适应 */
  manualWidths: Record<string, number>;
  sortKey: string | null;
  sortOrder: InteractiveSortOrder;
  empty?: string;
  onColumnOrderChange: (order: string[]) => void;
  onManualWidthsChange: (widths: Record<string, number>) => void;
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

  const scrollRef = useRef<HTMLDivElement>(null);
  const tableRef = useRef<HTMLTableElement>(null);
  const headRef = useRef<HTMLTableSectionElement>(null);
  const headerRowRef = useRef<HTMLTableRowElement>(null);
  const skipClick = useRef(false);

  const [available, setAvailable] = useState(0);
  const [fonts, setFonts] = useState<TableFonts | null>(null);
  const [resizeHover, setResizeHover] = useState<string | null>(null);
  const [resizeDraft, setResizeDraft] = useState<{ key: string; width: number } | null>(null);
  const [colDrag, setColDrag] = useState<ColumnDrag | null>(null);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const update = () => setAvailable(el.clientWidth);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // 用户可在设置里换字体 / 字号，数据刷新时顺带重读（字符串相同不会触发重渲染）
  useLayoutEffect(() => {
    if (!tableRef.current || !headRef.current) return;
    const next = readFonts(tableRef.current, headRef.current);
    setFonts((prev) =>
      prev &&
      prev.sans === next.sans &&
      prev.mono === next.mono &&
      prev.monoXs === next.monoXs &&
      prev.head === next.head
        ? prev
        : next,
    );
  }, [data]);

  const naturals = useMemo(() => {
    const out: Record<string, number> = {};
    for (const column of ordered) {
      if (!column.measure || !fonts) {
        out[column.key] = column.width;
        continue;
      }
      const font =
        column.font === "mono" ? fonts.mono : column.font === "mono-xs" ? fonts.monoXs : fonts.sans;
      let cell = 0;
      for (const row of data) cell = Math.max(cell, textWidth(column.measure(row), font));
      const head = textWidth(column.label, fonts.head) + (column.sortable !== false ? SORT_MARK_W : 0);
      out[column.key] = Math.ceil(Math.max(head, cell + (column.extra ?? 0))) + CELL_PAD;
    }
    return out;
  }, [data, fonts, ordered]);

  const widths = useMemo(() => {
    const manual = resizeDraft ? { ...manualWidths, [resizeDraft.key]: resizeDraft.width } : manualWidths;
    return fitColumnWidths(
      ordered.map((column) => ({
        key: column.key,
        natural: naturals[column.key],
        // 不可截断的列（Meter、Tag 等）压缩下限就是内容宽度
        min: column.shrink
          ? (column.minWidth ?? 48)
          : Math.max(column.minWidth ?? 48, naturals[column.key]),
        flex: column.flex,
        shrink: column.shrink,
        manual: manual[column.key],
      })),
      available,
    );
  }, [available, manualWidths, naturals, ordered, resizeDraft]);

  const tableWidth = ordered.reduce((sum, column) => sum + widths[column.key], 0);

  /** 每列右边界相对表格左侧的 x */
  const rightEdges = useMemo(() => {
    const out: Record<string, number> = {};
    let x = 0;
    for (const column of ordered) {
      x += widths[column.key];
      out[column.key] = x;
    }
    return out;
  }, [ordered, widths]);

  function cycleSort(key: string) {
    if (skipClick.current) {
      skipClick.current = false;
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

  function onResizePointerDown(event: ReactPointerEvent<HTMLDivElement>, key: string) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startWidth = widths[key];
    const min = byKey.get(key)?.minWidth ?? 48;
    const pointerId = event.pointerId;
    const target = event.currentTarget;
    target.setPointerCapture(pointerId);
    let latest = startWidth;
    setResizeDraft({ key, width: startWidth });

    function onMove(moveEvent: PointerEvent) {
      if (moveEvent.pointerId !== pointerId) return;
      latest = Math.max(min, Math.round(startWidth + (moveEvent.clientX - startX)));
      setResizeDraft({ key, width: latest });
    }
    function onUp(upEvent: PointerEvent) {
      if (upEvent.pointerId !== pointerId) return;
      target.releasePointerCapture(pointerId);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      setResizeDraft(null);
      if (latest !== startWidth) onManualWidthsChange({ ...manualWidths, [key]: latest });
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  function resetColumnWidth(key: string) {
    if (manualWidths[key] == null) return;
    const next = { ...manualWidths };
    delete next[key];
    onManualWidthsChange(next);
  }

  function dropTargetAt(clientX: number, clientY: number, movingKey: string): ColumnDrag["target"] {
    const table = tableRef.current;
    const row = headerRowRef.current;
    if (!table || !row) return null;
    const rect = table.getBoundingClientRect();
    if (clientY < rect.top - 24 || clientY > rect.bottom + 24) return null;
    const cells = Array.from(row.querySelectorAll<HTMLElement>("[data-col-key]"));
    const hit = cells.find((cell) => {
      const box = cell.getBoundingClientRect();
      return clientX >= box.left && clientX <= box.right;
    });
    const key = hit?.dataset.colKey;
    if (!hit || !key || key === movingKey) return null;
    const box = hit.getBoundingClientRect();
    const after = clientX > (box.left + box.right) / 2;
    // 落点与原位置相同（紧挨被拖列的那一侧）时不提示
    const order = ordered.map((column) => column.key);
    const next = moveColumn(order, movingKey, key, after);
    if (next.every((item, index) => item === order[index])) return null;
    return { key, after };
  }

  function onHeaderPointerDown(event: ReactPointerEvent<HTMLTableCellElement>, key: string) {
    if (event.button !== 0) return;
    const startX = event.clientX;
    const startY = event.clientY;
    const pointerId = event.pointerId;
    const target = event.currentTarget;
    target.setPointerCapture(pointerId);
    let active = false;
    let dropTarget: ColumnDrag["target"] = null;

    function finish() {
      target.releasePointerCapture(pointerId);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("keydown", onKey);
      setColDrag(null);
    }
    function onMove(moveEvent: PointerEvent) {
      if (moveEvent.pointerId !== pointerId) return;
      if (!active) {
        if (Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) < DRAG_THRESHOLD) return;
        active = true;
        skipClick.current = true;
      }
      dropTarget = dropTargetAt(moveEvent.clientX, moveEvent.clientY, key);
      setColDrag({ key, target: dropTarget });
    }
    function onUp(upEvent: PointerEvent) {
      if (upEvent.pointerId !== pointerId) return;
      finish();
      if (active && dropTarget) {
        onColumnOrderChange(
          moveColumn(
            ordered.map((column) => column.key),
            key,
            dropTarget.key,
            dropTarget.after,
          ),
        );
      }
    }
    function onKey(keyEvent: KeyboardEvent) {
      if (keyEvent.key !== "Escape") return;
      dropTarget = null;
      finish();
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("keydown", onKey);
  }

  // 线条不得越出表格右缘，否则会撑出 1–2px 横向滚动
  const clampLine = (x: number, half: number) => Math.min(Math.max(x, half), tableWidth - half);
  const guideKey = resizeDraft?.key ?? resizeHover;
  let insertX: number | null = null;
  if (colDrag?.target) {
    const { key, after } = colDrag.target;
    insertX = clampLine(after ? rightEdges[key] : rightEdges[key] - widths[key], 1.5);
  }

  return (
    // 外边距由页面负责（内容区安全边距），这里只管表格本身
    <div ref={scrollRef} className="surface-float min-h-48 flex-1 overflow-auto">
      <div className="relative" style={{ width: tableWidth }}>
        <table
          ref={tableRef}
          className="border-collapse text-left text-sm"
          style={{ tableLayout: "fixed", width: tableWidth }}
        >
          {/* 吸顶表头用 surface 底遮住滚动内容；底线画在 th::after 上，collapse 模式下的边框吸顶时会滚走 */}
          <thead ref={headRef} className="sticky top-0 z-[1] bg-surface text-xs font-normal text-muted">
            <tr ref={headerRowRef} className="h-table-head">
              {ordered.map((column) => {
                const sorted = sortKey === column.key ? sortOrder : null;
                return (
                  <th
                    key={column.key}
                    data-col-key={column.key}
                    className={cn(
                      "relative select-none truncate px-3 font-normal",
                      TH_STICKY_LINE,
                      column.align === "center" && "text-center",
                      column.align === "right" && "text-right",
                      colDrag?.key === column.key ? "cursor-grabbing opacity-50" : "cursor-pointer",
                    )}
                    style={{ width: widths[column.key] }}
                    onPointerDown={(event) => onHeaderPointerDown(event, column.key)}
                    onClick={() => cycleSort(column.key)}
                  >
                    <span className="inline-flex items-center gap-1">
                      {column.label}
                      {sorted === "ascending" ? " ↑" : null}
                      {sorted === "descending" ? " ↓" : null}
                    </span>
                    <div
                      role="separator"
                      aria-orientation="vertical"
                      aria-label={`调整「${column.label}」列宽，双击恢复自动`}
                      className="absolute top-0 right-0 bottom-0 z-[2] cursor-col-resize"
                      style={{ width: RESIZE_HANDLE_W }}
                      onPointerEnter={() => setResizeHover(column.key)}
                      onPointerLeave={() => setResizeHover((prev) => (prev === column.key ? null : prev))}
                      onPointerDown={(event) => onResizePointerDown(event, column.key)}
                      onClick={(event) => event.stopPropagation()}
                      onDoubleClick={(event) => {
                        event.stopPropagation();
                        resetColumnWidth(column.key);
                      }}
                    />
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {data.length === 0 ? (
              <tr className="h-table-row">
                <td colSpan={ordered.length || 1} className="px-3 text-muted">
                  {empty}
                </td>
              </tr>
            ) : (
              data.map((row, index) => (
                <tr
                  key={getRowId?.(row, index) ?? String(index)}
                  className="h-table-row border-b border-line hover:bg-raised"
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
                        colDrag?.key === column.key && "opacity-50",
                      )}
                      style={{ width: widths[column.key] }}
                    >
                      {column.render(row, index)}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
        {guideKey && !colDrag ? (
          <div className="table-col-resize-guide" style={{ left: clampLine(rightEdges[guideKey], 1) }} />
        ) : null}
        {insertX != null ? <div className="table-col-insert" style={{ left: insertX }} /> : null}
      </div>
    </div>
  );
}
