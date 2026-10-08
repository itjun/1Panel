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
import { alertDialog } from "@/react/components/ui/confirm-dialog";
import { Tag } from "@/react/components/ui/tag";
import { LOCAL_SECTIONS } from "@/react/pages/local";
import { cn } from "@/react/lib/utils";
import {
  useSession,
  type ConfigSection,
  type NotifySection,
  type SettingsSection,
  type SpeedtestSection,
} from "@/react/state/session";
import { readSettings } from "@/react/state/settings";
import { useSidebar } from "@/react/state/sidebar";
import { clampContextMenuPos } from "@/utils/contextMenuPos";

const RAIL_ORDER_KEY = "1pannel-rail-order";
const VISITED_GROUPS_KEY = "1pannel-visited-groups";
const RAIL_ENTRY_MIME = "application/x-rail-entry";

const NOTIFY_SECTIONS: { id: NotifySection; label: string }[] = [
  { id: "metricMessages", label: "指标消息" },
  { id: "appMessages", label: "应用消息" },
  { id: "metricSubs", label: "指标订阅" },
  { id: "appSubs", label: "应用订阅" },
  { id: "runLog", label: "运行日志" },
  { id: "setup", label: "通知设置" },
];

const CONFIG_SECTIONS: { id: ConfigSection; label: string }[] = [
  { id: "overview", label: "概览" },
  { id: "json", label: "Panel JSON" },
  { id: "files", label: "SSH 文件" },
  { id: "diff", label: "差异与冲突" },
  { id: "backups", label: "备份" },
];

const SPEEDTEST_SECTIONS: { id: SpeedtestSection; label: string }[] = [
  { id: "pair", label: "两机测速" },
  { id: "group", label: "分组测速" },
  { id: "history", label: "历史记录" },
];

/** 设置页分区，与 SettingsPage 内区块一一对应。 */
const SETTINGS_SECTIONS: { id: SettingsSection; label: string }[] = [
  { id: "look", label: "外观" },
  { id: "session", label: "会话" },
  { id: "board", label: "看板" },
  { id: "app", label: "应用" },
  { id: "shortcuts", label: "快捷键" },
  { id: "about", label: "关于" },
];

type RailEntry =
  | { kind: "host"; key: string; name: string }
  | { kind: "group"; key: string; id: string };

