import { useState, useEffect } from "react";
import { Server, X, Boxes, Folder } from "lucide-react";
import { useApp } from "@/store/app";
import { cn } from "@/lib/utils";

// 右键菜单定位
interface TabMenu {
  tabId: string;
  x: number;
  y: number;
}

// 主机标签条：类似浏览器 Tab，可同时打开多台主机/分组
export function TabBar() {
  const { tabs, activeTabId, setActiveTab, closeTab, closeOtherTabs } = useApp();
  const [menu, setMenu] = useState<TabMenu | null>(null);

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

  if (tabs.length === 0) return null;

  return (
    <>
      <div className="flex h-9 shrink-0 items-center gap-0.5 overflow-x-auto border-b border-border bg-card/30 px-2">
        {tabs.map((t) => {
          const active = t.id === activeTabId;
          const Icon = t.kind === "host" ? Server : Boxes;
          return (
            <div
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setMenu({ tabId: t.id, x: e.clientX, y: e.clientY });
              }}
              className={cn(
                "group flex h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-md px-2.5 text-xs transition-colors",
                active
                  ? "bg-secondary text-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground"
              )}
            >
              <Icon
                className={cn(
                  "h-3 w-3 shrink-0",
                  active ? "text-primary" : ""
                )}
              />
              <span className="max-w-[120px] truncate">{t.title}</span>
              <span
                role="button"
                onClick={(e) => {
                  e.stopPropagation();
                  closeTab(t.id);
                }}
                className="ml-0.5 rounded p-0.5 opacity-0 transition-opacity hover:bg-background group-hover:opacity-100"
              >
                <X className="h-3 w-3" />
              </span>
            </div>
          );
        })}
      </div>

      {/* 标签右键菜单 */}
      {menu && (
        <div
          className="fixed z-50 min-w-[140px] rounded-md border border-border bg-popover p-1 shadow-lg"
          style={{ left: menu.x, top: menu.y }}
        >
          <button
            className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-accent"
            onClick={() => {
              closeTab(menu.tabId);
              setMenu(null);
            }}
          >
            <X className="h-3.5 w-3.5" />
            关闭
          </button>
          <button
            className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-accent"
            onClick={() => {
              closeOtherTabs(menu.tabId);
              setMenu(null);
            }}
          >
            <Folder className="h-3.5 w-3.5" />
            关闭其它
          </button>
        </div>
      )}
    </>
  );
}
