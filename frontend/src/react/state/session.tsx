import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { api, type groups, type sshconfig } from "@/api";
import {
  readMainScreen,
  writeMainScreen,
  type NormalizedScreen,
} from "@/utils/lastScreen";
import { pushView, viewSnap, type ViewSnap } from "@/react/state/nav-history";
import { readSettings } from "@/react/state/settings";
import type { PersistTool } from "@/utils/workspaceMigrate";

export const UNGROUPED_ID = "__ungrouped__";
const NAV_KEY = "1pannel-react-nav";

export type Workspace =
  | "remote"
  | "local"
  | "inspect"
  | "notify"
  | "config"
  | "speedtest";

export type Tool =
  | "overview"
  | "files"
  | "monitor"
  | "disk"
  | "apps"
  | "certs"
  | "nginx"
  | "processes"
  | "network"
  | "hosts"
  | "apt"
  | "services"
  | "cron"
  | "logs"
  | "packages";

export type LocalSection =
  | "hosts"
  | "nginx"
  | "storage"
  | "network"
  | "packages"
  | "apt"
  | "procs"
  | "monitor"
  | "overview";

export type NotifySection =
  | "metricMessages"
  | "appMessages"
  | "metricSubs"
  | "appSubs"
  | "setup";

export type ConfigSection = "overview" | "json" | "files" | "diff" | "backups";
export type InspectSection = "menuCheck";
export type SpeedtestSection = "pair" | "group" | "history";
/** 从主机右键 / 分组页跳进测速时的预填 */
export type SpeedtestPrefill = { a?: string; b?: string; groupId?: string; nonce: number };
export type SettingsSection = "look" | "session" | "board" | "app" | "shortcuts" | "about";
export type HomeView = "home" | "group";

export type OpenedHost = {
  name: string;
  tool: Tool;
};

export const HOST_TOOLS: { id: Tool; label: string }[] = [
  { id: "overview", label: "概览" },
  { id: "monitor", label: "监控" },
  { id: "disk", label: "磁盘" },
  { id: "files", label: "文件" },
  { id: "apps", label: "应用" },
  { id: "nginx", label: "Nginx" },
  { id: "hosts", label: "Hosts" },
  { id: "certs", label: "证书" },
  { id: "network", label: "网络" },
  { id: "processes", label: "进程" },
  { id: "services", label: "服务" },
  { id: "logs", label: "日志" },
  { id: "packages", label: "软件包" },
  { id: "apt", label: "软件源" },
  { id: "cron", label: "定时任务" },
];

const TOOL_IDS = new Set<string>(HOST_TOOLS.map((item) => item.id));

function persistToolToReact(tool: PersistTool): Tool | null {
  if (tool === "terminal") return null;
  if (tool === "info") return "overview";
  if (tool === "sftp" || tool === "file-manager") return "files";
  if (TOOL_IDS.has(tool)) return tool as Tool;
  return null;
}

function reactToolToPersist(tool: Tool): PersistTool {
  if (tool === "overview") return "info";
  if (tool === "files") return "sftp";
  return tool;
}

type Nav = {
  workspace: Workspace;
  settingsOpen: boolean;
  localSection: LocalSection;
  notifySection: NotifySection;
  configSection: ConfigSection;
  inspectSection: InspectSection;
  speedtestSection: SpeedtestSection;
  settingsSection: SettingsSection;
  homeView: HomeView;
  activeGroupId: string;
  activeHost: string;
  activeTool: Tool;
  pinned: string[];
  openedHosts: OpenedHost[];
};

const defaultNav = (): Nav => ({
  workspace: "remote",
  settingsOpen: false,
  localSection: "overview",
  notifySection: "metricMessages",
  configSection: "overview",
  inspectSection: "menuCheck",
  speedtestSection: "pair",
  settingsSection: "look",
  homeView: "home",
  activeGroupId: "",
  activeHost: "",
  activeTool: "overview",
  pinned: [],
  openedHosts: [],
});

