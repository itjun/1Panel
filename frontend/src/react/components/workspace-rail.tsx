/**
 * WorkspaceRail — 二级标签栏：当前一级模块的分区 / 已打开主机与分组。
 */

import {
  useEffect,
  useRef,
  useState,
  type DragEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { api } from "@/api";
import { HostContextMenu, type HostContextMenuState } from "@/react/components/host-context-menu";
import { SettingsNavigation } from "@/react/components/settings-navigation";
import { NotifyNavigation } from "@/react/components/notify/navigation";
import { alertDialog } from "@/react/components/ui/confirm-dialog";
import { cn } from "@/react/lib/utils";
import {
  UNGROUPED_ID,
  useSession,
  type SpeedtestSection,
} from "@/react/state/session";
import { readSettings } from "@/react/state/settings";
import { useSidebar } from "@/react/state/sidebar";
import { LOCAL_SECTIONS } from "@/react/pages/local";
import { clampContextMenuPos } from "@/utils/contextMenuPos";
import {
  buildRailGroups,
  railOrderOf,
  reorderRailGroups,
  resolveRailDrop,
  type RailDrop,
} from "@/utils/railGroups";

const RAIL_ORDER_KEY = "1pannel-rail-order";
const VISITED_GROUPS_KEY = "1pannel-visited-groups";
const RAIL_ENTRY_MIME = "application/x-rail-entry";

const SPEEDTEST_SECTIONS: { id: SpeedtestSection; label: string }[] = [
  { id: "pair", label: "两机测速" },
  { id: "group", label: "分组测速" },
  { id: "history", label: "历史记录" },
];

type GroupMenu = { id: string; x: number; y: number };

function loadStringList(key: string): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(key) || "[]");
    if (!Array.isArray(raw)) return [];
    return raw.filter((x): x is string => typeof x === "string" && !!x);
  } catch {
    return [];
  }
}

function saveStringList(key: string, list: string[]) {
  try {
    localStorage.setItem(key, JSON.stringify(list));
  } catch {
    /* ignore */
  }
}

