import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { api } from "@/api";
import type { groups, sshconfig } from "@/api";
import { useSettingsStore } from "@/stores/settings";

export const UNGROUPED_ID = "__ungrouped__";

export type SubTab =
  | "overview"
  | "apps"
  | "processes"
  | "network"
  | "files"
  | "services"
  | "certs"
  | "cron"
  | "packages"
  | "logs"
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
  /** 访问过的子页（常驻保活：v-if 用它决定首挂，v-show 负责切换） */
  visited: SubTab[];
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
  /** 主机名 → osRelease 映射（本地记录；启动只读盘，缺失再远程补） */
  const osReleaseMap = ref<Map<string, string>>(new Map());
  /** 批量检查/更新图标进行中 */
  const iconsRefreshing = ref(false);
  /** 软件包等模块切到终端时希望自动执行的命令 */
  const pendingTerminalCmd = ref<string | null>(null);

  /** 侧栏开/关（⌘B 切换，持久化到 localStorage） */
  function loadSidebarOpen(): boolean {
    try {
      const v = localStorage.getItem("ipannel.sidebarOpen");
      return v === null ? true : v === "1";
    } catch {
      return true;
    }
  }
  const sidebarOpen = ref(loadSidebarOpen());
  function setSidebarOpen(v: boolean) {
    sidebarOpen.value = v;
    try {
      localStorage.setItem("ipannel.sidebarOpen", v ? "1" : "0");
    } catch {
      /* ignore */
    }
  }
  function toggleSidebar() {
    setSidebarOpen(!sidebarOpen.value);
  }

  /** ⌘F / Ctrl+F 打开窗口居中搜索 */
  const sidebarSearchOpen = ref(false);
  function setSidebarSearchOpen(v: boolean) {
    sidebarSearchOpen.value = v;
  }

  /** 后台常挂的主机会话（按打开顺序） */
  const hostSessions = ref<Record<string, HostSession>>({});
  const runningOrder = ref<string[]>([]);
  /** 访问过的分组页（常驻保活，按打开顺序） */
  const visitedGroupIds = ref<string[]>([]);

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
      // 图标记录与主机列表一起读本地，启动不再远程扫操作系统
      const [h, g, icons] = await Promise.all([
        api.listHosts(),
        api.listGroups(),
        api.listHostIcons().catch(() => [] as { host?: string; osRelease?: string }[]),
      ]);
      hosts.value = h || [];
      groupList.value = g || [];
      const m = new Map<string, string>();
      for (const it of icons || []) {
        if (it.host && it.osRelease) {
          m.set(it.host, it.osRelease);
        }
      }
      osReleaseMap.value = m;
      // 清理已不存在的主机会话
      const names = new Set((h || []).map((x) => x.name));
      for (const n of Object.keys(hostSessions.value)) {
        if (!names.has(n)) stopHost(n);
      }
    } finally {
      loading.value = false;
    }
    void fillMissingIcons();
  }

  function applyIconResults(
    list: { host?: string; osRelease?: string }[] | null | undefined
  ) {
    const m = new Map(osReleaseMap.value);
    for (const it of list || []) {
      if (it.host && it.osRelease) {
        m.set(it.host, it.osRelease);
      }
    }
    osReleaseMap.value = m;
  }

  /** 只补齐还没有记录的主机（轻量读 os-release，失败静默） */
  async function fillMissingIcons() {
    const names = hosts.value.map((h) => h.name);
    const missing = names.filter((n) => !osReleaseMap.value.get(n));
    if (missing.length === 0) return;
    try {
      const list = await api.refreshMissingHostIcons();
      applyIconResults(list);
    } catch {
      /* 补齐失败不影响启动 */
    }
  }

  /** 打开主机概览拿到 osRelease 后，立刻更新侧栏图标 */
  function rememberOsRelease(host: string, osRelease: string) {
    const name = (host || "").trim();
    const os = (osRelease || "").trim();
    if (!name || !os) return;
    if (osReleaseMap.value.get(name) === os) return;
    const m = new Map(osReleaseMap.value);
    m.set(name, os);
    osReleaseMap.value = m;
  }

  /** 强制重新探测一台主机的发行版图标 */
  async function refreshHostIcon(name: string): Promise<string> {
    const r = await api.refreshHostIcon(name);
    if (r?.osRelease) {
      rememberOsRelease(r.host || name, r.osRelease);
    }
    if (r?.error) {
      throw new Error(r.error);
    }
    return r?.osRelease || "";
  }

  /** 强制检查并更新全部主机图标 */
  async function refreshAllHostIcons(): Promise<{
    ok: number;
    failed: { host: string; error: string }[];
  }> {
    iconsRefreshing.value = true;
    try {
      const list = await api.refreshAllHostIcons();
      applyIconResults(list);
      const failed: { host: string; error: string }[] = [];
      let ok = 0;
      for (const it of list || []) {
        if (it.error) {
          failed.push({ host: it.host || "", error: it.error });
        } else if (it.osRelease) {
          ok += 1;
        }
      }
      return { ok, failed };
    } finally {
      iconsRefreshing.value = false;
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

    // 超上限：挤掉最早打开且非当前激活的（上限可在设置里调）
    const settings = useSettingsStore();
    if (runningOrder.value.length >= settings.maxRunningHosts) {
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
      visited: ["overview"],
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
    // 分组页常驻保活：记录访问过的分组，MainArea 据此 v-show 切换
    if (!visitedGroupIds.value.includes(id)) {
      visitedGroupIds.value = [...visitedGroupIds.value, id];
    }
  }

  /** 分组显示名（常驻分组页的 group-name 派生源，改名后自动更新） */
  function groupNameOf(id: string): string {
    if (id === UNGROUPED_ID) return "未分组";
    return groupList.value.find((g) => g.id === id)?.name || id;
  }

  /** 返回全部主机概览（保留后台运行的主机会话） */
  function goHome() {
    activeView.value = null;
  }

  function setSubTab(_tabId: string, sub: SubTab) {
    if (!activeView.value || activeView.value.kind !== "host") return;
    const name = activeView.value.id;
    activeView.value = { ...activeView.value, subTab: sub };
    const sess = hostSessions.value[name];
    if (sess) {
      // 记录访问过的子页：MainArea 据此常驻挂载，切回零加载
      const visited = sess.visited.includes(sub) ? sess.visited : [...sess.visited, sub];
      hostSessions.value = {
        ...hostSessions.value,
        [name]: { ...sess, subTab: sub, visited },
      };
    }
  }

  /** 某主机的某子页当前是否正被查看（常驻子页激活时补刷用） */
  function isHostSubActive(host: string, sub: SubTab): boolean {
    const t = activeView.value;
    return t?.kind === "host" && t.id === host && t.subTab === sub;
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

    // 图标记录随别名迁移，避免侧栏闪回默认企鹅
    if (osReleaseMap.value.has(oldName)) {
      const m = new Map(osReleaseMap.value);
      const os = m.get(oldName) || "";
      m.delete(oldName);
      if (os) m.set(next, os);
      osReleaseMap.value = m;
    }

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
    osReleaseMap,
    iconsRefreshing,
    pendingTerminalCmd,
    hostSessions,
    runningHosts,
    runningOrder,
    visitedGroupIds,
    sidebarOpen,
    setSidebarOpen,
    toggleSidebar,
    sidebarSearchOpen,
    setSidebarSearchOpen,
    refresh,
    rememberOsRelease,
    refreshHostIcon,
    refreshAllHostIcons,
    isRunning,
    openHostTab,
    openGroupTab,
    groupNameOf,
    goHome,
    setSubTab,
    isHostSubActive,
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