function loadNav(): Nav {
  const nav = defaultNav();
  try {
    const raw = localStorage.getItem(NAV_KEY);
    if (!raw) {
      const pinned = localStorage.getItem("1pannel-pinned-hosts");
      if (pinned) nav.pinned = JSON.parse(pinned) as string[];
      return nav;
    }
    const parsed = JSON.parse(raw) as Partial<Omit<Nav, "workspace">> & {
      workspace?: string;
      openedHosts?: OpenedHost[];
    };
    const openedHosts: OpenedHost[] = [];
    if (Array.isArray(parsed.openedHosts)) {
      const seen = new Set<string>();
      for (const item of parsed.openedHosts) {
        if (!item || typeof item !== "object") continue;
        const name = typeof item.name === "string" ? item.name.trim() : "";
        if (!name || seen.has(name)) continue;
        const storedTool = item.tool as string;
        const rawTool = storedTool === "file-manager" ? "files" : storedTool;
        const tool =
          typeof rawTool === "string" && TOOL_IDS.has(rawTool)
            ? (rawTool as Tool)
            : "overview";
        seen.add(name);
        openedHosts.push({ name, tool });
      }
    }
    // 旧持久化里的 terminal 工作区回落到主机页
    let workspace = parsed.workspace;
    if (
      workspace === "terminal" ||
      (workspace &&
        !["remote", "local", "inspect", "notify", "config", "speedtest"].includes(workspace))
    ) {
      workspace = "remote";
    }
    const merged = {
      ...nav,
      ...parsed,
      workspace: (workspace as Workspace) || "remote",
      openedHosts,
    };
    // 旧「关于本机」分区已删除，回落到系统概览
    if ((merged.localSection as string) === "sysinfo") {
      merged.localSection = "overview";
    }
    // 旧单栏文件管理器已删除，落到双栏文件页
    if ((merged.activeTool as string) === "file-manager") {
      merged.activeTool = "files";
    }
    if (!TOOL_IDS.has(merged.activeTool)) {
      merged.activeTool = "overview";
    }
    if (!["pair", "group", "history"].includes(merged.speedtestSection as string)) {
      merged.speedtestSection = "pair";
    }
    if (merged.homeView !== "home" && merged.homeView !== "group") {
      merged.homeView = "home";
    }
    const settingsSections = new Set(["look", "session", "board", "app", "shortcuts", "about"]);
    if (!settingsSections.has(merged.settingsSection as string)) {
      merged.settingsSection = "look";
    }
    return merged;
  } catch {
    return nav;
  }
}

function openedHostsFromScreen(screen: NormalizedScreen | null): OpenedHost[] {
  if (!screen) return [];
  const result: OpenedHost[] = [];
  const seen = new Set<string>();
  for (const item of screen.hostSessions) {
    if (item.role !== "host") continue;
    const name = (item.host || item.id || "").trim();
    if (!name || seen.has(name)) continue;
    const tool = persistToolToReact(item.tool);
    if (!tool) continue;
    seen.add(name);
    result.push({ name, tool });
  }
  return result;
}

function restoreNav(): Nav {
  const nav = loadNav();
  const screen = readMainScreen();
  const openedHosts = openedHostsFromScreen(screen);
  nav.openedHosts = openedHosts;

  if (readSettings().startupPage === "home") {
    nav.homeView = "home";
    nav.activeHost = "";
    nav.workspace = "remote";
    nav.settingsOpen = false;
    return nav;
  }

  // 本机 / 通知 / 巡检 / 配置 / 设置沿用 loadNav 里记下的工作区与分区
  const activeId = screen?.activeHostSessionId?.trim() || "";
  const active = openedHosts.find((item) => item.name === activeId);
  if (active) {
    nav.activeHost = active.name;
    nav.activeTool = active.tool;
    return nav;
  }

  nav.activeHost = "";
  nav.homeView = "home";
  return nav;
}

function writeMainFromNav(nav: Nav) {
  const prev = readMainScreen();
  const hostSessions = nav.openedHosts.map((item) => {
    const tool =
      item.name === nav.activeHost ? nav.activeTool : item.tool;
    return {
      id: item.name,
      host: item.name,
      role: "host" as const,
      tool: reactToolToPersist(tool),
      title: item.name,
      titleCustom: false,
      terminals: [],
      activeTerminalId: "",
    };
  });
  writeMainScreen({
    workspace: "remote",
    settingsOpen: false,
    activeHostSessionId: nav.activeHost || "",
    activeGroupId: "",
    activeTerminalId: prev?.activeTerminalId || "",
    hostSessions,
    desks: prev?.desks || [],
  });
}

