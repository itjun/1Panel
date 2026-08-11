import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { api } from "@/api";
import type { groups, sshconfig } from "@/api";

export const UNGROUPED_ID = "__ungrouped__";

/** 同时后台挂起的主机数上限，避免连接与轮询过多 */
export const MAX_RUNNING_HOSTS = 12;

export type SubTab =
  | "overview"
  | "processes"
  | "network"
  | "docker"
  | "files"
  | "services"
  | "cron"
  | "packages"
  | "terminal";

/** 当前主区展示的对象 */
export interface ActiveView {
  id: string;
  title: string;
  subtitle?: string;
  kind: "host" | "group";
  subTab: SubTab;
}

/** 已打开主机的会话状态（切换不销毁） */
export interface HostSession {
  name: string;
  title: string;
  subtitle: string;
  subTab: SubTab;
  openedAt: number;
}

export interface GroupNode {
  group: groups.Group | null;
  hosts: sshconfig.HostConfig[];
}

export const useAppStore = defineStore("app", () => {
  const hosts = ref<sshconfig.HostConfig[]>([]);
  const groupList = ref<groups.Group[]>([]);
  const activeView = ref<ActiveView | null>(null);
  const loading = ref(false);
  /** 软件包等模块切到终端时希望自动执行的命令 */
  const pendingTerminalCmd = ref<string | null>(null);

  /** 后台常挂的主机会话（按打开顺序） */
  const hostSessions = ref<Record<string, HostSession>>({});
  const runningOrder = ref<string[]>([]);

  /** 兼容旧命名：主区/侧栏仍可能读 activeTab */
  const activeTab = computed(() => activeView.value);
  const activeTabId = computed(() => activeView.value?.id ?? null);

  const runningHosts = computed(() => runningOrder.value.slice());

  const groupNodes = computed<GroupNode[]>(() => {
    const assigned = new Set<string>();
    const nodes: GroupNode[] = [];
    const sorted = [...groupList.value].sort(
      (a, b) => (a.order ?? 0) - (b.order ?? 0)
    );
    for (const g of sorted) {
      const hs = hosts.value.filter((h) => (g.hosts || []).includes(h.name));
      hs.forEach((h) => assigned.add(h.name));
      nodes.push({ group: g, hosts: hs });
    }
    const rest = hosts.value.filter((h) => !assigned.has(h.name));
    if (rest.length > 0 || nodes.length === 0) {
      nodes.push({ group: null, hosts: rest });
    }
    return nodes;
  });

  async function refresh() {
    loading.value = true;
    try {
      // ListHosts 已过滤 github/gitee/gitlab 等 Git 托管条目
      const [h, g] = await Promise.all([api.listHosts(), api.listGroups()]);
      hosts.value = h || [];
      groupList.value = g || [];
      // 清理已不存在的主机会话
      const names = new Set((h || []).map((x) => x.name));
      for (const n of Object.keys(hostSessions.value)) {
        if (!names.has(n)) stopHost(n);
      }
    } finally {
      loading.value = false;
    }
  }

  function isRunning(name: string): boolean {
    return !!hostSessions.value[name];
  }

  function ensureSession(name: string): HostSession | null {
    const host = hosts.value.find((h) => h.name === name);
    if (!host) return null;

    const existing = hostSessions.value[name];
    if (existing) {
      // 刷新副标题（配置可能变更）
      existing.subtitle = `${host.user || "?"}@${host.hostName || "?"}`;
      existing.title = name;
      return existing;
    }

    // 超上限：挤掉最早打开且非当前激活的
    if (runningOrder.value.length >= MAX_RUNNING_HOSTS) {
      const victim =
        runningOrder.value.find((n) => n !== activeView.value?.id) ||
        runningOrder.value[0];
      if (victim) stopHost(victim);
    }

    const sess: HostSession = {
      name,
      title: name,
      subtitle: `${host.user || "?"}@${host.hostName || "?"}`,
      subTab: "overview",
      openedAt: Date.now(),
    };
    hostSessions.value = { ...hostSessions.value, [name]: sess };
    runningOrder.value = [...runningOrder.value, name];
    return sess;
  }

  function stopHost(name: string) {
    if (!hostSessions.value[name]) return;
    const next = { ...hostSessions.value };
    delete next[name];
    hostSessions.value = next;
    runningOrder.value = runningOrder.value.filter((n) => n !== name);
    if (activeView.value?.kind === "host" && activeView.value.id === name) {
      const fallback = runningOrder.value[runningOrder.value.length - 1];
      if (fallback) {
        openHostTab(fallback);
      } else {
        activeView.value = null;
      }
    }
  }

  function openHostTab(name: string) {
    const sess = ensureSession(name);
    if (!sess) return;
    // 从其它主机切入时：若已有会话则沿用其 subTab；首次则 overview
    activeView.value = {
      id: name,
      title: sess.title,
      subtitle: sess.subtitle,
      kind: "host",
      subTab: sess.subTab,
    };
  }

  function openGroupTab(id: string, title: string) {
    activeView.value = {
      id,
      title,
      kind: "group",
      subTab: "overview",
    };
  }

  function setSubTab(_tabId: string, sub: SubTab) {
    if (!activeView.value || activeView.value.kind !== "host") return;
    const name = activeView.value.id;
    activeView.value = { ...activeView.value, subTab: sub };
    const sess = hostSessions.value[name];
    if (sess) {
      hostSessions.value = {
        ...hostSessions.value,
        [name]: { ...sess, subTab: sub },
      };
    }
  }

  function sendTerminalCmd(cmd: string) {
    pendingTerminalCmd.value = cmd;
  }

  function clearTerminalCmd() {
    pendingTerminalCmd.value = null;
  }

  async function createGroup(name: string) {
    const id = `g_${Date.now().toString(36)}`;
    await api.upsertGroup({
      id,
      name,
      order: groupList.value.length,
      hosts: [],
    } as groups.Group);
    await refresh();
    return id;
  }

  async function renameGroup(id: string, newName: string) {
    await api.renameGroup(id, newName);
    await refresh();
    if (activeView.value?.id === id) {
      activeView.value = { ...activeView.value, title: newName };
    }
  }

  async function assignHost(host: string, groupID: string) {
    await api.assignHost(host, groupID);
    await refresh();
  }

  /** 重命名主机别名；若会话在跑则迁移会话键 */
  async function renameHost(oldName: string, newName: string) {
    const next = newName.trim();
    if (!next || next === oldName) return;
    await api.renameHost(oldName, next);

    // 迁移后台会话 / 激活态（后端会关旧 SSH 连接）
    const sess = hostSessions.value[oldName];
    if (sess) {
      const migrated: HostSession = {
        ...sess,
        name: next,
        title: next,
      };
      const map = { ...hostSessions.value };
      delete map[oldName];
      map[next] = migrated;
      hostSessions.value = map;
      runningOrder.value = runningOrder.value.map((n) =>
        n === oldName ? next : n
      );
    }
    if (activeView.value?.kind === "host" && activeView.value.id === oldName) {
      activeView.value = {
        ...activeView.value,
        id: next,
        title: next,
      };
    }
    await refresh();
  }

  /** 编辑主机 IP/用户（后端会密码验连 + 推公钥 + 写 config） */
  async function updateHost(input: {
    name: string;
    hostName: string;
    user: string;
    password: string;
  }) {
    await api.updateHost(input);
    // 关旧会话参数：若正在跑，停掉让用户重新打开
    if (hostSessions.value[input.name]) {
      stopHost(input.name);
    }
    await refresh();
  }

  /** 从 ~/.ssh/config 删除主机 */
  async function deleteHost(name: string) {
    await api.deleteHost(name);
    stopHost(name);
    await refresh();
  }

  return {
    hosts,
    groupList,
    activeView,
    activeTab,
    activeTabId,
    groupNodes,
    loading,
    pendingTerminalCmd,
    hostSessions,
    runningHosts,
    runningOrder,
    refresh,
    isRunning,
    openHostTab,
    openGroupTab,
    setSubTab,
    stopHost,
    sendTerminalCmd,
    clearTerminalCmd,
    createGroup,
    renameGroup,
    renameHost,
    updateHost,
    deleteHost,
    assignHost,
  };
});
