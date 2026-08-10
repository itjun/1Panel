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
  } = useApp();
  const [menu, setMenu] = useState<TabMenu | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const resizing = useRef(false);

  // 判断是否处于「紧凑模式」（宽度太窄，只显示图标）
  const compact = width < 80;

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
      className="relative flex shrink-0 flex-col border-r border-border bg-card/30"
      style={{ width }}
    >
      {/* 标题 */}
      <div className="flex h-9 shrink-0 items-center gap-1.5 border-b border-border px-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        <Layers className="h-3 w-3 shrink-0" />
        {!compact && <span>标签</span>}
        {tabs.length > 0 && (
          <span className="ml-auto tabular-nums">{tabs.length}</span>
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
          className="flex-1 space-y-0.5 overflow-y-auto p-1.5"
          style={{ scrollBehavior: "smooth" }}
        >
          {tabs.map((t) => {
            const active = t.id === activeTabId;
            const Icon = t.kind === "host" ? Server : Boxes;
            return (
              <div
                key={t.id}
                data-tab-id={t.id}
                title={compact ? `${t.title}${t.subtitle ? " " + t.subtitle : ""}` : undefined}
                onClick={() => setActiveTab(t.id)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setMenu({ tabId: t.id, x: e.clientX, y: e.clientY });
                }}
                className={cn(
                  "group relative flex cursor-pointer rounded-md transition-colors",
                  compact
                    ? "justify-center py-2"
                    : "flex-col gap-0.5 px-2 py-1.5",
                  active
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground"
                )}
              >
                {/* 紧凑模式：只显示图标 + 活跃指示条 */}
                {compact ? (
                  <>
                    <Icon className="h-3.5 w-3.5 shrink-0" />
                    {/* 活跃标签左侧竖条 */}
                    {active && (
                      <span className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full bg-primary-foreground" />
                    )}
                  </>
                ) : (
                  <>
                    {/* 第一行：图标 + 主机名 + × */}
                    <div className="flex items-center gap-1.5">
                      <Icon
                        className={cn(
                          "h-3 w-3 shrink-0",
                          active ? "" : "text-muted-foreground"
                        )}
                      />
                      <span className="flex-1 truncate text-xs font-medium">
                        {t.title}
                      </span>
                      <span
                        role="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          closeTab(t.id);
                        }}
                        className="shrink-0 rounded p-0.5 opacity-0 transition-opacity hover:bg-background group-hover:opacity-100"
                      >
                        <X className="h-2.5 w-2.5" />
                      </span>
                    </div>
                    {/* 第二行：副标题 */}
                    {t.subtitle && (
                      <span
                        className={cn(
                          "truncate pl-4 text-[10px]",
                          active ? "text-primary-foreground/70" : ""
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
          className="fixed z-50 min-w-[140px] rounded-md border border-border bg-popover p-1 shadow-lg"
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
