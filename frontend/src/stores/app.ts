import { defineStore } from "pinia";
import { computed, nextTick, ref } from "vue";
import { api } from "@/api";
import type { groups, sshconfig } from "@/api";
import { useSettingsStore } from "@/stores/settings";

export const UNGROUPED_ID = "__ungrouped__";
/** 拖放到「全部主机」：分组升顶层；主机进未分组 */
export const ROOT_DROP_ID = "__root__";
export const MAX_GROUP_DEPTH = 3;

export type SubTab =
  | "overview"
  | "monitor"
  | "apps"
  | "nginx"
  | "processes"
  | "network"
  | "hosts"
  | "files"
  | "services"
  | "certs"
  | "cron"
  | "packages"
  | "logs"
  | "notifications"
  | "terminal";

/** 工作区：远程主机 / 本机应用 */
export type Workspace = "remote" | "local";

/** 本机二级栏：页面导航 */
export type LocalSection =
  | "overview"
  | "sysinfo"
  | "procs"
  | "packages"
  | "storage"
  | "network"
  | "nginx"
  | "hosts";

/** 本机应用进程页：语言过滤（页内 chips） */
export type LocalRuntimeFilter = "all" | import("@/utils/localLang").LocalLangId;

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
  /**
   * 访问过的子页（按访问时间旧→新；v-if 用它决定首挂，v-show 负责切换）。
   * LRU 上限：最多保留 MAX_RESIDENT_SUBS 个，超出挤掉最旧的
   * （overview 永久保留，不参与淘汰；终端走 KeepAlive 不占名额）。
   */
  visited: SubTab[];
}

/** 每台主机常驻保活的子页数上限（含 overview；terminal 另计豁免） */
export const MAX_RESIDENT_SUBS = 4;

export interface GroupNode {
  group: groups.Group | null;
  /** 本节点直接挂载的主机 */
  hosts: sshconfig.HostConfig[];
  /** 子分组（树） */
  children: GroupNode[];
  /** 深度：根=1；未分组=0 */
  depth: number;
  /** 顶层彩虹序号；子节点继承根 */
  rootIndex: number;
  /** 子树全部主机（本层+子孙，去重保序） */
  subtreeHosts: sshconfig.HostConfig[];
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

  /**
   * 设置整页覆盖主区，但不改 activeView。
   * 再点设置 / Esc 即回到底下那一页；点主机/分组/全部主机会关掉设置并切过去。
   */
  const settingsOpen = ref(false);
  function openSettings() {
    settingsOpen.value = true;
  }
  function closeSettings() {
    settingsOpen.value = false;
  }
  function toggleSettings() {
    settingsOpen.value = !settingsOpen.value;
  }

  /** 工作区：远程主机 / 本机应用（持久化；切到本机不清远程会话） */
  function loadWorkspace(): Workspace {
    try {
      const v = localStorage.getItem("1pannel-workspace");
      if (v === "local" || v === "remote") return v;
    } catch {
      /* ignore */
    }
    return "remote";
  }
  const workspace = ref<Workspace>(loadWorkspace());
  function setWorkspace(w: Workspace) {
    workspace.value = w;
    // 设置整页盖在主区上；切远程/本机时先关掉，否则仍停在设置页
    settingsOpen.value = false;
    try {
      localStorage.setItem("1pannel-workspace", w);
    } catch {
      /* ignore */
    }
  }

