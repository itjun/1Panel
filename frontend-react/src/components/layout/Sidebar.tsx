import { useMemo, useState, useEffect, useRef } from "react";
import {
  ChevronRight,
  Folder,
  Server,
  Search,
  ExternalLink,
  Copy,
  ArrowRightLeft,
  Edit3,
  FolderInput,
  Plus,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Dialog } from "@/components/ui/dialog";
import { AppLogo } from "@/components/common/AppLogo";
import { cn } from "@/lib/utils";
import { useApp, UNGROUPED_ID } from "@/store/app";
import { api } from "@/lib/api";

// 1Panel 侧栏宽 180px；别名过长时最多扩到 260
const SIDEBAR_MIN_WIDTH = 180;
const SIDEBAR_MAX_WIDTH = 260;
// 主机行除文字外的固定占用（icon+padding+extra）
const HOST_ROW_CHROME = 72;
// 移动超过该像素才算开始拖拽（避免误触）
const DRAG_THRESHOLD_PX = 6;

// 右键菜单目标
interface MenuTarget {
  kind: "host" | "group" | "blank";
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
    renameGroup,
    createGroup,
    refresh,
  } = useApp();
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [query, setQuery] = useState("");
  const [menu, setMenu] = useState<MenuTarget | null>(null);
  // 指针拖拽：目标分组高亮 / 正在拖的主机 / 幽灵位置
  const [dragOverGroup, setDragOverGroup] = useState<string | null>(null);
  const [draggingHost, setDraggingHost] = useState<string | null>(null);
  const [ghostPos, setGhostPos] = useState<{ x: number; y: number } | null>(null);
  const [width, setWidth] = useState(SIDEBAR_MIN_WIDTH);
  const menuRef = useRef<HTMLDivElement>(null);
  // 分组重命名对话框（不用 window.prompt：Wails WebView 里常失效）
  const [renameDlg, setRenameDlg] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [renameInput, setRenameInput] = useState("");
  const [renameBusy, setRenameBusy] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);
  // 新建分组对话框
  const [createOpen, setCreateOpen] = useState(false);
  const [createInput, setCreateInput] = useState("");
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  // 拖拽结束后抑制紧随其后的 click（避免误开标签）
  const suppressClickRef = useRef(false);
  // 最新 groupNodes，供 pointerup 闭包读取
  const groupNodesRef = useRef(groupNodes);
  groupNodesRef.current = groupNodes;
  const assignHostRef = useRef(assignHost);
  assignHostRef.current = assignHost;

  // 别名较长时自动扩容侧边栏（只扩不缩，且不超过 SIDEBAR_MAX_WIDTH）
  useEffect(() => {
    if (hosts.length === 0) return;

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.font = "400 14px Helvetica Neue, PingFang SC, sans-serif";

    let maxText = 0;
    for (const h of hosts) {
      if (!h.name) continue;
      maxText = Math.max(maxText, ctx.measureText(h.name).width);
    }
    for (const node of groupNodes) {
      const name = node.group?.name ?? "未分组";
      maxText = Math.max(maxText, ctx.measureText(name).width);
    }

    const needed = Math.ceil(maxText + HOST_ROW_CHROME);
    const next = Math.max(
      SIDEBAR_MIN_WIDTH,
      Math.min(SIDEBAR_MAX_WIDTH, needed)
    );
    if (next > width) {
      setWidth(next);
    }
  }, [hosts, groupNodes, width]);

  const filtered = useMemo(() => {
    let nodes = groupNodes;
    if (query.trim()) {
      const q = query.toLowerCase();
      nodes = groupNodes
        .map((node) => ({
          ...node,
          hosts: node.hosts.filter(
            (h) =>
              h.name.toLowerCase().includes(q) ||
              (h.hostName || "").toLowerCase().includes(q)
          ),
        }))
        .filter((node) => node.hosts.length > 0);
    }
    // 拖拽中：即使「未分组」当前为空，也渲染出来作为放置目标
    // 否则主机只能进分组、无法拖回未分组
    if (draggingHost) {
      const hasUngrouped = nodes.some((n) => n.group == null);
      if (!hasUngrouped) {
        nodes = [...nodes, { group: null, hosts: [] }];
      }
    }
    return nodes;
  }, [groupNodes, query, draggingHost]);

  const openedIds = useMemo(() => new Set(tabs.map((t) => t.id)), [tabs]);

  // 可移动到的分组列表（含未分组），用于右键菜单
  const moveTargets = useMemo(() => {
    const list: { id: string; name: string }[] = groupNodes
      .filter((n) => n.group != null)
      .map((n) => ({ id: n.group!.id, name: n.group!.name }));
    list.push({ id: UNGROUPED_ID, name: "未分组" });
    return list;
  }, [groupNodes]);

  // 点击菜单外部关闭菜单
  useEffect(() => {
    if (!menu) return;
    const onClick = () => setMenu(null);
    const onEsc = (e: KeyboardEvent) => e.key === "Escape" && setMenu(null);
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

  const openCreateGroup = () => {
    setCreateInput("");
    setCreateError(null);
    setCreateOpen(true);
    setMenu(null);
  };

  const submitCreateGroup = async () => {
    if (createBusy) return;
    const name = createInput.trim();
    if (!name) {
      setCreateError("分组名称不能为空");
      return;
    }
    setCreateBusy(true);
    setCreateError(null);
    try {
      const id = await createGroup(name);
      setCreateOpen(false);
      setCreateInput("");
      // 展开并打开新分组
      setCollapsed((c) => ({ ...c, [id]: false }));
      openGroupTab(id, name);
    } catch (err) {
      setCreateError(String(err));
    } finally {
      setCreateBusy(false);
    }
  };

  const findHostGroupId = (hostName: string, nodes = groupNodesRef.current): string => {
    for (const node of nodes) {
      if (node.hosts.some((h) => h.name === hostName)) {
        return node.group?.id ?? UNGROUPED_ID;
      }
    }
    return UNGROUPED_ID;
  };

  const moveHostToGroup = async (hostName: string, groupId: string) => {
    const current = findHostGroupId(hostName);
    if (current === groupId) return;
    const targetGroupID = groupId === UNGROUPED_ID ? "" : groupId;
    try {
      await assignHostRef.current(hostName, targetGroupID);
    } catch (err) {
      console.error("移动主机到分组失败:", err);
      alert(`移动失败: ${err}`);
    }
  };

  /**
   * 指针拖拽（不走 HTML5 DnD）
   * Wails / WKWebView 对 HTML5 drag&drop 支持差：button+draggable 经常不触发 drop。
   * 用 pointerdown/move/up + elementFromPoint 在本应用内可靠完成分组移动。
   */
  const onHostPointerDown = (e: React.PointerEvent, hostName: string) => {
    // 仅左键；右键留给菜单
    if (e.button !== 0) return;

    const startX = e.clientX;
    const startY = e.clientY;
    let active = false;

    const cleanup = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    const groupIdAtPoint = (x: number, y: number): string | null => {
      // 幽灵层 pointer-events:none，不会挡住探测
      const el = document.elementFromPoint(x, y);
      if (!el) return null;
      const groupEl = el.closest("[data-group-id]") as HTMLElement | null;
      return groupEl?.dataset.groupId ?? null;
    };

    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (!active) {
        if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
        active = true;
        suppressClickRef.current = true;
        setDraggingHost(hostName);
        document.body.style.cursor = "grabbing";
        document.body.style.userSelect = "none";
      }
      setGhostPos({ x: ev.clientX, y: ev.clientY });
      setDragOverGroup(groupIdAtPoint(ev.clientX, ev.clientY));
    };

    const onUp = (ev: PointerEvent) => {
      cleanup();
      if (!active) {
        // 未形成拖拽：当作普通点击，由 onClick 处理
        setDraggingHost(null);
        setDragOverGroup(null);
        setGhostPos(null);
        return;
      }

      const targetGroupId = groupIdAtPoint(ev.clientX, ev.clientY);
      setDraggingHost(null);
      setDragOverGroup(null);
      setGhostPos(null);

      if (!targetGroupId) return;
      void moveHostToGroup(hostName, targetGroupId);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  };

  return (
    <aside
      className="panel-sidebar flex h-full min-h-0 flex-col"
      style={{ width }}
    >
      {/* Logo 区：1Panel 官方字标，高 49px */}
      <div className="panel-sidebar-logo">
        <AppLogo variant="full" sizeClassName="h-[28px] w-[102px]" />
      </div>

      {/* 搜索（功能保留，视觉压进菜单区） */}
      <div className="px-[7px] pb-1">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#909399]" />
          <Input
            placeholder="搜索主机..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="h-8 border-0 bg-white/30 pl-8 text-[13px] shadow-none placeholder:text-[#a8abb2] focus-visible:ring-0"
          />
        </div>
      </div>

      {/* 菜单列表：padding 0 7px，项高 42 + margin 7 */}
      <ScrollArea className="min-h-0 flex-1">
        <nav
          className="panel-sidebar-menu pb-2"
          onContextMenu={(e) => {
            const target = e.target as HTMLElement;
            if (target.closest("[data-group-id]")) return;
            e.preventDefault();
            setMenu({
              kind: "blank",
              id: "",
              name: "",
              x: e.clientX,
              y: e.clientY,
            });
          }}
        >
          {filtered.length === 0 && (
            <div className="px-3 py-8 text-center text-[13px] text-[#909399]">
              {hosts.length === 0 ? "暂无主机" : "无匹配结果"}
            </div>
          )}

          {filtered.map((node) => {
            const id = node.group?.id ?? UNGROUPED_ID;
            const name = node.group?.name ?? "未分组";
            const isCollapsed = collapsed[id] === true;
            const isGroupActive = activeTabId === id;
            const isDropTarget = dragOverGroup === id;
            const groupHasOpenChild = node.hosts.some((h) =>
              openedIds.has(h.name)
            );

            return (
              <div
                key={id}
                data-group-id={id}
                className={cn(
                  isDropTarget && "rounded bg-[#005eeb14]",
                  draggingHost && !isDropTarget && "opacity-90"
                )}
              >
                {/* 分组 = el-sub-menu__title */}
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => {
                    if (suppressClickRef.current) {
                      suppressClickRef.current = false;
                      return;
                    }
                    // 单击：展开/收起 + 打开分组概览
                    setCollapsed((c) => ({ ...c, [id]: !isCollapsed }));
                    openGroupTab(id, name);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setCollapsed((c) => ({ ...c, [id]: !isCollapsed }));
                      openGroupTab(id, name);
                    }
                  }}
                  onContextMenu={(e) => openGroupMenu(e, id, name)}
                  className={cn(
                    "panel-menu-item",
                    isGroupActive && "panel-menu-item-active"
                  )}
                >
                  <Folder className="panel-menu-icon" strokeWidth={1.75} />
                  <span className="panel-menu-label">{name}</span>
                  {(openedIds.has(id) || groupHasOpenChild) &&
                    !isGroupActive && (
                      <span className="mr-1 h-1.5 w-1.5 shrink-0 rounded-full bg-[#005eeb]" />
                    )}
                  <span className="panel-menu-extra tabular-nums">
                    {node.hosts.length}
                  </span>
                  <ChevronRight
                    className={cn(
                      "panel-menu-chevron",
                      !isCollapsed && "panel-menu-chevron-open"
                    )}
                    strokeWidth={2}
                  />
                </div>

                {/* 主机 = 嵌套 el-menu-item，pl:35px */}
                {!isCollapsed &&
                  node.hosts.map((h) => {
                    const active = activeTabId === h.name;
                    const isOpened = openedIds.has(h.name);
                    return (
                      <button
                        key={h.name}
                        type="button"
                        onPointerDown={(e) => onHostPointerDown(e, h.name)}
                        onClick={() => {
                          if (suppressClickRef.current) {
                            suppressClickRef.current = false;
                            return;
                          }
                          openHostTab(h.name);
                        }}
                        onContextMenu={(e) =>
                          openHostMenu(e, {
                            name: h.name,
                            user: h.user,
                            hostName: h.hostName,
                          })
                        }
                        title={`${h.user || "?"}@${h.hostName || "?"}${
                          h.port && h.port !== "22" ? ":" + h.port : ""
                        } · 拖到其他分组`}
                        className={cn(
                          "panel-menu-item panel-menu-item-sub",
                          active && "panel-menu-item-active",
                          draggingHost === h.name && "opacity-40"
                        )}
                      >
                        <Server
                          className="panel-menu-icon"
                          strokeWidth={1.75}
                        />
                        <span className="panel-menu-label">{h.name}</span>
                        {isOpened && !active && (
                          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#005eeb]" />
                        )}
                      </button>
                    );
                  })}
              </div>
            );
          })}
        </nav>
      </ScrollArea>

      {/* 底部：新建分组（钉在最底） */}
      <div className="panel-sidebar-menu shrink-0 pb-3 pt-1">
        <button
          type="button"
          onClick={() => {
            setCreateInput("");
            setCreateError(null);
            setCreateOpen(true);
          }}
          className="panel-menu-item justify-center gap-1.5 !bg-transparent !shadow-none"
          style={{
            border: "1px dashed rgba(0, 94, 235, 0.35)",
            color: "#646a73",
          }}
        >
          <Plus className="panel-menu-icon" strokeWidth={1.75} />
          <span className="text-[13px]">新建分组</span>
        </button>
        <div className="mt-1 text-center text-[11px] text-[#909399]">
          共 {hosts.length} 台主机
          {draggingHost ? " · 拖到目标分组" : ""}
        </div>
      </div>

      {/* 拖拽幽灵：跟随指针，不拦截命中检测 */}
      {draggingHost && ghostPos && (
        <div
          className="pointer-events-none fixed z-[100] flex items-center gap-1.5 rounded-md border border-primary/40 bg-popover px-2 py-1.5 text-xs shadow-lg"
          style={{
            left: ghostPos.x + 12,
            top: ghostPos.y + 12,
          }}
        >
          <Server className="h-3 w-3 text-primary" />
          <span className="font-medium">{draggingHost}</span>
        </div>
      )}

      {/* 新建分组对话框 */}
      <Dialog
        open={createOpen}
        onClose={() => {
          if (createBusy) return;
          setCreateOpen(false);
          setCreateError(null);
        }}
        title="新建分组"
        width="400px"
      >
        <div className="space-y-3">
          <p className="text-[11px] text-muted-foreground">
            创建空分组后，可将主机拖入，或在主机右键中选择「移动到分组」。
          </p>
          <Input
            autoFocus
            value={createInput}
            onChange={(e) => setCreateInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void submitCreateGroup();
              }
            }}
            placeholder="如：生产环境、测试集群"
            className="h-9 text-sm"
          />
          {createError && (
            <p className="text-[11px] text-destructive">{createError}</p>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 text-xs"
              disabled={createBusy}
              onClick={() => setCreateOpen(false)}
            >
              取消
            </Button>
            <Button
              type="button"
              size="sm"
              className="h-8 text-xs"
              disabled={createBusy || !createInput.trim()}
              onClick={() => void submitCreateGroup()}
            >
              {createBusy ? "创建中…" : "创建"}
            </Button>
          </div>
        </div>
      </Dialog>

      {/* 分组重命名对话框 */}
      <Dialog
        open={!!renameDlg}
        onClose={() => {
          if (renameBusy) return;
          setRenameDlg(null);
          setRenameError(null);
        }}
        title="重命名分组"
        width="400px"
      >
        <div className="space-y-3">
          <p className="text-[11px] text-muted-foreground">
            当前名称：{renameDlg?.name}
          </p>
          <Input
            autoFocus
            value={renameInput}
            onChange={(e) => setRenameInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void (async () => {
                  if (!renameDlg || renameBusy) return;
                  const next = renameInput.trim();
                  if (!next || next === renameDlg.name) {
                    setRenameDlg(null);
                    return;
                  }
                  setRenameBusy(true);
                  setRenameError(null);
                  try {
                    await renameGroup(renameDlg.id, next);
                    setRenameDlg(null);
                  } catch (err) {
                    setRenameError(String(err));
                  } finally {
                    setRenameBusy(false);
                  }
                })();
              }
            }}
            placeholder="新的分组名称"
            className="h-9 text-sm"
          />
          {renameError && (
            <p className="text-[11px] text-destructive">{renameError}</p>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 text-xs"
              disabled={renameBusy}
              onClick={() => setRenameDlg(null)}
            >
              取消
            </Button>
            <Button
              type="button"
              size="sm"
              className="h-8 text-xs"
              disabled={renameBusy || !renameInput.trim()}
              onClick={async () => {
                if (!renameDlg || renameBusy) return;
                const next = renameInput.trim();
                if (!next || next === renameDlg.name) {
                  setRenameDlg(null);
                  return;
                }
                setRenameBusy(true);
                setRenameError(null);
                try {
                  await renameGroup(renameDlg.id, next);
                  setRenameDlg(null);
                } catch (err) {
                  setRenameError(String(err));
                } finally {
                  setRenameBusy(false);
                }
              }}
            >
              {renameBusy ? "保存中…" : "保存"}
            </Button>
          </div>
        </div>
      </Dialog>

      {/* 右键菜单 */}
      {menu && (
        <div
          ref={menuRef}
          className="fixed z-50 min-w-[180px] rounded border border-card-border bg-popover p-1 shadow-panel"
          style={{ left: menu.x, top: menu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          {menu.kind !== "blank" && (
            <button
              type="button"
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
          )}
          {/* 空白处 / 任意分组右键：新建分组 */}
          {(menu.kind === "blank" || menu.kind === "group") && (
            <button
              type="button"
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-accent"
              onClick={openCreateGroup}
            >
              <Plus className="h-3.5 w-3.5" />
              新建分组
            </button>
          )}
          {menu.kind === "host" && (
            <button
              type="button"
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
              type="button"
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
              type="button"
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
          {/* 分组重命名（「未分组」虚拟桶不可改） */}
          {menu.kind === "group" && menu.id !== UNGROUPED_ID && (
            <button
              type="button"
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-accent"
              onClick={() => {
                setRenameDlg({ id: menu.id, name: menu.name });
                setRenameInput(menu.name);
                setRenameError(null);
                setMenu(null);
              }}
            >
              <Edit3 className="h-3.5 w-3.5" />
              重命名分组
            </button>
          )}

          {/* 右键「移动到分组」——拖拽失效时的可靠兜底 */}
          {menu.kind === "host" && moveTargets.length > 0 && (
            <>
              <div className="my-1 h-px bg-border" />
              <div className="px-2 py-1 text-[10px] font-medium text-muted-foreground">
                移动到分组
              </div>
              {moveTargets.map((t) => {
                const current = findHostGroupId(menu.id);
                const isCurrent = current === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    disabled={isCurrent}
                    className={cn(
                      "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs",
                      isCurrent
                        ? "cursor-default text-muted-foreground/50"
                        : "hover:bg-accent"
                    )}
                    onClick={() => {
                      const hostName = menu.id;
                      setMenu(null);
                      void moveHostToGroup(hostName, t.id);
                    }}
                  >
                    <FolderInput className="h-3.5 w-3.5" />
                    {t.name}
                    {isCurrent && (
                      <span className="ml-auto text-[10px]">当前</span>
                    )}
                  </button>
                );
              })}
            </>
          )}
        </div>
      )}
    </aside>
  );
}
