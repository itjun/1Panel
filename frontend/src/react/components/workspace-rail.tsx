/**
 * WorkspaceRail — React 版左侧工作区栏。
 */

import { Events } from "@wailsio/runtime";
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
import { WindowChrome } from "@/react/components/window-chrome";
import { LOCAL_SECTIONS } from "@/react/pages/local";
import { cn } from "@/react/lib/utils";
import {
  HOST_TOOLS,
  useSession,
  type ConfigSection,
  type NotifySection,
  type Tool,
  type Workspace,
} from "@/react/state/session";
import { clampContextMenuPos } from "@/utils/contextMenuPos";

const UTILITY_OPEN_KEY = "1pannel-utility-nav-open";
const RAIL_ORDER_KEY = "1pannel-rail-order";
const VISITED_GROUPS_KEY = "1pannel-visited-groups";
const RAIL_ENTRY_MIME = "application/x-rail-entry";

const HOST_MODULE: { id: Workspace; label: string } = { id: "remote", label: "主机" };

const NOTIFY_SECTIONS: { id: NotifySection; label: string }[] = [
  { id: "metricMessages", label: "指标消息" },
  { id: "appMessages", label: "应用消息" },
  { id: "metricSubs", label: "指标订阅" },
  { id: "appSubs", label: "应用订阅" },
  { id: "setup", label: "通知设置" },
];

const CONFIG_SECTIONS: { id: ConfigSection; label: string }[] = [
  { id: "overview", label: "概览" },
  { id: "json", label: "Panel JSON" },
  { id: "files", label: "SSH 文件" },
  { id: "diff", label: "差异与冲突" },
  { id: "backups", label: "备份" },
];

/** 设置页尚无 section 状态；按钮仅打开设置。 */
const SETTINGS_SECTIONS = [
  { id: "look", label: "外观" },
  { id: "session", label: "会话" },
  { id: "app", label: "应用" },
] as const;

const BATCH_OPEN_TOOLS: { id: Tool; label: string }[] = [
  { id: "overview", label: "概览" },
  { id: "files", label: "文件" },
  { id: "monitor", label: "监控" },
];

type RailEntry =
  | { kind: "host"; key: string; name: string }
  | { kind: "group"; key: string };

type HostBatchMenu = { ids: string[]; x: number; y: number };
type GroupMenu = { id: string; x: number; y: number };

function loadUtilityOpen(): boolean {
  try {
    return localStorage.getItem(UTILITY_OPEN_KEY) === "1";
  } catch {
    return false;
  }
}

function saveUtilityOpen(open: boolean) {
  try {
    localStorage.setItem(UTILITY_OPEN_KEY, open ? "1" : "0");
  } catch {
    /* ignore */
  }
}

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

function formatCount(n: number): string {
  return n > 99 ? "99+" : String(n);
}