  /** 本机二级栏：页面导航（持久化） */
  function loadLocalSection(): LocalSection {
    try {
      const v = localStorage.getItem("1pannel-local-section");
      if (
        v === "overview" ||
        v === "sysinfo" ||
        v === "procs" ||
        v === "packages" ||
        v === "storage" ||
        v === "network" ||
        v === "nginx" ||
        v === "hosts"
      ) {
        return v;
      }
    } catch {
      /* ignore */
    }
    return "overview";
  }
  const localSection = ref<LocalSection>(loadLocalSection());
  function setLocalSection(v: LocalSection) {
    localSection.value = v;
    try {
      localStorage.setItem("1pannel-local-section", v);
    } catch {
      /* ignore */
    }
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
    const byParent = new Map<string, groups.Group[]>();
    const sorted = [...groupList.value].sort((a, b) => {
      if ((a.order ?? 0) !== (b.order ?? 0)) {
        return (a.order ?? 0) - (b.order ?? 0);
      }
      return (a.name || "").localeCompare(b.name || "");
    });
    for (const g of sorted) {
      const pid = (g.parentId || "").trim();
      const list = byParent.get(pid) || [];
      list.push(g);
      byParent.set(pid, list);
    }

    const assigned = new Set<string>();
    const hostByName = new Map(hosts.value.map((h) => [h.name, h]));

    function directHosts(g: groups.Group): sshconfig.HostConfig[] {
      const out: sshconfig.HostConfig[] = [];
      for (const name of g.hosts || []) {
        const h = hostByName.get(name);
        if (h) {
          out.push(h);
          assigned.add(h.name);
        }
      }
      return out;
    }

    function build(g: groups.Group, depth: number, rootIndex: number): GroupNode {
      const kids = byParent.get(g.id) || [];
      const children = kids.map((c) => build(c, depth + 1, rootIndex));
      const hostsHere = directHosts(g);
      const subtreeHosts: sshconfig.HostConfig[] = [];
      const seen = new Set<string>();
      for (const h of hostsHere) {
        if (!seen.has(h.name)) {
          seen.add(h.name);
          subtreeHosts.push(h);
        }
      }
      for (const ch of children) {
        for (const h of ch.subtreeHosts) {
          if (!seen.has(h.name)) {
            seen.add(h.name);
            subtreeHosts.push(h);
          }
        }
      }
      return {
        group: g,
        hosts: hostsHere,
        children,
        depth,
        rootIndex,
        subtreeHosts,
      };
    }

    const roots = byParent.get("") || [];
    const nodes: GroupNode[] = roots.map((g, i) => build(g, 1, i));

    const rest = hosts.value.filter((h) => !assigned.has(h.name));
    if (rest.length > 0 || nodes.length === 0) {
      nodes.push({
        group: null,
        hosts: rest,
        children: [],
        depth: 0,
        rootIndex: -1,
        subtreeHosts: rest,
      });
    }
    return nodes;
  });

  /** DFS 展平树中全部真实分组节点（不含未分组） */
  function flattenGroupNodes(nodes?: GroupNode[]): GroupNode[] {
    const src = nodes || groupNodes.value;
    const out: GroupNode[] = [];
    const walk = (list: GroupNode[]) => {
      for (const n of list) {
        if (!n.group) continue;
        out.push(n);
        if (n.children?.length) walk(n.children);
      }
    };
    walk(src);
    return out;
  }

  /** 侧栏/快捷键用：按树 DFS 顺序展平全部主机（先子分组再本层，与侧栏一致） */
  function flattenHostsInTreeOrder(): sshconfig.HostConfig[] {
    const seen = new Set<string>();
    const out: sshconfig.HostConfig[] = [];
    const walk = (list: GroupNode[]) => {
      for (const n of list) {
        if (n.group) {
          if (n.children?.length) walk(n.children);
          for (const h of n.hosts) {
            if (!seen.has(h.name)) {
              seen.add(h.name);
              out.push(h);
            }
          }
        } else {
          for (const h of n.hosts) {
            if (!seen.has(h.name)) {
              seen.add(h.name);
              out.push(h);
            }
          }
        }
      }
    };
    walk(groupNodes.value);
    return out;
  }

  function findGroupNode(id: string): GroupNode | null {
    for (const n of flattenGroupNodes()) {
      if (n.group?.id === id) return n;
    }
    return null;
  }

  function groupDepthOf(id: string): number {
    return findGroupNode(id)?.depth || 0;
  }

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

    // 超上限：挤掉最早打开且非当前激活的（上限可在设置里调）。
    // 有终端子页的主机不许挤——终端是用户特意开的，断开不可恢复，
    // 宁可临时超出上限也要保留（吃内存不管）
    const settings = useSettingsStore();
    if (runningOrder.value.length >= settings.maxRunningHosts) {
      const victim =
        runningOrder.value.find(
          (n) =>
            n !== activeView.value?.id &&
            !hostSessions.value[n]?.visited.includes("terminal")
        ) || null;
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

  function openHostTab(name: string, subTab?: SubTab) {
    const sess = ensureSession(name);
    if (!sess) return;
    settingsOpen.value = false;
    // 先激活该主机会话，再按需切子页（setSubTab 依赖激活视图）
    activeView.value = {
      id: name,
      title: sess.title,
      subtitle: sess.subtitle,
      kind: "host",
      subTab: sess.subTab,
    };
    if (subTab && subTab !== sess.subTab) {
      setSubTab(name, subTab);
    }
  }

  function openGroupTab(id: string, title: string) {
    settingsOpen.value = false;
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
    settingsOpen.value = false;
    activeView.value = null;
  }

  function setSubTab(_tabId: string, sub: SubTab) {
    if (!activeView.value || activeView.value.kind !== "host") return;
    const name = activeView.value.id;
    activeView.value = { ...activeView.value, subTab: sub };
    const sess = hostSessions.value[name];
    if (sess) {
      // 记录访问过的子页：MainArea 据此常驻挂载，切回零加载。
      // 按访问顺序排列（旧→新），超出上限挤掉最旧的；
      // overview 永久保留；terminal 也永久保留——它既是 KeepAlive
      // 之外的存活性标记（有终端的主机不许被会话上限挤掉），
      // 也意味着该主机会常驻 overview+terminal+2 个其它子页
      let visited = sess.visited.includes(sub)
        ? sess.visited.filter((v) => v !== sub)
        : sess.visited;
      visited = [...visited, sub];
      while (visited.length > MAX_RESIDENT_SUBS) {
        const evict = visited.find(
          (v) => v !== "overview" && v !== "terminal" && v !== sub
        );
        if (!evict) break;
        visited = visited.filter((v) => v !== evict);
      }
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

  /** 某主机会话当前是否可见（不含子页维度：会话被切走即视为不可见） */
  function isHostVisible(host: string): boolean {
    if (settingsOpen.value) return false;
    const t = activeView.value;
    return t?.kind === "host" && t.id === host;
  }

  /** 某分组页当前是否可见（设置页打开或切走即不可见） */
  function isGroupVisible(groupId: string): boolean {
    if (settingsOpen.value) return false;
    const t = activeView.value;
    return t?.kind === "group" && t.id === groupId;
  }

  function sendTerminalCmd(cmd: string) {
    pendingTerminalCmd.value = cmd;
  }

  function clearTerminalCmd() {
    pendingTerminalCmd.value = null;
  }

  /**
   * 切到终端子页再投递命令：先 setSubTab 让 TerminalView 挂载/激活，
   * 再 nextTick 后投递，避免子页尚未挂载时 pending 被漏掉。
   * 三处调用点（概览安装运行环境 / 软件包管理 / 右键初始化 zsh）统一走这里。
   */
  async function runInTerminal(cmd: string) {
    if (!activeView.value) return;
    setSubTab(activeView.value.id, "terminal");
    await nextTick();
    pendingTerminalCmd.value = cmd;
  }

  async function createGroup(name: string, parentId?: string) {
    const id = `g_${Date.now().toString(36)}`;
    const pid = (parentId || "").trim();
    if (pid) {
      const d = groupDepthOf(pid);
      if (d <= 0) throw new Error("父分组不存在");
      if (d >= MAX_GROUP_DEPTH) {
        throw new Error(`分组最多 ${MAX_GROUP_DEPTH} 层，无法再新建子分组`);
      }
    }
    await api.upsertGroup({
      id,
      name,
      parentId: pid || undefined,
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

  async function setBoardTitle(id: string, title: string) {
    await api.setBoardTitle(id, title);
    await refresh();
  }

  async function moveGroup(id: string, parentId: string) {
    await api.moveGroup(id, parentId);
    await refresh();
  }

  async function previewDeleteGroup(id: string) {
    return api.previewDeleteGroup(id);
  }

  async function deleteGroup(id: string) {
    const gid = id.trim();
    if (!gid || gid === UNGROUPED_ID) return;
    await api.deleteGroup(gid);
    await refresh();
    if (
      activeView.value?.kind === "group" &&
      activeView.value.id &&
      !groupList.value.some((g) => g.id === activeView.value!.id)
    ) {
      goHome();
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
    useSettingsStore().renameNotifyHost(oldName, next);

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

  /** 编辑主机 IP/用户/备注（后端会密码验连 + 推公钥 + 写 config；备注写本机） */
  async function updateHost(input: {
    name: string;
    hostName: string;
    user: string;
    password: string;
    note?: string;
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
    settingsOpen,
    openSettings,
    closeSettings,
    toggleSettings,
    workspace,
    setWorkspace,
    localSection,
    setLocalSection,
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
    isHostVisible,
    isGroupVisible,
    stopHost,
    sendTerminalCmd,
    clearTerminalCmd,
    runInTerminal,
    createGroup,
    renameGroup,
    setBoardTitle,
    moveGroup,
    previewDeleteGroup,
    deleteGroup,
    flattenGroupNodes,
    flattenHostsInTreeOrder,
    findGroupNode,
    groupDepthOf,
    renameHost,
    updateHost,
    deleteHost,
    assignHost,
  };
});