type SessionValue = Nav & {
  hosts: sshconfig.HostConfig[];
  groups: groups.Group[];
  osRelease: Record<string, string>;
  loading: boolean;
  refresh: () => Promise<void>;
  setWorkspace: (workspace: Workspace) => void;
  openSettings: (open?: boolean) => void;
  setLocalSection: (section: LocalSection) => void;
  setNotifySection: (section: NotifySection) => void;
  setConfigSection: (section: ConfigSection) => void;
  setInspectSection: (section: InspectSection) => void;
  setSpeedtestSection: (section: SpeedtestSection) => void;
  speedtestPrefill: SpeedtestPrefill | null;
  /** 跳到测速工作区并预填端点或分组 */
  openSpeedtest: (section: SpeedtestSection, prefill?: Omit<SpeedtestPrefill, "nonce">) => void;
  setSettingsSection: (section: SettingsSection) => void;
  goHome: () => void;
  openGroup: (id: string) => void;
  openHost: (name: string, tool?: Tool) => void;
  closeHost: (name: string) => void;
  /** 按给定顺序重排侧栏已打开的主机。 */
  reorderOpenedHosts: (orderedNames: string[]) => void;
  setTool: (tool: Tool) => void;
  togglePin: (name: string) => void;
  /** 按给定顺序重排置顶列表（只保留仍在置顶集合内的名字）。 */
  reorderPinned: (orderedNames: string[]) => void;
  groupName: (id: string) => string;
  hostsOf: (groupId: string) => sshconfig.HostConfig[];
  /** 主机当前所在分组 id；未分组返回空字符串。 */
  groupIdOf: (hostName: string) => string;
  editingHost: string;
  setEditingHost: (name: string) => void;
  /** 主机改名后，把导航里按主机名记录的引用（当前主机、已打开、置顶）换成新名。 */
  renameHostRefs: (oldName: string, newName: string) => void;
};

const SessionContext = createContext<SessionValue | null>(null);

type NavHistoryValue = {
  canBack: boolean;
  canForward: boolean;
  goBack: () => void;
  goForward: () => void;
};

