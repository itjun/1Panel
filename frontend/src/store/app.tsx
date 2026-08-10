import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { groups, sshconfig } from "@wailsjs/go/models";
import { api } from "@/lib/api";

// 主机详情页内的子标签页类型
export type SubTabKey =
  | "overview"
  | "processes"
  | "docker"
  | "files"
  | "terminal"
  | "services"
  | "cron"
  | "packages";

// 一个打开的应用标签页（一台主机或一个分组概览）
export interface AppTab {
  id: string;        // 唯一 ID（host name 或 group id）
  kind: "host" | "group";
  title: string;     // 显示名（host 别名 或 分组名）
  subtitle?: string; // host: user@ip / group: "分组概览"
  subTab: SubTabKey; // 该标签页内选中的子 Tab（概览/进程/...），持久化
}

// 分组节点（前端组装后的形态）
export interface GroupNode {
  group: groups.Group | null; // null 表示"未分组"
  hosts: sshconfig.HostConfig[];
}

interface AppState {
  hosts: sshconfig.HostConfig[];
  groupNodes: GroupNode[];
  tabs: AppTab[];
  activeTabId: string | null;
  activeTab: AppTab | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  // 标签页操作
  openHostTab: (name: string) => void;
  openGroupTab: (id: string, name: string) => void;
  closeTab: (id: string) => void;
  closeOtherTabs: (id: string) => void;
  closeLeftTabs: (id: string) => void;
  closeRightTabs: (id: string) => void;
  closeAllTabs: () => void;
  setActiveTab: (id: string) => void;
  setSubTab: (tabId: string, sub: SubTabKey) => void;
  // 终端命令下发：其它组件（如软件包）切到终端时让终端自动执行的命令
  pendingTerminalCmd: string | null;
  sendTerminalCmd: (cmd: string) => void;
  clearTerminalCmd: () => void;
  // 分组拖拽
  assignHost: (host: string, groupID: string) => Promise<void>;
}

const AppContext = createContext<AppState | null>(null);

const UNGROUPED_ID = "__ungrouped__";

