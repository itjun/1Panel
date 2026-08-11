import { useState, useEffect, useRef, useCallback } from "react";
import {
  Server,
  X,
  Boxes,
  Layers,
  ArrowLeft,
  ArrowRight,
  XCircle,
} from "lucide-react";
import { useApp } from "@/store/app";
import { cn } from "@/lib/utils";

// 右键菜单定位
interface TabMenu {
  tabId: string;
  x: number;
  y: number;
}

// 宽度边界：最小只显示图标（~44px），最大 280px
const MIN_WIDTH = 44;
const MAX_WIDTH = 280;

interface TabBarProps {
  width: number;
  onResize: (w: number) => void;
}

// 垂直标签列：独立的第二列，放在 Sidebar 和 MainPane 之间
// 宽度可拖拽调整（右边缘 resize handle），窄时只显示图标
// 拖过该距离才算开始排序（避免误触）
const REORDER_THRESHOLD_PX = 5;

export function TabBar({ width, onResize }: TabBarProps) {
  const {
    tabs,
    activeTabId,
    setActiveTab,
    closeTab,
    closeOtherTabs,
    closeLeftTabs,
    closeRightTabs,
    closeAllTabs,
    reorderTab,
  } = useApp();
  const [menu, setMenu] = useState<TabMenu | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const resizing = useRef(false);
  // 指针拖拽排序状态
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const suppressClickRef = useRef(false);

  // 判断是否处于「紧凑模式」（宽度太窄，只显示图标）
  const compact = width < 80;

  /**
   * 标签拖拽排序（指针事件，兼容 WKWebView）
   * 按住标签拖动，放到另一标签上松开即重排。
   */
  const onTabPointerDown = (e: React.PointerEvent, tabId: string) => {
    if (e.button !== 0) return;
    // 点关闭按钮不触发排序
    if ((e.target as HTMLElement).closest("[data-tab-close]")) return;

    const startX = e.clientX;
    const startY = e.clientY;
    let active = false;

    const tabIdAtPoint = (x: number, y: number): string | null => {
      const el = document.elementFromPoint(x, y);
      const node = el?.closest("[data-tab-id]") as HTMLElement | null;
      return node?.dataset.tabId ?? null;
    };

    const cleanup = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (!active) {
        if (Math.hypot(dx, dy) < REORDER_THRESHOLD_PX) return;
        active = true;
        suppressClickRef.current = true;
        setDraggingId(tabId);
        document.body.style.cursor = "grabbing";
        document.body.style.userSelect = "none";
      }
      const over = tabIdAtPoint(ev.clientX, ev.clientY);
      setDropTargetId(over && over !== tabId ? over : null);
    };

    const onUp = (ev: PointerEvent) => {
      cleanup();
      if (!active) {
        setDraggingId(null);
        setDropTargetId(null);
        return;
      }
      const over = tabIdAtPoint(ev.clientX, ev.clientY);
      setDraggingId(null);
      setDropTargetId(null);
      if (over && over !== tabId) {
        reorderTab(tabId, over);
      }
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  };

  // 拖拽 resize：鼠标按下右边缘 handle 后，跟踪 mousemove 改宽度
  const startResize = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      resizing.current = true;
      const startX = e.clientX;
      const startWidth = width;
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";

      const onMove = (ev: MouseEvent) => {
        if (!resizing.current) return;
        const delta = ev.clientX - startX;
        const next = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, startWidth + delta));
        onResize(next);
      };
      const onUp = () => {
        resizing.current = false;
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [width, onResize]
  );

  // 点击外部关闭右键菜单
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onEsc = (e: KeyboardEvent) => e.key === "Escape" && setMenu(null);
    const timer = setTimeout(() => {
      window.addEventListener("click", close);
      window.addEventListener("contextmenu", close);
    }, 0);
    window.addEventListener("keydown", onEsc);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("click", close);
      window.removeEventListener("contextmenu", close);
      window.removeEventListener("keydown", onEsc);
    };
  }, [menu]);

  // 活跃标签变化时，smooth 滚入视野（仅当不可见时才触发，避免抖动）
  useEffect(() => {
    if (!activeTabId || !listRef.current) return;
    const container = listRef.current;
    const el = container.querySelector<HTMLElement>(
      `[data-tab-id="${activeTabId}"]`
    );
    if (!el) return;
    const cRect = container.getBoundingClientRect();
    const eRect = el.getBoundingClientRect();
    // 不可见时才滚
    if (eRect.top < cRect.top || eRect.bottom > cRect.bottom) {
      el.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [activeTabId]);

  // 自动扩容：标签打开时，如果当前列宽不足以完整显示某个标签的名称/副标题，
  // 自动扩到刚好够显示（不超过 MAX_WIDTH）。
  // 只扩不缩：用户手动拖窄后不会被撑开，除非打开了更长名称的标签。
  useEffect(() => {
    if (tabs.length === 0 || compact) return;
    // 用 canvas 测量文本宽度（和 12px 字号匹配）
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.font = "12px sans-serif";

    // 每个标签需要的宽度 = max(标题行, 副标题行) + padding
    // 标题行：图标(12) + gap(6) + 文字 + gap(6) + ×按钮(12) + 左右padding(16)
    // 副标题行：缩进(16) + 文字 + padding(16)
    const ICON = 12, GAP = 6, CLOSE = 12, PAD = 16, INDENT = 16;
    let needed = 0;
    for (const t of tabs) {
      const titleW = ICON + GAP + ctx.measureText(t.title).width + GAP + CLOSE + PAD;
      const subtitleW = t.subtitle ? INDENT + ctx.measureText(t.subtitle).width + PAD : 0;
      needed = Math.max(needed, titleW, subtitleW);
    }
    // 只在当前宽度不够时扩容，且不超过最大值
    if (needed > width && needed <= MAX_WIDTH) {
      onResize(Math.ceil(needed));
    } else if (needed > MAX_WIDTH && width < MAX_WIDTH) {
      onResize(MAX_WIDTH);
    }
  }, [tabs, width, onResize, compact]);

  const runMenuAction = (action: () => void) => {
    action();
    setMenu(null);
  };

  return (
    <aside
      className="relative flex shrink-0 flex-col border-r border-border bg-background"
      style={{ width }}
    >
      {/* 标题 */}
      <div className="flex h-9 shrink-0 items-center gap-1.5 border-b border-border px-2 text-[11px] font-medium text-muted-foreground">
        <Layers className="h-3 w-3 shrink-0" />
        {!compact && <span>标签</span>}
        {tabs.length > 0 && (
          <span className="ml-auto tabular-nums text-primary">{tabs.length}</span>
        )}
      </div>

      {/* 空态 */}
      {tabs.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-2 text-center">
          <Server className="h-6 w-6 text-muted-foreground/40" />
          {!compact && (
            <span className="text-[10px] text-muted-foreground">
              从左侧选择主机
            </span>
          )}
        </div>
      ) : (
        /* 标签列表（垂直滚动） */
        <div
          ref={listRef}
          className="flex-1 space-y-1 overflow-y-auto p-1.5"
          style={{ scrollBehavior: "smooth" }}
        >
          {tabs.map((t) => {
            const active = t.id === activeTabId;
            const Icon = t.kind === "host" ? Server : Boxes;
            const isDragging = draggingId === t.id;
            const isDropTarget = dropTargetId === t.id;
            return (
              <div
                key={t.id}
                data-tab-id={t.id}
                title={
                  compact
                    ? `${t.title}${t.subtitle ? " " + t.subtitle : ""}（可拖拽排序）`
                    : "按住拖动可排序"
                }
                onPointerDown={(e) => onTabPointerDown(e, t.id)}
                onClick={() => {
                  if (suppressClickRef.current) {
                    suppressClickRef.current = false;
                    return;
                  }
                  setActiveTab(t.id);
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setMenu({ tabId: t.id, x: e.clientX, y: e.clientY });
                }}
                className={cn(
                  "group relative flex cursor-grab transition-colors active:cursor-grabbing",
                  compact
                    ? "justify-center py-2.5"
                    : "flex-col gap-0.5 px-2.5 py-2 pl-4",
                  active
                    ? "panel-menu-item-active"
                    : "panel-menu-item text-muted-foreground hover:text-primary",
                  isDragging && "opacity-40",
                  isDropTarget && "ring-2 ring-primary/40"
                )}
              >
                {/* 紧凑模式：只显示图标 + 活跃指示条 */}
                {compact ? (
                  <>
                    <Icon
                      className={cn(
                        "h-3.5 w-3.5 shrink-0",
                        active ? "text-primary" : ""
                      )}
                    />
                  </>
                ) : (
                  <>
                    {/* 第一行：图标 + 主机名 + × */}
                    <div className="flex items-center gap-1.5">
                      <Icon
                        className={cn(
                          "h-3 w-3 shrink-0",
                          active ? "text-primary" : "text-muted-foreground"
                        )}
                      />
                      <span className="flex-1 truncate text-xs font-medium">
                        {t.title}
                      </span>
                      <span
                        role="button"
                        data-tab-close
                        onClick={(e) => {
                          e.stopPropagation();
                          closeTab(t.id);
                        }}
                        onPointerDown={(e) => e.stopPropagation()}
                        className="shrink-0 rounded p-0.5 opacity-0 transition-opacity hover:bg-primary-soft group-hover:opacity-100"
                      >
                        <X className="h-2.5 w-2.5" />
                      </span>
                    </div>
                    {/* 第二行：副标题 */}
                    {t.subtitle && (
                      <span
                        className={cn(
                          "truncate pl-4 text-[10px]",
                          active ? "text-primary/70" : "text-muted-foreground"
                        )}
                      >
                        {t.subtitle}
                      </span>
                    )}
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* 右边缘 resize handle：拖拽改变列宽 */}
      <div
        onMouseDown={startResize}
        className="absolute right-0 top-0 z-20 h-full w-1 cursor-col-resize hover:bg-primary/30"
        title="拖拽调整宽度"
      />

      {/* 右键菜单 */}
      {menu && (
        <div
          className="fixed z-50 min-w-[140px] rounded border border-card-border bg-popover p-1 shadow-panel"
          style={{ left: menu.x, top: menu.y }}
        >
          <MenuBtn
            icon={<X className="h-3.5 w-3.5" />}
            label="关闭"
            onClick={() => runMenuAction(() => closeTab(menu.tabId))}
          />
          <MenuBtn
            icon={<Layers className="h-3.5 w-3.5" />}
            label="关闭其它"
            onClick={() => runMenuAction(() => closeOtherTabs(menu.tabId))}
          />
          <MenuBtn
            icon={<ArrowLeft className="h-3.5 w-3.5" />}
            label="关闭左侧"
            onClick={() => runMenuAction(() => closeLeftTabs(menu.tabId))}
          />
          <MenuBtn
            icon={<ArrowRight className="h-3.5 w-3.5" />}
            label="关闭右侧"
            onClick={() => runMenuAction(() => closeRightTabs(menu.tabId))}
          />
          <MenuBtn
            icon={<XCircle className="h-3.5 w-3.5" />}
            label="关闭所有"
            onClick={() => runMenuAction(() => closeAllTabs())}
            danger
          />
        </div>
      )}
    </aside>
  );
}

function MenuBtn({
  icon,
  label,
  onClick,
  danger,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      className={cn(
        "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-accent",
        danger && "text-destructive"
      )}
      onClick={onClick}
    >
      {icon}
      {label}
    </button>
  );
}