const NavHistoryContext = createContext<NavHistoryValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [nav, setNav] = useState<Nav>(restoreNav);
  const [hosts, setHosts] = useState<sshconfig.HostConfig[]>([]);
  const [groups, setGroups] = useState<groups.Group[]>([]);
  const [osRelease, setOsRelease] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [editingHost, setEditingHostState] = useState("");
  const [speedtestPrefill, setSpeedtestPrefill] = useState<SpeedtestPrefill | null>(null);
  const historyRef = useRef({ stack: [viewSnap(nav)], index: 0 });
  const [, setHistoryRev] = useState(0);

  const patch = useCallback((partial: Partial<Nav>) => {
    setNav((prev) => ({ ...prev, ...partial }));
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [nextHosts, nextGroups, icons] = await Promise.all([
        api.listHosts(),
        api.listGroups(),
        api.listHostIcons().catch(() => []),
      ]);
      setHosts(nextHosts);
      setGroups(nextGroups);
      const map: Record<string, string> = {};
      for (const icon of icons) {
        if (icon.host && icon.osRelease) map[icon.host] = icon.osRelease;
      }
      setOsRelease(map);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    localStorage.setItem(NAV_KEY, JSON.stringify(nav));
    localStorage.setItem("1pannel-pinned-hosts", JSON.stringify(nav.pinned));
  }, [nav]);

  // 后退/前进落地后，当前下标已经指向目标页，viewKey 相同，不会再次入栈。
  useEffect(() => {
    const pushed = pushView(historyRef.current.stack, historyRef.current.index, viewSnap(nav));
    if (!pushed) return;
    historyRef.current = pushed;
    setHistoryRev((n) => n + 1);
  }, [nav]);

  const groupName = useCallback(
    (id: string) => {
      if (id === UNGROUPED_ID) return "未分组";
      return groups.find((group) => group.id === id)?.name || id;
    },
    [groups],
  );

  const hostsOf = useCallback(
    (groupId: string) => {
      if (groupId === UNGROUPED_ID) {
        const assigned = new Set(groups.flatMap((group) => group.hosts || []));
        return hosts.filter((host) => !assigned.has(host.name));
      }
      const names = groups.find((group) => group.id === groupId)?.hosts || [];
      const byName = new Map(hosts.map((host) => [host.name, host]));
      // 按分组内 hosts 顺序返回，便于拖拽重排后立刻反映
      return names
        .map((name) => byName.get(name))
        .filter((host): host is sshconfig.HostConfig => !!host);
    },
    [groups, hosts],
  );

  const groupIdOf = useCallback(
    (hostName: string) => {
      const found = groups.find((group) => (group.hosts || []).includes(hostName));
      return found?.id || "";
    },
    [groups],
  );

  const value = useMemo<SessionValue>(
    () => ({
      ...nav,
      hosts,
      groups,
      osRelease,
      loading,
      refresh,
      setWorkspace: (workspace) => patch({ workspace, settingsOpen: false }),
      openSettings: (open = true) =>
        patch(open ? { settingsOpen: true } : { settingsOpen: false }),
      setLocalSection: (localSection) =>
        patch({ localSection, workspace: "local", settingsOpen: false }),
      setNotifySection: (notifySection) =>
        patch({ notifySection, workspace: "notify", settingsOpen: false }),
      setConfigSection: (configSection) =>
        patch({ configSection, workspace: "config", settingsOpen: false }),
      setInspectSection: (inspectSection) =>
        patch({ inspectSection, workspace: "inspect", settingsOpen: false }),
      setSpeedtestSection: (speedtestSection) =>
        patch({ speedtestSection, workspace: "speedtest", settingsOpen: false }),
      speedtestPrefill,
      openSpeedtest: (speedtestSection, prefill) => {
        if (prefill) setSpeedtestPrefill({ ...prefill, nonce: Date.now() });
        patch({ speedtestSection, workspace: "speedtest", settingsOpen: false });
      },
      setSettingsSection: (settingsSection) =>
        patch({ settingsSection, settingsOpen: true }),
      goHome: () => {
        setNav((prev) => {
          const next = {
            ...prev,
            workspace: "remote" as const,
            settingsOpen: false,
            homeView: "home" as const,
            activeHost: "",
          };
          writeMainFromNav(next);
          return next;
        });
      },
      openGroup: (activeGroupId) => {
        setNav((prev) => {
          const next = {
            ...prev,
            workspace: "remote" as const,
            settingsOpen: false,
            homeView: "group" as const,
            activeGroupId,
            activeHost: "",
          };
          writeMainFromNav(next);
          return next;
        });
      },
      openHost: (name, tool) => {
        const hostName = name.trim();
        if (!hostName) return;
        setNav((prev) => {
          const existing = prev.openedHosts.find((item) => item.name === hostName);
          // 功能维度全局：切主机沿用当前功能，不回跳到该主机上次的功能（DESIGN.md §4.6）
          const nextTool = tool || prev.activeTool || "overview";
          let openedHosts: OpenedHost[];
          if (existing) {
            openedHosts = prev.openedHosts.map((item) =>
              item.name === hostName ? { name: hostName, tool: nextTool } : item,
            );
          } else {
            openedHosts = [...prev.openedHosts, { name: hostName, tool: nextTool }];
          }
          const next = {
            ...prev,
            workspace: "remote" as const,
            settingsOpen: false,
            activeHost: hostName,
            activeTool: nextTool,
            openedHosts,
          };
          writeMainFromNav(next);
          return next;
        });
      },
      reorderOpenedHosts: (orderedNames) => {
        setNav((prev) => {
          const byName = new Map(prev.openedHosts.map((item) => [item.name, item]));
          const openedHosts: OpenedHost[] = [];
          for (const name of orderedNames) {
            const item = byName.get(name);
            if (item) openedHosts.push(item);
          }
          for (const item of prev.openedHosts) {
            if (!openedHosts.some((row) => row.name === item.name)) openedHosts.push(item);
          }
          const next = { ...prev, openedHosts };
          writeMainFromNav(next);
          return next;
        });
      },
      closeHost: (name) => {
        const hostName = name.trim();
        if (!hostName) return;
        setEditingHostState((current) => (current === hostName ? "" : current));
        setNav((prev) => {
          const openedHosts = prev.openedHosts.filter((item) => item.name !== hostName);
          const closingActive = prev.activeHost === hostName;
          const next = {
            ...prev,
            openedHosts,
            ...(closingActive
              ? {
                  activeHost: "",
                  homeView: "home" as const,
                  workspace: "remote" as const,
                  settingsOpen: false,
                }
              : {}),
          };
          writeMainFromNav(next);
          return next;
        });
      },
      setTool: (activeTool) => {
        setNav((prev) => {
          const openedHosts = prev.activeHost
            ? prev.openedHosts.map((item) =>
                item.name === prev.activeHost ? { ...item, tool: activeTool } : item,
              )
            : prev.openedHosts;
          const next = { ...prev, activeTool, openedHosts };
          writeMainFromNav(next);
          return next;
        });
      },
      togglePin: (name) =>
        patch({
          pinned: nav.pinned.includes(name)
            ? nav.pinned.filter((item) => item !== name)
            : [...nav.pinned, name],
        }),
      reorderPinned: (orderedNames) => {
        const allowed = new Set(nav.pinned);
        const next = orderedNames.filter((name) => allowed.has(name));
        for (const name of nav.pinned) {
          if (!next.includes(name)) next.push(name);
        }
        patch({ pinned: next });
      },
      groupName,
      hostsOf,
      groupIdOf,
      editingHost,
      setEditingHost: (name) => setEditingHostState(name.trim()),
      renameHostRefs: (oldName, newName) => {
        if (!oldName || !newName || oldName === newName) return;
        setEditingHostState((current) => (current === oldName ? newName : current));
        setNav((prev) => {
          let activeHost = prev.activeHost;
          if (activeHost === oldName) {
            activeHost = newName;
          }
          const openedHosts = prev.openedHosts.map((item) =>
            item.name === oldName ? { ...item, name: newName } : item,
          );
          const pinned = prev.pinned.map((name) => (name === oldName ? newName : name));
          const next = { ...prev, activeHost, openedHosts, pinned };
          writeMainFromNav(next);
          return next;
        });
      },
    }),
    [
      groupIdOf,
      groupName,
      groups,
      hosts,
      hostsOf,
      loading,
      nav,
      osRelease,
      patch,
      refresh,
      editingHost,
      speedtestPrefill,
    ],
  );

  const applyView = useCallback((snap: ViewSnap) => {
    setNav((prev) => {
      let openedHosts = prev.openedHosts;
      if (snap.workspace === "remote" && !snap.settingsOpen && snap.activeHost) {
        const name = snap.activeHost;
        const existing = openedHosts.find((item) => item.name === name);
        if (existing) {
          openedHosts = openedHosts.map((item) =>
            item.name === name ? { name, tool: snap.activeTool } : item,
          );
        } else {
          openedHosts = [...openedHosts, { name, tool: snap.activeTool }];
        }
      }
      const next = {
        ...prev,
        workspace: snap.workspace,
        settingsOpen: snap.settingsOpen,
        localSection: snap.localSection,
        notifySection: snap.notifySection,
        configSection: snap.configSection,
        inspectSection: snap.inspectSection,
        speedtestSection: snap.speedtestSection,
        settingsSection: snap.settingsSection,
        homeView: snap.homeView,
        activeGroupId: snap.activeGroupId,
        activeHost: snap.activeHost,
        activeTool: snap.activeTool,
        openedHosts,
      };
      writeMainFromNav(next);
      return next;
    });
  }, []);

  const goBack = useCallback(() => {
    const hist = historyRef.current;
    if (hist.index <= 0) return;
    const nextIndex = hist.index - 1;
    historyRef.current = { stack: hist.stack, index: nextIndex };
    applyView(hist.stack[nextIndex]);
    setHistoryRev((n) => n + 1);
  }, [applyView]);

  const goForward = useCallback(() => {
    const hist = historyRef.current;
    if (hist.index >= hist.stack.length - 1) return;
    const nextIndex = hist.index + 1;
    historyRef.current = { stack: hist.stack, index: nextIndex };
    applyView(hist.stack[nextIndex]);
    setHistoryRev((n) => n + 1);
  }, [applyView]);

  const canBack = historyRef.current.index > 0;
  const canForward = historyRef.current.index < historyRef.current.stack.length - 1;
  const historyValue = useMemo<NavHistoryValue>(
    () => ({ canBack, canForward, goBack, goForward }),
    [canBack, canForward, goBack, goForward],
  );

  return (
    <SessionContext.Provider value={value}>
      <NavHistoryContext.Provider value={historyValue}>{children}</NavHistoryContext.Provider>
    </SessionContext.Provider>
  );
}

export function useSession() {
  const value = useContext(SessionContext);
  if (!value) throw new Error("useSession 必须在 SessionProvider 内使用");
  return value;
}

export function useNavHistory() {
  const value = useContext(NavHistoryContext);
  if (!value) throw new Error("useNavHistory 必须在 SessionProvider 内使用");
  return value;
}