export function AppProvider({ children }: { children: ReactNode }) {
  const [hosts, setHosts] = useState<sshconfig.HostConfig[]>([]);
  const [groupsList, setGroupsList] = useState<groups.Group[]>([]);
  const [tabs, setTabs] = useState<AppTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [pendingTerminalCmd, setPendingTerminalCmd] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    try {
      setLoading(true);
      setError(null);
      const [hs, gs] = await Promise.all([api.listHosts(), api.listGroups()]);
      setHosts(hs || []);
      setGroupsList(gs || []);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  // 把 hosts + groups 组装成 GroupNode[]（含"未分组"桶）
  const groupNodes: GroupNode[] = (() => {
    const assigned = new Set<string>();
    const nodes: GroupNode[] = (groupsList || []).map((g) => {
      const inGroup = (g.hosts || []).filter((h) =>
        (hosts || []).some((hh) => hh.name === h)
      );
      inGroup.forEach((h) => assigned.add(h));
      return {
        group: g,
        hosts: inGroup
          .map((h) => hosts.find((hh) => hh.name === h))
          .filter(Boolean) as sshconfig.HostConfig[],
      };
    });
    const ungrouped = (hosts || []).filter((h) => !assigned.has(h.name));
    if (ungrouped.length > 0) {
      nodes.push({ group: null, hosts: ungrouped });
    }
    return nodes;
  })();

  const activeTab = activeTabId ? tabs.find((t) => t.id === activeTabId) ?? null : null;

  // ===== 标签页操作 =====

  // 打开（或聚焦）一个主机标签页
  const openHostTab = (name: string) => {
    const existing = tabs.find((t) => t.id === name);
    if (existing) {
      setActiveTabId(name);
      return;
    }
    const host = hosts.find((h) => h.name === name);
    const subtitle = host
      ? `${host.user || "?"}@${host.hostName || "?"}`
      : undefined;
    const newTab: AppTab = {
      id: name,
      kind: "host",
      title: name,
      subtitle,
      subTab: "overview",
    };
    setTabs((ts) => [...ts, newTab]);
    setActiveTabId(name);
  };

  // 打开（或聚焦）一个分组概览标签页
  const openGroupTab = (id: string, name: string) => {
    const existing = tabs.find((t) => t.id === id);
    if (existing) {
      setActiveTabId(id);
      return;
    }
    const newTab: AppTab = {
      id,
      kind: "group",
      title: name,
      subtitle: "分组概览",
      subTab: "overview",
    };
    setTabs((ts) => [...ts, newTab]);
    setActiveTabId(id);
  };

  // 关闭一个标签页：活跃自动切到右侧（或左侧）标签
  const closeTab = (id: string) => {
    const idx = tabs.findIndex((t) => t.id === id);
    if (idx < 0) return;
    const next = tabs.filter((t) => t.id !== id);
    setTabs(next);
    if (activeTabId === id) {
      // 优先切到右侧标签，没有则左侧，都没有则空态
      const fallback = next[idx] || next[idx - 1] || null;
      setActiveTabId(fallback ? fallback.id : null);
    }
  };

  const closeOtherTabs = (id: string) => {
    const keep = tabs.find((t) => t.id === id);
    if (!keep) return;
    setTabs([keep]);
    setActiveTabId(id);
  };

  // 关闭某标签左侧的所有标签
  const closeLeftTabs = (id: string) => {
    const idx = tabs.findIndex((t) => t.id === id);
    if (idx <= 0) return;
    setTabs(tabs.slice(idx));
    setActiveTabId(id);
  };

  // 关闭某标签右侧的所有标签
  const closeRightTabs = (id: string) => {
    const idx = tabs.findIndex((t) => t.id === id);
    if (idx < 0) return;
    setTabs(tabs.slice(0, idx + 1));
    setActiveTabId(id);
  };

  // 关闭所有标签
  const closeAllTabs = () => {
    setTabs([]);
    setActiveTabId(null);
  };

  const setActiveTab = (id: string) => setActiveTabId(id);

  const sendTerminalCmd = (cmd: string) => setPendingTerminalCmd(cmd);
  const clearTerminalCmd = () => setPendingTerminalCmd(null);

  const setSubTab = (tabId: string, sub: SubTabKey) => {
    setTabs((ts) =>
      ts.map((t) => (t.id === tabId ? { ...t, subTab: sub } : t))
    );
  };

  const assignHost = async (host: string, groupID: string) => {
    const targetID = groupID === UNGROUPED_ID ? "" : groupID;
    await api.assignHost(host, targetID);
    await refresh();
  };

  // 自动清理：当主机/分组从列表消失时，移除对应的标签页
  useEffect(() => {
    setTabs((ts) =>
      ts.filter((t) => {
        if (t.kind === "host") {
          return hosts.some((h) => h.name === t.id);
        }
        // 分组标签：未分组永远存在；其它校验 groupsList
        if (t.id === UNGROUPED_ID) return true;
        return groupsList.some((g) => g.id === t.id);
      })
    );
  }, [hosts, groupsList]);

  // 活跃标签被清理后，回退到第一个（如果有）
  useEffect(() => {
    if (activeTabId && !tabs.some((t) => t.id === activeTabId)) {
      setActiveTabId(tabs.length > 0 ? tabs[0].id : null);
    }
  }, [tabs, activeTabId]);

  return (
    <AppContext.Provider
      value={{
        hosts,
        groupNodes,
        tabs,
        activeTabId,
        activeTab,
        loading,
        error,
        refresh,
        openHostTab,
        openGroupTab,
        closeTab,
        closeOtherTabs,
        closeLeftTabs,
        closeRightTabs,
        closeAllTabs,
        setActiveTab,
        setSubTab,
        pendingTerminalCmd,
        sendTerminalCmd,
        clearTerminalCmd,
        assignHost,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used within AppProvider");
  return ctx;
}

export { UNGROUPED_ID };
