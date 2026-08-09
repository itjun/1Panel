import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { groups, sshconfig } from "@wailsjs/go/models";
import { api } from "@/lib/api";

// 分组节点（前端组装后的形态）
export interface GroupNode {
  group: groups.Group | null; // null 表示"未分组"
  hosts: sshconfig.HostConfig[];
}

// selection 表示当前选中的对象
//   { type: "group", id }   → 进入分组概览页
//   { type: "host", name }  → 进入主机详情页
//   null                    → 默认空态
export type Selection =
  | { type: "group"; id: string; name: string }
  | { type: "host"; name: string }
  | null;

interface AppState {
  hosts: sshconfig.HostConfig[];
  groupNodes: GroupNode[];
  selection: Selection;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  selectGroup: (id: string, name: string) => void;
  selectHost: (name: string) => void;
  clearSelection: () => void;
  assignHost: (host: string, groupID: string) => Promise<void>;
}

const AppContext = createContext<AppState | null>(null);

const UNGROUPED_ID = "__ungrouped__";

export function AppProvider({ children }: { children: ReactNode }) {
  const [hosts, setHosts] = useState<sshconfig.HostConfig[]>([]);
  const [groupsList, setGroupsList] = useState<groups.Group[]>([]);
  const [selection, setSelection] = useState<Selection>(null);
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

  const assignHost = async (host: string, groupID: string) => {
    // groupID === UNGROUPED_ID 时表示拖回未分组
    const targetID = groupID === UNGROUPED_ID ? "" : groupID;
    await api.assignHost(host, targetID);
    await refresh();
  };

  // selection 切换时校验：如果选中的 host/group 已不存在，自动清空
  useEffect(() => {
    if (!selection) return;
    if (selection.type === "host") {
      if (!hosts.some((h) => h.name === selection.name)) {
        setSelection(null);
      }
    } else if (selection.type === "group") {
      if (selection.id !== UNGROUPED_ID) {
        const exists = groupsList.some((g) => g.id === selection.id);
        if (!exists) setSelection(null);
      } else {
        // 未分组永远存在，但如果未分组空了且选中它，也清掉
        const ungrouped = groupNodes.find((n) => n.group === null);
        if (!ungrouped || ungrouped.hosts.length === 0) {
          setSelection(null);
        }
      }
    }
  }, [selection, hosts, groupsList, groupNodes]);

  return (
    <AppContext.Provider
      value={{
        hosts,
        groupNodes,
        selection,
        loading,
        error,
        refresh,
        selectGroup: (id, name) => setSelection({ type: "group", id, name }),
        selectHost: (name) => setSelection({ type: "host", name }),
        clearSelection: () => setSelection(null),
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
