import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type Ref,
} from "react";
import { Button } from "@/react/components/ui/button";
import { cn } from "@/react/lib/utils";
import {
  clearBoard,
  loadBoard,
  placeBoard,
  resizeEdge,
  saveBoard,
  sameLayout,
  shownSpan,
  type BoardSlot,
} from "@/utils/cardBoard";

export type MonitorGridItem = {
  id: string;
  title: string;
  /** 在 4 列网格中的跨度；窄屏会强制单列 */
  span?: number;
  tags?: { text: string; warn?: boolean }[];
  children: ReactNode;
};

const COLS = 4;
const GAP = 12;

function MaximizeIcon() {
  return (
    <svg viewBox="0 0 16 16" className="h-4 w-4" aria-hidden>
      <path
        d="M2.5 6.5V2.5H6.5M9.5 2.5h4v4M13.5 9.5v4h-4M6.5 13.5h-4v-4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function RestoreIcon() {
  return (
    <svg viewBox="0 0 16 16" className="h-4 w-4" aria-hidden>
      <path
        d="M6 3.5H3.5V6M10 3.5h2.5V6M12.5 10v2.5H10M6 12.5H3.5V10"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <rect
        x="5"
        y="5"
        width="6"
        height="6"
        rx="0.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      />
    </svg>
  );
}

export type MonitorGridHandle = {
  reset: () => void;
};

/**
 * 监控页图表网格：可拖拽排序、可最大化，窄窗堆叠；最大化必须能还原。
 * showReset 为 false 时不画顶部按钮，由页面把「恢复默认」放到自己的工具条。
 */
export function MonitorGrid({
  boardId,
  items,
  defaults,
  showReset = true,
  onDirtyChange,
  rowMinPx = 220,
  fill = false,
  ref,
}: {
  boardId: string;
  items: MonitorGridItem[];
  defaults: BoardSlot[];
  showReset?: boolean;
  onDirtyChange?: (dirty: boolean) => void;
  /** 每张卡片的最小高度（像素） */
  rowMinPx?: number;
  /** 有多余纵向空间时把各行拉开 */
  fill?: boolean;
  ref?: Ref<MonitorGridHandle>;
}) {
  const [layout, setLayout] = useState(() => loadBoard(boardId, defaults, COLS));
  const [maximizedId, setMaximizedId] = useState<string | null>(null);
  const [narrow, setNarrow] = useState(false);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const dragOrigin = useRef<{ id: string; x: number; y: number } | null>(null);
  const draggingRef = useRef(false);
  const dropTargetRef = useRef<string | null>(null);
  const resizingId = useRef("");
  const [resizeEdgeName, setResizeEdgeName] = useState<"" | "left" | "right">("");
  const [resizingCard, setResizingCard] = useState("");
  const resizeDrag = useRef<{
    id: string;
    edge: "left" | "right";
    startX: number;
    startSpan: number;
    startSlots: BoardSlot[];
    pitch: number;
  } | null>(null);

  const itemMap = useMemo(() => {
    const map = new Map(items.map((item) => [item.id, item]));
    return map;
  }, [items]);

  const dirty = !sameLayout(layout, defaults);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 900px)");
    const apply = () => setNarrow(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  const defaultsRef = useRef(defaults);
  defaultsRef.current = defaults;
  useEffect(() => {
    setLayout(loadBoard(boardId, defaultsRef.current, COLS));
  }, [boardId]);

  useEffect(() => {
    if (!maximizedId) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMaximizedId(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [maximizedId]);

  const reset = useCallback(() => {
    clearBoard(boardId);
    setLayout(defaults.map((d) => ({ id: d.id, span: d.span })));
  }, [boardId, defaults]);

  useImperativeHandle(ref, () => ({ reset }), [reset]);

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  const liveCols = narrow ? 1 : COLS;
  const ordered = useMemo(() => {
    const shown = layout.map((slot) => ({
      ...slot,
      span: shownSpan(slot.span, COLS, liveCols),
    }));
    return placeBoard(shown, liveCols)
      .map((slot) => {
        const item = itemMap.get(slot.id);
        if (!item) return null;
        return { ...slot, item };
      })
      .filter(Boolean) as {
      id: string;
      span: number;
      col: number;
      row: number;
      item: MonitorGridItem;
    }[];
  }, [layout, itemMap, liveCols]);

  function onGripPointerDown(event: ReactPointerEvent, id: string) {
    if (event.button !== 0 || maximizedId || resizingId.current) return;
    event.preventDefault();
    dragOrigin.current = { id, x: event.clientX, y: event.clientY };
    draggingRef.current = false;
    dropTargetRef.current = null;
    const onMove = (e: PointerEvent) => {
      const origin = dragOrigin.current;
      if (!origin) return;
      if (!draggingRef.current) {
        const dx = e.clientX - origin.x;
        const dy = e.clientY - origin.y;
        if (dx * dx + dy * dy < 36) return;
        draggingRef.current = true;
        setDraggingId(origin.id);
      }
      const hit = document.elementFromPoint(e.clientX, e.clientY);
      const cell = hit?.closest("[data-monitor-card]") as HTMLElement | null;
      const target = cell?.dataset.monitorCard || null;
      if (target && target !== origin.id) {
        dropTargetRef.current = target;
        setDropTargetId(target);
      } else {
        dropTargetRef.current = null;
        setDropTargetId(null);
      }
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      const from = dragOrigin.current?.id;
      const to = dropTargetRef.current;
      dragOrigin.current = null;
      draggingRef.current = false;
      dropTargetRef.current = null;
      setDraggingId(null);
      setDropTargetId(null);
      if (!from || !to || from === to) return;
      setLayout((prev) => {
        const next = [...prev];
        const fromIdx = next.findIndex((s) => s.id === from);
        const toIdx = next.findIndex((s) => s.id === to);
        if (fromIdx < 0 || toIdx < 0) return prev;
        const [moved] = next.splice(fromIdx, 1);
        next.splice(toIdx, 0, moved);
        saveBoard(boardId, next);
        return next;
      });
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  }

  function onResizeDown(event: ReactPointerEvent, id: string, edge: "left" | "right") {
    if (event.button !== 0 || draggingRef.current || narrow || !rootRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    const slot = layout.find((s) => s.id === id);
    if (!slot) return;
    const colW = (rootRef.current.clientWidth - GAP * (COLS - 1)) / COLS;
    resizeDrag.current = {
      id,
      edge,
      startX: event.clientX,
      startSpan: slot.span,
      startSlots: layout.map((s) => ({ ...s })),
      pitch: colW + GAP,
    };
    resizingId.current = id;
    setResizingCard(id);
    setResizeEdgeName(edge);
    document.body.style.cursor = "ew-resize";
    const onMove = (e: PointerEvent) => {
      const drag = resizeDrag.current;
      if (!drag) return;
      const dx = e.clientX - drag.startX;
      const dir = drag.edge === "right" ? 1 : -1;
      let next = Math.round(drag.startSpan + (dir * dx) / drag.pitch);
      if (next < 1) next = 1;
      if (next > COLS) next = COLS;
      setLayout(resizeEdge(drag.startSlots, drag.id, drag.edge, next, COLS));
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      document.body.style.cursor = "";
      setLayout((prev) => {
        saveBoard(boardId, prev);
        return prev;
      });
      resizeDrag.current = null;
      resizingId.current = "";
      setResizingCard("");
      setResizeEdgeName("");
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  }

  function toggleMaximize(id: string) {
    setMaximizedId((cur) => (cur === id ? null : id));
    // 尺寸变化后让 ECharts 自适应
    window.setTimeout(() => window.dispatchEvent(new Event("resize")), 50);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {showReset ? (
        <div className="flex items-center gap-2">
          <Button disabled={!dirty} onClick={reset}>
            恢复默认
          </Button>
          {maximizedId ? (
            <Button
              variant="ghost"
              aria-label="还原"
              title="还原"
              onClick={() => toggleMaximize(maximizedId)}
            >
              <RestoreIcon />
            </Button>
          ) : null}
        </div>
      ) : null}
      <div
        ref={rootRef}
        className={cn(
          "grid min-h-0 flex-1 gap-0",
          narrow ? "grid-cols-1" : "grid-cols-4",
          maximizedId ? "relative" : "",
        )}
        style={fill ? { gridAutoRows: `minmax(${rowMinPx}px, 1fr)` } : undefined}
      >
        {ordered.map(({ id, span, col, row, item }) => {
          const isMax = maximizedId === id;
          const isHidden = maximizedId != null && !isMax;
          const style: CSSProperties = {
            gridColumn: `${col} / span ${span}`,
            gridRow: String(row),
            minHeight: rowMinPx,
          };
          if (isMax) {
            style.position = "absolute";
            style.inset = 0;
            style.zIndex = 20;
            style.gridColumn = "1 / -1";
            style.gridRow = "1 / -1";
          }
          return (
            <div
              key={id}
              data-monitor-card={id}
              style={style}
              className={cn(
                "relative flex flex-col border-b border-r border-line bg-surface",
                isHidden && "invisible pointer-events-none",
                draggingId === id && "opacity-60",
                dropTargetId === id && "ring-2 ring-accent",
                isMax && "min-h-0 h-full",
              )}
            >
              {!narrow && !maximizedId ? (
                <>
                  <button
                    type="button"
                    aria-label="拖动左缘"
                    title="拖动左缘调整宽度"
                    className={cn(
                      "absolute bottom-[18px] top-[18px] -left-0.5 z-10 w-3 cursor-ew-resize border-0 bg-transparent p-0 opacity-0 hover:opacity-100",
                      resizingCard === id && resizeEdgeName === "left" && "opacity-100",
                    )}
                    onPointerDown={(e) => onResizeDown(e, id, "left")}
                  >
                    <span className="absolute inset-y-0 left-1 w-[3px] rounded-full bg-accent" />
                  </button>
                  <button
                    type="button"
                    aria-label="拖动右缘"
                    title="拖动右缘调整宽度"
                    className={cn(
                      "absolute bottom-[18px] top-[18px] -right-0.5 z-10 w-3 cursor-ew-resize border-0 bg-transparent p-0 opacity-0 hover:opacity-100",
                      resizingCard === id && resizeEdgeName === "right" && "opacity-100",
                    )}
                    onPointerDown={(e) => onResizeDown(e, id, "right")}
                  >
                    <span className="absolute inset-y-0 right-1 w-[3px] rounded-full bg-accent" />
                  </button>
                </>
              ) : null}
              {resizingCard === id ? (
                <div className="pointer-events-none absolute right-4 top-2 z-10 rounded-full bg-accent px-2 py-0.5 text-xs text-white">
                  {span} / {COLS} 列
                </div>
              ) : null}
              <div
                className="flex h-10 shrink-0 cursor-grab items-center gap-2 border-b border-line px-3 pl-7 active:cursor-grabbing"
                onDoubleClick={() => toggleMaximize(id)}
                onPointerDown={(e) => onGripPointerDown(e, id)}
              >
                <span className="px-1 text-muted" aria-hidden>
                  ⋮⋮
                </span>
                <span className="text-sm font-medium">{item.title}</span>
                <div className="ml-2 flex min-w-0 flex-1 flex-wrap gap-1">
                  {(item.tags || []).map((tag) => (
                    <span
                      key={tag.text}
                      className={cn(
                        "rounded-control border border-line px-1.5 text-xs text-muted",
                        tag.warn && "border-[#d64545]/40 text-[#a83232]",
                      )}
                    >
                      {tag.text}
                    </span>
                  ))}
                </div>
                <button
                  type="button"
                  className="grid h-6 w-6 shrink-0 place-items-center rounded-control text-muted hover:bg-ink/5 hover:text-ink"
                  aria-label={isMax ? "还原" : "最大化"}
                  title={isMax ? "还原" : "最大化"}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => toggleMaximize(id)}
                >
                  {isMax ? <RestoreIcon /> : <MaximizeIcon />}
                </button>
              </div>
              <div className="min-h-0 flex-1 p-3">{item.children}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
