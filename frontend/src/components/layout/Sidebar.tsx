import { useMemo, useState, useEffect, useRef } from "react";
import {
  ChevronRight,
  Folder,
  Server,
  Search,
  LayoutGrid,
  ExternalLink,
  Copy,
  ArrowRightLeft,
  Edit3,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { useApp, UNGROUPED_ID } from "@/store/app";
import { api } from "@/lib/api";

// 右键菜单目标
interface MenuTarget {
  kind: "host" | "group";
  id: string;
  name: string;
  info?: string;
  x: number;
  y: number;
}

export function Sidebar() {
  const {
    groupNodes,
    activeTabId,
    tabs,
    hosts,
    openGroupTab,
    openHostTab,
    assignHost,
    refresh,
  } = useApp();
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [query, setQuery] = useState("");
  const [menu, setMenu] = useState<MenuTarget | null>(null);
  // 拖拽高亮的目标分组 id
  const [dragOverGroup, setDragOverGroup] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    if (!query.trim()) return groupNodes;
    const q = query.toLowerCase();
    return groupNodes
      .map((node) => ({
        ...node,
        hosts: node.hosts.filter(
          (h) =>
            h.name.toLowerCase().includes(q) ||
            (h.hostName || "").toLowerCase().includes(q)
        ),
      }))
      .filter((node) => node.hosts.length > 0);
  }, [groupNodes, query]);

  const openedIds = useMemo(() => new Set(tabs.map((t) => t.id)), [tabs]);

  // 点击菜单外部关闭菜单
  useEffect(() => {
    if (!menu) return;
    const onClick = () => setMenu(null);
    const onEsc = (e: KeyboardEvent) => e.key === "Escape" && setMenu(null);
    // 延迟绑定，避免触发当前 contextmenu 事件的 click
    const timer = setTimeout(() => {
      window.addEventListener("click", onClick);
      window.addEventListener("contextmenu", onClick);
    }, 0);
    window.addEventListener("keydown", onEsc);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("click", onClick);
      window.removeEventListener("contextmenu", onClick);
      window.removeEventListener("keydown", onEsc);
    };
  }, [menu]);

  const openHostMenu = (e: React.MouseEvent, h: { name: string; user?: string; hostName?: string }) => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({
      kind: "host",
      id: h.name,
      name: h.name,
      info: `${h.user || "?"}@${h.hostName || "?"}`,
      x: e.clientX,
      y: e.clientY,
    });
  };

  const openGroupMenu = (e: React.MouseEvent, id: string, name: string) => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ kind: "group", id, name, x: e.clientX, y: e.clientY });
  };

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-border bg-card/30">
      {/* 搜索 */}
      <div className="p-3">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="搜索主机..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="h-8 pl-8 text-xs"
          />
        </div>
      </div>

      <ScrollArea className="flex-1 px-2 pb-3">
        <div className="space-y-0.5">
          {filtered.length === 0 && (
            <div className="px-3 py-8 text-center text-xs text-muted-foreground">
              {hosts.length === 0 ? "暂无主机" : "无匹配结果"}
            </div>
          )}
          {filtered.map((node) => {
            const id = node.group?.id ?? "__ungrouped__";
            const name = node.group?.name ?? "未分组";
            const isCollapsed = collapsed[id] === true;
            const isGroupActive = activeTabId === id;
            return (
              <div
                key={id}
                onDragOver={(e) => {
                  if (e.dataTransfer.types.includes("application/x-host-name")) {
                    e.preventDefault();
                    setDragOverGroup(id);
                  }
                }}
                onDragLeave={(e) => {
                  // 离开整个分组区域时清除高亮
                  const related = e.relatedTarget as Node | null;
                  if (related && (e.currentTarget as Node).contains(related)) return;
                  setDragOverGroup((cur) => (cur === id ? null : cur));
                }}
                onDrop={async (e) => {
                  e.preventDefault();
                  setDragOverGroup(null);
                  const hostName = e.dataTransfer.getData("application/x-host-name");
                  if (!hostName) return;
                  // 拖到所属分组不变则跳过
                  const targetGroupID = id === UNGROUPED_ID ? "" : id;
                  await assignHost(hostName, targetGroupID);
                }}
                className={cn(
                  "rounded-md transition-colors",
                  dragOverGroup === id && "bg-primary/10 ring-1 ring-primary/40"
                )}
              >
                <div className="group flex items-center">
                  <button
                    onClick={() =>
                      setCollapsed((c) => ({ ...c, [id]: !isCollapsed }))
                    }
                    className="flex h-7 w-6 items-center justify-center text-muted-foreground hover:text-foreground"
                  >
                    <ChevronRight
                      className={cn(
                        "h-3 w-3 transition-transform",
                        !isCollapsed && "rotate-90"
                      )}
                    />
                  </button>
                  <button
                    onClick={() => openGroupTab(id, name)}
                    onContextMenu={(e) => openGroupMenu(e, id, name)}
                    className={cn(
                      "flex flex-1 items-center gap-1.5 rounded-md px-1.5 py-1.5 text-xs font-medium transition-colors",
                      isGroupActive
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                    )}
                  >
                    {isGroupActive ? (
                      <LayoutGrid className="h-3 w-3" />
                    ) : (
                      <Folder className="h-3 w-3" />
                    )}
                    <span className="flex-1 truncate text-left">{name}</span>
                    {openedIds.has(id) && (
                      <span
                        className={cn(
                          "h-1.5 w-1.5 rounded-full",
                          isGroupActive ? "bg-primary-foreground" : "bg-primary"
                        )}
                      />
                    )}
                    <span
                      className={cn(
                        "text-[10px] tabular-nums",
                        isGroupActive
                          ? "text-primary-foreground/70"
                          : "text-muted-foreground"
                      )}
                    >
                      {node.hosts.length}
                    </span>
                  </button>
                </div>

                {!isCollapsed && (
                  <div className="ml-3 mt-0.5 space-y-0.5 border-l border-border pl-2">
                    {node.hosts.map((h) => {
                      const active = activeTabId === h.name;
                      const isOpened = openedIds.has(h.name);
                      return (
                        <button
                          key={h.name}
                          draggable
                          onDragStart={(e) => {
                            e.dataTransfer.setData("application/x-host-name", h.name);
                            e.dataTransfer.effectAllowed = "move";
                          }}
                          onClick={() => openHostTab(h.name)}
                          onContextMenu={(e) =>
                            openHostMenu(e, {
                              name: h.name,
                              user: h.user,
                              hostName: h.hostName,
                            })
                          }
                          className={cn(
                            "group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-all",
                            active
                              ? "bg-primary text-primary-foreground shadow-sm"
                              : "text-foreground/80 hover:bg-accent hover:text-accent-foreground"
                          )}
                        >
                          <Server
                            className={cn(
                              "h-3 w-3 shrink-0",
                              active
                                ? "text-primary-foreground"
                                : "text-muted-foreground"
                            )}
                          />
                          <div className="flex-1 min-w-0">
                            <div className="truncate font-medium">{h.name}</div>
                            <div
                              className={cn(
                                "truncate text-[10px]",
                                active
                                  ? "text-primary-foreground/70"
                                  : "text-muted-foreground"
                              )}
                            >
                              {h.user || "?"}@{h.hostName || "?"}
                            </div>
                          </div>
                          {/* 已打开指示器 */}
                          {isOpened && !active && (
                            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                          )}
                          {h.port && h.port !== "22" && (
                            <Badge
                              variant="outline"
                              className={cn(
                                "h-4 px-1 text-[9px]",
                                active ? "border-primary-foreground/30" : ""
                              )}
                            >
                              :{h.port}
                            </Badge>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </ScrollArea>

      <div className="border-t border-border p-3">
        <div className="text-[10px] text-muted-foreground">
          共 {hosts.length} 台主机
        </div>
      </div>

      {/* 右键菜单（fixed 定位到鼠标坐标） */}
      {menu && (
        <div
          ref={menuRef}
          className="fixed z-50 min-w-[180px] rounded-md border border-border bg-popover p-1 shadow-lg"
          style={{ left: menu.x, top: menu.y }}
        >
          <button
            className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-accent"
            onClick={() => {
              if (menu.kind === "host") openHostTab(menu.id);
              else openGroupTab(menu.id, menu.name);
              setMenu(null);
            }}
          >
            <ExternalLink className="h-3.5 w-3.5" />
            在新标签页打开
          </button>
          {menu.kind === "host" && (
            <button
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-accent"
              onClick={() => {
                openHostTab(menu.id);
                setMenu(null);
              }}
            >
              <ArrowRightLeft className="h-3.5 w-3.5" />
              跳转到此主机
            </button>
          )}
          {menu.kind === "host" && menu.info && (
            <button
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-accent"
              onClick={() => {
                navigator.clipboard?.writeText(menu.info!);
                setMenu(null);
              }}
            >
              <Copy className="h-3.5 w-3.5" />
              复制 {menu.info}
            </button>
          )}
          {menu.kind === "host" && (
            <button
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-accent"
              onClick={async () => {
                const oldName = menu.id;
                setMenu(null);
                const newName = window.prompt(
                  `重命名主机别名「${oldName}」\n将同步更新 ~/.ssh/config`,
                  oldName
                );
                if (!newName || newName === oldName) return;
                try {
                  await api.renameHost(oldName, newName);
                  await refresh();
                } catch (e) {
                  alert(`重命名失败: ${e}`);
                }
              }}
            >
              <Edit3 className="h-3.5 w-3.5" />
              重命名
            </button>
          )}
        </div>
      )}
    </aside>
  );
}