/** 分组 ID 可能与主机名相同，railOrder 里分组键加前缀区分 */
const GROUP_KEY_PREFIX = "group:";
const groupRailKey = (id: string) => GROUP_KEY_PREFIX + id;

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
  const [railDrop, setRailDrop] = useState<{ key: string; before: boolean } | null>(null);
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

  function buildRailEntries(): RailEntry[] {
    const hosts = session.openedHosts;
    const hostNames = new Set(hosts.map((h) => h.name));
    const groups = new Set(visitedGroupIds);
    const out: RailEntry[] = [];
    const seen = new Set<string>();
    const pushGroup = (id: string) => {
      const key = groupRailKey(id);
      if (!groups.has(id) || seen.has(key)) return;
      out.push({ kind: "group", key, id });
      seen.add(key);
    };
    for (const key of railOrder) {
      if (key.startsWith(GROUP_KEY_PREFIX)) {
        pushGroup(key.slice(GROUP_KEY_PREFIX.length));
        continue;
      }
      if (hostNames.has(key)) {
        if (seen.has(key)) continue;
        out.push({ kind: "host", key, name: key });
        seen.add(key);
        continue;
      }
      // 旧版 railOrder 分组键无前缀
      pushGroup(key);
    }
    for (const h of hosts) {
      if (!seen.has(h.name)) out.push({ kind: "host", key: h.name, name: h.name });
    }
    for (const gid of visitedGroupIds) pushGroup(gid);
    return out;
  }

  function moveRailEntry(sourceKey: string, targetKey: string, dropBefore: boolean) {
    if (!sourceKey || sourceKey === targetKey) return;
    const keys = buildRailEntries().map((e) => e.key);
    const from = keys.indexOf(sourceKey);
    if (from < 0) return;
    keys.splice(from, 1);
    const insertAt = keys.indexOf(targetKey);
    if (insertAt < 0) return;
    keys.splice(dropBefore ? insertAt : insertAt + 1, 0, sourceKey);
    setRailOrder(keys);
    saveStringList(RAIL_ORDER_KEY, keys);
    // 主机顺序同步进 session（分组顺序只存在本组件）
    const hostNames = keys.filter((k) => session.openedHosts.some((h) => h.name === k));
    if (hostNames.length > 0) session.reorderOpenedHosts(hostNames);
  }

  /** 右键主机行：只弹主机操作菜单，不切换主机、不改多选。行在多选里就作用于整个多选。 */
  function openHostMenu(name: string, x: number, y: number) {
    let hosts = [name];
    if (selectedHostNames.length >= 2 && selectedHostNames.includes(name)) {
      hosts = session.openedHosts
        .map((h) => h.name)
        .filter((n) => selectedHostNames.includes(n));
    }
    setHostMenu({ host: name, hosts, x, y });
  }

  function clearHostSelection() {
    setSelectedHostNames([]);
    hostAnchorRef.current = "";
  }

  const listKind = session.settingsOpen
    ? "settings"
    : session.workspace === "config"
      ? "config"
      : session.workspace === "notify"
        ? "notify"
        : session.workspace === "local"
          ? "local"
          : session.workspace === "inspect"
            ? "inspect"
            : session.workspace === "speedtest"
              ? "speedtest"
              : "hosts";

  const railEntries = buildRailEntries();

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
        {listKind === "notify"
          ? NOTIFY_SECTIONS.map((item) => (
              <RailNavButton
                key={item.id}
                label={item.label}
                active={session.notifySection === item.id}
                onClick={() => session.setNotifySection(item.id)}
              />
            ))
          : null}

        {listKind === "config"
          ? CONFIG_SECTIONS.map((item) => (
              <RailNavButton
                key={item.id}
                label={item.label}
                active={session.configSection === item.id}
                onClick={() => session.setConfigSection(item.id)}
              />
            ))
          : null}

        {listKind === "settings"
          ? SETTINGS_SECTIONS.map((item) => (
              <RailNavButton
                key={item.id}
                label={item.label}
                active={session.settingsSection === item.id}
                onClick={() => session.setSettingsSection(item.id)}
              />
            ))
          : null}

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
            {railEntries.length > 0 ? <div className="h-2 shrink-0" /> : null}
            {railEntries.map((entry) => {
              if (entry.kind === "group") {
                const active =
                  !session.settingsOpen &&
                  session.homeView === "group" &&
                  !session.activeHost &&
                  session.activeGroupId === entry.id;
                return (
                  <RailSessionRow
                    key={entry.key}
                    label={session.groupName(entry.id) || entry.id}
                    prefix="组"
                    active={active}
                    selected={false}
                    hovered={hoverKey === entry.key}
                    onHover={() => setHoverKey(entry.key)}
                    dragging={railDragKey === entry.key}
                    dropEdge={
                      railDrop?.key === entry.key
                        ? railDrop.before
                          ? "before"
                          : "after"
                        : null
                    }
                    onPointerDown={(e) => {
                      if (e.button !== 0) return;
                      // 切到分组时清掉主机多选，避免 selected 与分组 active 叠出双高亮
                      setSelectedHostNames([]);
                      hostAnchorRef.current = "";
                      session.openGroup(entry.id);
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      const pos = clampContextMenuPos(e.clientX, e.clientY, 180, 96);
                      setGroupMenu({ id: entry.id, x: pos.x, y: pos.y });
                    }}
                    onDragStart={(e) => {
                      suppressHostClickRef.current = true;
                      setHoverKey("");
                      setRailDragKey(entry.key);
                      e.dataTransfer.effectAllowed = "move";
                      e.dataTransfer.setData(RAIL_ENTRY_MIME, entry.key);
                      e.dataTransfer.setData("text/plain", entry.key);
                    }}
                    onDragOver={(e) => {
                      if (!Array.from(e.dataTransfer.types).includes(RAIL_ENTRY_MIME)) return;
                      if (entry.key === railDragKey) return;
                      e.preventDefault();
                      e.dataTransfer.dropEffect = "move";
                      const rect = e.currentTarget.getBoundingClientRect();
                      const before = e.clientY < rect.top + rect.height / 2;
                      setRailDrop({ key: entry.key, before });
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      const source = e.dataTransfer.getData(RAIL_ENTRY_MIME) || railDragKey;
                      const before = railDrop?.key === entry.key ? railDrop.before : true;
                      setRailDrop(null);
                      moveRailEntry(source, entry.key, before);
                    }}
                    onDragEnd={() => {
                      setRailDragKey("");
                      setRailDrop(null);
                      setHoverKey("");
                      window.setTimeout(() => {
                        suppressHostClickRef.current = false;
                      }, 0);
                    }}
                  />
                );
              }

              // 仅在当前落在某台主机时展示多选高亮；分组页上 leftover selected 不得冒充 active
              const selected =
                !!session.activeHost && selectedHostNames.includes(entry.name);
              const active = session.activeHost === entry.name;
              return (
                <RailSessionRow
                  key={entry.key}
                  label={entry.name}
                  active={active}
                  selected={selected}
                  hovered={hoverKey === entry.key}
                  onHover={() => setHoverKey(entry.key)}
                  dragging={railDragKey === entry.key}
                  dropEdge={
                    railDrop?.key === entry.key
                      ? railDrop.before
                        ? "before"
                        : "after"
                      : null
                  }
                  onPointerDown={(e) => {
                    if (e.button !== 0 || suppressHostClickRef.current) return;
                    if (e.metaKey || e.ctrlKey) {
                      e.preventDefault();
                      setSelectedHostNames((prev) => {
                        const next = new Set(prev);
                        if (next.has(entry.name)) next.delete(entry.name);
                        else next.add(entry.name);
                        return [...next];
                      });
                      hostAnchorRef.current = entry.name;
                      return;
                    }
                    if (e.shiftKey && hostAnchorRef.current) {
                      e.preventDefault();
                      const ids = session.openedHosts.map((h) => h.name);
                      const from = ids.indexOf(hostAnchorRef.current);
                      const to = ids.indexOf(entry.name);
                      if (from < 0 || to < 0) return;
                      const lo = Math.min(from, to);
                      const hi = Math.max(from, to);
                      setSelectedHostNames(ids.slice(lo, hi + 1));
                      return;
                    }
                    setSelectedHostNames([entry.name]);
                    hostAnchorRef.current = entry.name;
                    session.openHost(entry.name);
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    openHostMenu(entry.name, e.clientX, e.clientY);
                  }}
                  onDragStart={(e) => {
                    suppressHostClickRef.current = true;
                    setHoverKey("");
                    setRailDragKey(entry.key);
                    e.dataTransfer.effectAllowed = "move";
                    e.dataTransfer.setData(RAIL_ENTRY_MIME, entry.key);
                    e.dataTransfer.setData("text/plain", entry.key);
                  }}
                  onDragOver={(e) => {
                    if (!Array.from(e.dataTransfer.types).includes(RAIL_ENTRY_MIME)) return;
                    if (entry.key === railDragKey) return;
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "move";
                    const rect = e.currentTarget.getBoundingClientRect();
                    const before = e.clientY < rect.top + rect.height / 2;
                    setRailDrop({ key: entry.key, before });
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    const source = e.dataTransfer.getData(RAIL_ENTRY_MIME) || railDragKey;
                    const before = railDrop?.key === entry.key ? railDrop.before : true;
                    setRailDrop(null);
                    moveRailEntry(source, entry.key, before);
                  }}
                  onDragEnd={() => {
                    setRailDragKey("");
                    setRailDrop(null);
                    setHoverKey("");
                    window.setTimeout(() => {
                      suppressHostClickRef.current = false;
                    }, 0);
                  }}
                />
              );
            })}
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
            .openHostsInTerminal(hosts, readSettings().terminalOpenMode)
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
  badge,
  statusDot,
  onClick,
  onContextMenu,
}: {
  label: string;
  active: boolean;
  badge?: string | null;
  statusDot?: boolean;
  onClick: () => void;
  onContextMenu?: (event: ReactMouseEvent<HTMLButtonElement>) => void;
}) {
  return (
    <button
      type="button"
      className={cn(
        "rail-item relative flex h-10 shrink-0 items-center px-3 text-left",
        active ? "rail-item-active" : "text-muted hover:bg-line hover:text-ink",
      )}
      onClick={onClick}
      onContextMenu={onContextMenu}
    >
      <span className="truncate">{label}</span>
      {badge ? (
        <Tag tone="accent" className="ml-auto font-mono tabular-nums">
          {badge}
        </Tag>
      ) : null}
      {statusDot ? (
        <span className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-danger" />
      ) : null}
    </button>
  );
}

function RailSessionRow({
  label,
  prefix,
  active,
  selected,
  hovered,
  onHover,
  dragging,
  dropEdge,
  onPointerDown,
  onContextMenu,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
}: {
  label: string;
  prefix?: string;
  active: boolean;
  selected: boolean;
  hovered: boolean;
  onHover: () => void;
  dragging: boolean;
  dropEdge: "before" | "after" | null;
  onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => void;
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
      className={cn(
        "rail-item relative flex h-10 shrink-0 cursor-grab select-none items-center gap-1.5 truncate px-3 text-left active:cursor-grabbing",
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