export function WorkspaceRail() {
  const session = useSession();
  const [utilityOpen, setUtilityOpen] = useState(loadUtilityOpen);
  const [unread, setUnread] = useState(0);
  const [configNeedsAttention, setConfigNeedsAttention] = useState(false);
  const [visitedGroupIds, setVisitedGroupIds] = useState(() =>
    loadStringList(VISITED_GROUPS_KEY),
  );
  const [railOrder, setRailOrder] = useState(() => loadStringList(RAIL_ORDER_KEY));
  const [selectedHostNames, setSelectedHostNames] = useState<string[]>([]);
  const hostAnchorRef = useRef("");
  const suppressHostClickRef = useRef(false);

  const [hostMenu, setHostMenu] = useState<HostContextMenuState | null>(null);
  const [hostBatchMenu, setHostBatchMenu] = useState<HostBatchMenu | null>(null);
  const [groupMenu, setGroupMenu] = useState<GroupMenu | null>(null);

  const [railDragKey, setRailDragKey] = useState("");
  const [railDrop, setRailDrop] = useState<{ key: string; before: boolean } | null>(null);

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

  // 通知未读数
  useEffect(() => {
    let cancelled = false;
    async function tick() {
      try {
        const n = await api.unreadAlertCount();
        if (!cancelled) setUnread(Number(n) || 0);
      } catch {
        /* 轮询失败时保持上次数字 */
      }
    }
    void tick();
    const timer = window.setInterval(() => void tick(), 15000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  // 配置红点
  useEffect(() => {
    let cancelled = false;
    async function refresh() {
      try {
        const overview = await api.getPanelConfigOverview();
        if (cancelled) return;
        setConfigNeedsAttention(
          !!(overview.configStale || overview.drift || overview.needsReview),
        );
      } catch {
        /* 打开配置工作区时再报错 */
      }
    }
    void refresh();
    const offs = [
      Events.On("panel-config-imported", () => void refresh()),
      Events.On("panel-config-needs-review", () => setConfigNeedsAttention(true)),
      Events.On("panel-config-import-error", () => setConfigNeedsAttention(true)),
    ];
    return () => {
      cancelled = true;
      offs.forEach((off) => off());
    };
  }, []);

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
    for (const key of railOrder) {
      if (hostNames.has(key)) {
        out.push({ kind: "host", key, name: key });
        seen.add(key);
        continue;
      }
      if (groups.has(key)) {
        out.push({ kind: "group", key });
        seen.add(key);
      }
    }
    for (const h of hosts) {
      if (!seen.has(h.name)) out.push({ kind: "host", key: h.name, name: h.name });
    }
    for (const gid of visitedGroupIds) {
      if (!seen.has(gid)) out.push({ kind: "group", key: gid });
    }
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

  const isMac = /Mac|iPhone|iPad/.test(navigator.platform);

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
            : "hosts";

  const railEntries = buildRailEntries();

  return (
      <aside
        className={cn(
          "glass-chrome flex w-[220px] min-w-[220px] flex-col pb-2.5",
          isMac && "pt-0",
        )}
        aria-label="应用导航"
      >
      <div
        className={cn(
            "rail-traffic drag-region flex h-10 shrink-0 items-center",
          isMac ? "pl-[72px]" : "pl-0.5",
        )}
      >
        <WindowChrome />
        <div className="h-full min-w-0 flex-1" />
      </div>

      <div
        className="flex min-h-0 flex-1 flex-col gap-1 overflow-auto px-1.5"
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
                active={session.settingsOpen}
                onClick={() => session.openSettings(true)}
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

        {listKind === "inspect" ? (
          <RailNavButton
            label="菜单检查"
            active
            onClick={() => session.setInspectSection("menuCheck")}
          />
        ) : null}

        {listKind === "hosts" ? (
          <>
            {railEntries.map((entry) => {
              if (entry.kind === "group") {
                const active =
                  !session.settingsOpen &&
                  session.homeView === "group" &&
                  !session.activeHost &&
                  session.activeGroupId === entry.key;
                return (
                  <RailSessionRow
                    key={entry.key}
                    label={session.groupName(entry.key) || entry.key}
                    prefix="组"
                    active={active}
                    selected={false}
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
                      session.openGroup(entry.key);
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      const pos = clampContextMenuPos(e.clientX, e.clientY, 180, 96);
                      setGroupMenu({ id: entry.key, x: pos.x, y: pos.y });
                    }}
                    onDragStart={(e) => {
                      suppressHostClickRef.current = true;
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
                      window.setTimeout(() => {
                        suppressHostClickRef.current = false;
                      }, 0);
                    }}
                  />
                );
              }

              const selected = selectedHostNames.includes(entry.name);
              const active = session.activeHost === entry.name;
              return (
                <RailSessionRow
                  key={entry.key}
                  label={entry.name}
                  active={active}
                  selected={selected}
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
                    let ids = selectedHostNames;
                    if (!ids.includes(entry.name)) {
                      ids = [entry.name];
                      setSelectedHostNames(ids);
                    }
                    session.openHost(entry.name);
                    if (ids.length < 2) {
                      setHostMenu({
                        host: entry.name,
                        hosts: [entry.name],
                        x: e.clientX,
                        y: e.clientY,
                      });
                      return;
                    }
                    const pos = clampContextMenuPos(e.clientX, e.clientY, 210, 340);
                    setHostBatchMenu({ ids, x: pos.x, y: pos.y });
                  }}
                  onDragStart={(e) => {
                    suppressHostClickRef.current = true;
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
                    window.setTimeout(() => {
                      suppressHostClickRef.current = false;
                    }, 0);
                  }}
                />
              );
            })}
          </>
        ) : null}

        {listKind === "hosts" && session.activeHost ? (
          <div className="mt-1 flex shrink-0 flex-col gap-1 border-t border-line pt-2">
            {HOST_TOOLS.map((item) => (
              <RailNavButton
                key={item.id}
                label={item.label}
                active={session.activeTool === item.id}
                onClick={() => session.setTool(item.id)}
              />
            ))}
          </div>
        ) : null}
      </div>

      <UtilityNav
        open={utilityOpen}
        unread={unread}
        configNeedsAttention={configNeedsAttention}
        activeLabel={utilityActiveLabel(session.settingsOpen, session.workspace)}
        onToggle={() => {
          setUtilityOpen((open) => {
            const next = !open;
            saveUtilityOpen(next);
            return next;
          });
        }}
        onHost={() => {
          if (session.workspace === "remote" && !session.settingsOpen) {
            session.goHome();
            return;
          }
          session.setWorkspace("remote");
        }}
        hostActive={!session.settingsOpen && session.workspace === "remote"}
        onLocal={() => session.setWorkspace("local")}
        onInspect={() => session.setWorkspace("inspect")}
        onNotify={() => session.setWorkspace("notify")}
        onConfig={() => session.setWorkspace("config")}
        onSettings={() => session.openSettings(true)}
        localActive={!session.settingsOpen && session.workspace === "local"}
        inspectActive={!session.settingsOpen && session.workspace === "inspect"}
        notifyActive={!session.settingsOpen && session.workspace === "notify"}
        configActive={!session.settingsOpen && session.workspace === "config"}
        settingsActive={session.settingsOpen}
      />

      <HostContextMenu
        menu={hostMenu}
        pinned={session.pinned}
        showDelete={false}
        onClose={() => setHostMenu(null)}
        onOpen={(hosts) => {
          for (const name of hosts) session.openHost(name, "overview");
        }}
        onOpenInTerminal={(hosts) => {
          setSelectedHostNames([]);
          hostAnchorRef.current = "";
          void api.openHostsInTerminal(hosts).catch((err) => {
            window.alert(`终端打开失败: ${err instanceof Error ? err.message : String(err)}`);
          });
        }}
        onTogglePin={(host) => session.togglePin(host)}
        onEdit={(name) => session.setEditingHost(name)}
        onDisconnect={(name) => session.closeHost(name)}
      />

      {hostBatchMenu ? (
        <CtxMenu
          x={hostBatchMenu.x}
          y={hostBatchMenu.y}
          onClose={() => setHostBatchMenu(null)}
        >
          <div className="px-3 py-1.5 text-xs text-muted">
            已选 {hostBatchMenu.ids.length} 台主机
          </div>
          {BATCH_OPEN_TOOLS.map((tab) => (
            <CtxItem
              key={tab.id}
              label={`打开${tab.label}`}
              onClick={() => {
                const names = hostBatchMenu.ids;
                setHostBatchMenu(null);
                for (const name of names) session.openHost(name, tab.id);
                setSelectedHostNames([]);
                hostAnchorRef.current = "";
              }}
            />
          ))}
          <CtxItem
            label="终端打开"
            onClick={() => {
              const names = hostBatchMenu.ids.slice();
              setHostBatchMenu(null);
              setSelectedHostNames([]);
              hostAnchorRef.current = "";
              void api.openHostsInTerminal(names).catch((err) => {
                window.alert(`终端打开失败: ${err instanceof Error ? err.message : String(err)}`);
              });
            }}
          />
          <CtxDivider />
          <CtxItem
            label="断开连接"
            danger
            onClick={() => {
              const names = hostBatchMenu.ids;
              setHostBatchMenu(null);
              for (const name of names) session.closeHost(name);
              setSelectedHostNames([]);
              hostAnchorRef.current = "";
            }}
          />
        </CtxMenu>
      ) : null}

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

function utilityActiveLabel(settingsOpen: boolean, workspace: Workspace): string {
  if (settingsOpen) return "设置";
  if (workspace === "remote") return HOST_MODULE.label;
  if (workspace === "local") return "本机";
  if (workspace === "inspect") return "巡检";
  if (workspace === "notify") return "通知";
  if (workspace === "config") return "配置";
  return "";
}

function UtilityNav({
  open,
  unread,
  configNeedsAttention,
  activeLabel,
  onToggle,
  onHost,
  hostActive,
  onLocal,
  onInspect,
  onNotify,
  onConfig,
  onSettings,
  localActive,
  inspectActive,
  notifyActive,
  configActive,
  settingsActive,
}: {
  open: boolean;
  unread: number;
  configNeedsAttention: boolean;
  activeLabel: string;
  onToggle: () => void;
  onHost: () => void;
  hostActive: boolean;
  onLocal: () => void;
  onInspect: () => void;
  onNotify: () => void;
  onConfig: () => void;
  onSettings: () => void;
  localActive: boolean;
  inspectActive: boolean;
  notifyActive: boolean;
  configActive: boolean;
  settingsActive: boolean;
}) {
  const badge = unread > 0 ? formatCount(unread) : null;
  return (
    <div className="mt-1 flex flex-col gap-1 px-1.5">
      <button
        type="button"
        className={cn(
          "relative flex h-10 shrink-0 items-center rounded-control text-left",
          !open && activeLabel
            ? "bg-accent-soft px-2.5 font-semibold text-accent"
            : "px-2.5 text-muted hover:bg-raised hover:text-ink",
        )}
        title={open ? "收起" : "展开"}
        onClick={onToggle}
      >
        <span className="mr-1.5 w-3 shrink-0 text-center text-[10px]">{open ? "▾" : "▸"}</span>
        <span className="truncate">{open ? "收起" : activeLabel || "更多"}</span>
        {!open && badge ? (
          <span className="ml-auto inline-flex min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-bold leading-4 text-white">
            {badge}
          </span>
        ) : null}
        {!open && !badge && configNeedsAttention ? (
          <span className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-danger" />
        ) : null}
      </button>
      {open ? (
        <>
          <RailNavButton active={hostActive} label={HOST_MODULE.label} onClick={onHost} />
          <RailNavButton active={localActive} label="本机" onClick={onLocal} />
          <RailNavButton active={inspectActive} label="巡检" onClick={onInspect} />
          <RailNavButton active={notifyActive} label="通知" badge={badge} onClick={onNotify} />
          <RailNavButton
            active={configActive}
            label="配置"
            statusDot={configNeedsAttention}
            onClick={onConfig}
          />
          <RailNavButton active={settingsActive} label="设置" onClick={onSettings} />
        </>
      ) : null}
    </div>
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
        "relative flex h-10 shrink-0 items-center rounded-control text-left",
        active
          ? "bg-accent-soft px-2.5 font-semibold text-accent"
          : "px-2.5 text-muted hover:bg-raised hover:text-ink",
      )}
      onClick={onClick}
      onContextMenu={onContextMenu}
    >
      <span className="truncate">{label}</span>
      {badge ? (
        <span className="ml-auto inline-flex min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-bold leading-4 text-white">
          {badge}
        </span>
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
  dragging: boolean;
  dropEdge: "before" | "after" | null;
  onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onContextMenu: (event: ReactMouseEvent<HTMLButtonElement>) => void;
  onDragStart: (event: DragEvent<HTMLButtonElement>) => void;
  onDragOver: (event: DragEvent<HTMLButtonElement>) => void;
  onDrop: (event: DragEvent<HTMLButtonElement>) => void;
  onDragEnd: () => void;
}) {
  return (
    <button
      type="button"
      draggable
      className={cn(
        "relative flex h-10 shrink-0 cursor-grab items-center gap-1.5 truncate rounded-control text-left active:cursor-grabbing",
        active || selected
          ? "bg-accent-soft px-2.5 font-semibold text-accent"
          : "px-2.5 text-muted hover:bg-raised hover:text-ink",
        dragging && "opacity-40",
      )}
      onPointerDown={onPointerDown}
      onContextMenu={onContextMenu}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
    >
      {dropEdge === "before" ? (
        <span className="pointer-events-none absolute inset-x-1 top-0 h-[3px] rounded-sm bg-accent" />
      ) : null}
      {prefix ? <span className="shrink-0 text-[12px] opacity-70">{prefix}</span> : null}
      <span className="truncate">{label}</span>
      {dropEdge === "after" ? (
        <span className="pointer-events-none absolute inset-x-1 bottom-0 h-[3px] rounded-sm bg-accent" />
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
        className="motion-menu-panel fixed z-[61] min-w-[180px] rounded-surface border border-line bg-surface py-1 text-sm text-ink shadow-sm"
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

function CtxDivider() {
  return <div className="my-1 border-t border-line" />;
}