export function WorkspaceRail() {
  const session = useSession();
  const { width: sidebarWidth } = useSidebar();
  const [visitedGroupIds, setVisitedGroupIds] = useState(() =>
    loadStringList(VISITED_GROUPS_KEY),
  );
  const [railOrder, setRailOrder] = useState(() => loadStringList(RAIL_ORDER_KEY));
  const [selectedHostNames, setSelectedHostNames] = useState<string[]>([]);
  const hostAnchorRef = useRef("");
  const suppressHostClickRef = useRef(false);

  const [hostMenu, setHostMenu] = useState<HostContextMenuState | null>(null);
  const [groupMenu, setGroupMenu] = useState<GroupMenu | null>(null);

  const [railDragKey, setRailDragKey] = useState("");
  const [railDrop, setRailDrop] = useState<RailDrop | null>(null);
  // 会话行的悬停由 JS 记录单一行：WebKit 拖放结束后不刷新 :hover，拖过的行会残留高亮
  const [hoverKey, setHoverKey] = useState("");

  // 打开过的分组记入侧栏（本组件本地持久化）
  useEffect(() => {
    if (session.settingsOpen) return;
    if (session.workspace !== "remote") return;
    if (session.homeView !== "group") return;
    const id = (session.activeGroupId || "").trim();
    if (!id) return;
    setVisitedGroupIds((prev) => {
      if (prev.includes(id)) return prev;
      const next = [...prev, id];
      saveStringList(VISITED_GROUPS_KEY, next);
      return next;
    });
  }, [
    session.activeGroupId,
    session.homeView,
    session.settingsOpen,
    session.workspace,
  ]);

  // 已关闭的主机从多选里剔除
  useEffect(() => {
    const names = new Set(session.openedHosts.map((h) => h.name));
    setSelectedHostNames((prev) => prev.filter((n) => names.has(n)));
  }, [session.openedHosts]);

  // 从首页 / 分组页等侧栏以外的入口切换当前主机时，旧多选不含新主机，重置为只选当前主机，
  // 否则上一台主机残留 selected 浅底，与新主机 active 叠出双高亮
  useEffect(() => {
    const host = session.activeHost;
    if (!host) return;
    setSelectedHostNames((prev) => {
      if (prev.includes(host)) return prev;
      hostAnchorRef.current = host;
      return [host];
    });
  }, [session.activeHost]);

  // 进入分组页时清掉主机多选，避免与分组 active 叠出双高亮
  useEffect(() => {
    if (session.homeView !== "group") return;
    if (session.activeHost) return;
    setSelectedHostNames((prev) => (prev.length === 0 ? prev : []));
    hostAnchorRef.current = "";
  }, [session.activeGroupId, session.activeHost, session.homeView]);

  function closeGroupTab(id: string) {
    const gid = id.trim();
    if (!gid) return;
    setVisitedGroupIds((prev) => {
      const next = prev.filter((x) => x !== gid);
      saveStringList(VISITED_GROUPS_KEY, next);
      return next;
    });
    if (
      session.homeView === "group" &&
      session.activeGroupId === gid &&
      !session.activeHost
    ) {
      session.goHome();
    }
  }

  const railGroups = buildRailGroups({
    openedHosts: session.openedHosts.map((host) => host.name),
    visitedGroupIds,
    railOrder,
    groupIdOf: session.groupIdOf,
    ungroupedId: UNGROUPED_ID,
  });
  const visibleHostNames = railGroups.flatMap((group) => group.hosts);

  function moveRailEntry(sourceKey: string, drop: RailDrop) {
    const next = reorderRailGroups(railGroups, sourceKey, drop);
    if (!next) return;
    const keys = railOrderOf(next);
    setRailOrder(keys);
    saveStringList(RAIL_ORDER_KEY, keys);
    // 主机顺序同步进 session（分组顺序只存在本组件）
    const hostNames = next.flatMap((group) => group.hosts);
    if (hostNames.length > 0) session.reorderOpenedHosts(hostNames);
  }

  function startRailDrag(event: DragEvent<HTMLButtonElement>, key: string) {
    suppressHostClickRef.current = true;
    setHoverKey("");
    setRailDrop(null);
    setRailDragKey(key);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData(RAIL_ENTRY_MIME, key);
    event.dataTransfer.setData("text/plain", key);
    if (railGroups.some((group) => group.key === key)) {
      const block = event.currentTarget.closest<HTMLElement>("[data-rail-group]");
      if (block) {
        const rect = block.getBoundingClientRect();
        event.dataTransfer.setDragImage(block, event.clientX - rect.left, event.clientY - rect.top);
      }
    }
  }

  function dropAt(event: DragEvent<HTMLButtonElement>, targetKey: string, sourceKey: string) {
    const movingGroup = railGroups.some((group) => group.key === sourceKey);
    const target = movingGroup
      ? event.currentTarget.closest<HTMLElement>("[data-rail-group]")!
      : event.currentTarget;
    const rect = target.getBoundingClientRect();
    return resolveRailDrop(railGroups, sourceKey, targetKey, event.clientY < rect.top + rect.height / 2);
  }

  function overRailEntry(event: DragEvent<HTMLButtonElement>, key: string) {
    if (!Array.from(event.dataTransfer.types).includes(RAIL_ENTRY_MIME)) return;
    const drop = dropAt(event, key, railDragKey);
    setRailDrop(drop);
    if (!drop) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }

  function dropRailEntry(event: DragEvent<HTMLButtonElement>, key: string) {
    if (!Array.from(event.dataTransfer.types).includes(RAIL_ENTRY_MIME)) return;
    event.preventDefault();
    const source = event.dataTransfer.getData(RAIL_ENTRY_MIME) || railDragKey;
    const drop = dropAt(event, key, source);
    setRailDrop(null);
    if (drop) moveRailEntry(source, drop);
  }

  function endRailDrag() {
    setRailDragKey("");
    setRailDrop(null);
    setHoverKey("");
    window.setTimeout(() => {
      suppressHostClickRef.current = false;
    }, 0);
  }

  /** 右键主机行：只弹主机操作菜单，不切换主机、不改多选。行在多选里就作用于整个多选。 */
  function openHostMenu(name: string, x: number, y: number) {
    let hosts = [name];
    if (selectedHostNames.length >= 2 && selectedHostNames.includes(name)) {
      hosts = visibleHostNames.filter((name) => selectedHostNames.includes(name));
    }
    setHostMenu({ host: name, hosts, x, y });
  }

  function clearHostSelection() {
    setSelectedHostNames([]);
    hostAnchorRef.current = "";
  }

  const listKind = session.settingsOpen
    ? "settings"
    : session.workspace === "notify"
        ? "notify"
        : session.workspace === "local"
          ? "local"
          : session.workspace === "inspect"
            ? "inspect"
            : session.workspace === "speedtest"
              ? "speedtest"
              : "hosts";

  return (
      <aside
        className="glass-chrome flex shrink-0 flex-col pb-2.5"
        style={{ width: sidebarWidth, minWidth: sidebarWidth }}
        aria-label="二级导航"
      >
      <div
        key={listKind}
        className="motion-fade-in flex min-h-0 flex-1 flex-col overflow-auto"
        onPointerLeave={() => setHoverKey("")}
        onContextMenu={(e) => {
          if (listKind !== "hosts") return;
          if ((e.target as HTMLElement).closest("button")) return;
          e.preventDefault();
          setSelectedHostNames([]);
          hostAnchorRef.current = "";
        }}
      >
        {listKind === "notify" ? <NotifyNavigation /> : null}

        {listKind === "local"
          ? LOCAL_SECTIONS.map((item) => (
              <RailNavButton
                key={item.id}
                label={item.label}
                active={session.localSection === item.id}
                onClick={() => session.setLocalSection(item.id)}
              />
            ))
          : null}

        {listKind === "settings" ? <SettingsNavigation /> : null}

        {listKind === "speedtest"
          ? SPEEDTEST_SECTIONS.map((item) => (
              <RailNavButton
                key={item.id}
                label={item.label}
                active={session.speedtestSection === item.id}
                onClick={() => session.setSpeedtestSection(item.id)}
              />
            ))
          : null}

        {listKind === "inspect" ? (
          <RailNavButton
            label="HTTP 巡检"
            active
            onClick={() => session.setInspectSection("menuCheck")}
          />
        ) : null}

        {listKind === "hosts" ? (
          <>
            <RailNavButton
              label="全部主机"
              active={
                session.workspace === "remote" &&
                !session.activeHost &&
                session.homeView === "home"
              }
              onClick={() => {
                clearHostSelection();
                session.goHome();
              }}
            />
            {railGroups.length > 0 ? <div className="h-2 shrink-0" /> : null}
            {railGroups.map((group) => (
              <div
                key={group.key}
                data-rail-group={group.key}
                className={cn(
                  "relative flex shrink-0 flex-col",
                  railDragKey === group.key && "opacity-40",
                )}
              >
                <RailSessionRow
                  entryKey={group.key}
                  onActivate={() => { clearHostSelection(); session.openGroup(group.id); }}
                  label={session.groupName(group.id) || group.id}
                  prefix="组"
                  active={
                    !session.settingsOpen &&
                    session.homeView === "group" &&
                    !session.activeHost &&
                    session.activeGroupId === group.id
                  }
                  selected={false}
                  hovered={hoverKey === group.key}
                  onHover={() => setHoverKey(group.key)}
                  dragging={false}
                  dropEdge={null}
                  onPointerDown={(e) => {
                    if (e.button !== 0 || suppressHostClickRef.current) return;
                    clearHostSelection();
                    session.openGroup(group.id);
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    const pos = clampContextMenuPos(e.clientX, e.clientY, 180, 96);
                    setGroupMenu({ id: group.id, x: pos.x, y: pos.y });
                  }}
                  onDragStart={(e) => startRailDrag(e, group.key)}
                  onDragOver={(e) => overRailEntry(e, group.key)}
                  onDrop={(e) => dropRailEntry(e, group.key)}
                  onDragEnd={endRailDrag}
                />
                {group.hosts.map((name) => (
                  <RailSessionRow
                    key={name}
                    entryKey={name}
                    onActivate={() => {
                      setHostMenu(null);
                      setSelectedHostNames([name]);
                      hostAnchorRef.current = name;
                      session.openHost(name);
                    }}
                    label={name}
                    indented
                    active={session.activeHost === name}
                    selected={!!session.activeHost && selectedHostNames.includes(name)}
                    hovered={hoverKey === name}
                    onHover={() => setHoverKey(name)}
                    dragging={railDragKey === name}
                    dropEdge={railDrop?.key === name ? (railDrop.before ? "before" : "after") : null}
                    onPointerDown={(e) => {
                      if (e.button !== 0 || suppressHostClickRef.current) return;
                      if (e.metaKey || e.ctrlKey) {
                        e.preventDefault();
                        setSelectedHostNames((prev) => {
                          const next = new Set(prev);
                          if (next.has(name)) next.delete(name);
                          else next.add(name);
                          return [...next];
                        });
                        hostAnchorRef.current = name;
                        return;
                      }
                      if (e.shiftKey && hostAnchorRef.current) {
                        e.preventDefault();
                        const from = visibleHostNames.indexOf(hostAnchorRef.current);
                        const to = visibleHostNames.indexOf(name);
                        if (from < 0 || to < 0) return;
                        const lo = Math.min(from, to);
                        const hi = Math.max(from, to);
                        setSelectedHostNames(visibleHostNames.slice(lo, hi + 1));
                        return;
                      }
                      setHostMenu(null);
                      setSelectedHostNames([name]);
                      hostAnchorRef.current = name;
                      session.openHost(name);
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      openHostMenu(name, e.clientX, e.clientY);
                    }}
                    onDragStart={(e) => startRailDrag(e, name)}
                    onDragOver={(e) => overRailEntry(e, name)}
                    onDrop={(e) => dropRailEntry(e, name)}
                    onDragEnd={endRailDrag}
                  />
                ))}
                {railDrop?.key === group.key ? (
                  <span
                    className={cn(
                      "pointer-events-none absolute inset-x-0 h-[3px] bg-accent",
                      railDrop.before ? "top-0" : "bottom-0",
                    )}
                  />
                ) : null}
              </div>
            ))}
          </>
        ) : null}
      </div>

      <HostContextMenu
        menu={hostMenu}
        pinned={session.pinned}
        onClose={() => setHostMenu(null)}
        onOpenInTerminal={(hosts) => {
          clearHostSelection();
          void api
            .openHostsInTerminal(hosts, readSettings().terminalOpenMode, readSettings().terminalApp)
            .catch((err) => {
              void alertDialog({
                theme: "danger",
                title: "终端打开失败",
                body: err instanceof Error ? err.message : String(err),
              });
            });
        }}
        onTogglePin={(host) => session.togglePin(host)}
        onEdit={(name) => session.setEditingHost(name)}
        onDisconnect={(hosts) => {
          for (const name of hosts) session.closeHost(name);
          clearHostSelection();
        }}
      />

      {groupMenu ? (
        <CtxMenu x={groupMenu.x} y={groupMenu.y} onClose={() => setGroupMenu(null)}>
          <CtxItem
            label="关闭分组页"
            onClick={() => {
              const id = groupMenu.id;
              setGroupMenu(null);
              closeGroupTab(id);
            }}
          />
        </CtxMenu>
      ) : null}
    </aside>
  );
}

function RailNavButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  const sidebar = useSidebar();
  return (
    <button
      type="button"
      className={cn(
        "rail-item relative flex h-10 shrink-0 items-center px-3 text-left",
        active ? "rail-item-active" : "text-muted hover:bg-line hover:text-ink",
      )}
      aria-current={active ? "page" : undefined}
      onClick={() => { onClick(); sidebar.closeOverlay(); }}
    >
      <span className="truncate">{label}</span>
    </button>
  );
}

function RailSessionRow({
  entryKey,
  label,
  prefix,
  indented = false,
  active,
  selected,
  hovered,
  onHover,
  dragging,
  dropEdge,
  onPointerDown,
  onActivate,
  onContextMenu,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
}: {
  entryKey: string;
  label: string;
  prefix?: string;
  indented?: boolean;
  active: boolean;
  selected: boolean;
  hovered: boolean;
  onHover: () => void;
  dragging: boolean;
  dropEdge: "before" | "after" | null;
  onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onActivate: () => void;
  onContextMenu: (event: ReactMouseEvent<HTMLButtonElement>) => void;
  onDragStart: (event: DragEvent<HTMLButtonElement>) => void;
  onDragOver: (event: DragEvent<HTMLButtonElement>) => void;
  onDrop: (event: DragEvent<HTMLButtonElement>) => void;
  onDragEnd: () => void;
}) {
  // 侧栏是 canvas 底，raised 对比不够，hover / 多选浅底统一用 line
  let stateClass = "text-muted";
  if (active) {
    stateClass = "rail-item-active";
  } else if (selected || hovered) {
    // 多选中的其他主机：浅底区分，不与当前主机的选中样式混淆
    stateClass = "bg-line text-ink";
  }

  return (
    <button
      type="button"
      draggable
      data-rail-key={entryKey}
      aria-current={active ? "page" : undefined}
      aria-pressed={selected}
      onClick={event => { if (event.detail === 0) onActivate(); }}
      className={cn(
        "rail-item relative flex h-10 shrink-0 cursor-grab select-none items-center gap-1.5 truncate pr-3 text-left active:cursor-grabbing",
        indented ? "pl-7" : "pl-3",
        stateClass,
        dragging && "opacity-40",
      )}
      onPointerMove={onHover}
      onPointerDown={onPointerDown}
      onContextMenu={onContextMenu}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
    >
      {dropEdge === "before" ? (
        <span className="pointer-events-none absolute inset-x-0 top-0 h-[3px] bg-accent" />
      ) : null}
      {prefix ? <span className="shrink-0 text-xs opacity-70">{prefix}</span> : null}
      <span className="truncate">{label}</span>
      {dropEdge === "after" ? (
        <span className="pointer-events-none absolute inset-x-0 bottom-0 h-[3px] bg-accent" />
      ) : null}
    </button>
  );
}

function CtxMenu({
  x,
  y,
  onClose,
  children,
}: {
  x: number;
  y: number;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const pos = clampContextMenuPos(x, y, rect.width, rect.height);
    ref.current.style.left = `${pos.x}px`;
    ref.current.style.top = `${pos.y}px`;
  }, [x, y]);

  return (
    <>
      <div
        className="fixed inset-0 z-[60]"
        onMouseDown={onClose}
        onContextMenu={(e) => {
          e.preventDefault();
          onClose();
        }}
      />
      <div
        ref={ref}
        className="motion-menu-panel fixed z-[61] min-w-[180px] rounded-panel border border-line bg-surface py-1 text-sm text-ink"
        data-open="true"
        style={{ left: x, top: y }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </>
  );
}

function CtxItem({
  label,
  danger,
  onClick,
}: {
  label: string;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={cn(
        "flex w-full items-center px-3 py-2 text-left hover:bg-raised",
        danger && "text-danger hover:bg-danger-soft",
      )}
      onClick={onClick}
    >
      {label}
    </button>
  );
}
