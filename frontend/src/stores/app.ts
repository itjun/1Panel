import { defineStore } from "pinia";
import { computed, nextTick, ref, watch } from "vue";
import { api } from "@/api";
import type { groups, sshconfig } from "@/api";
import { useSettingsStore } from "@/stores/settings";
import { ElMessage } from "element-plus";
import { formatErr } from "@/utils/format";
import {
  hostsInTree,
  loadSavedWorkspaces,
  patchSavedWorkspaceTitle,
  removeSavedWorkspace,
  touchSavedWorkspaceActive,
  upsertSavedWorkspace,
} from "@/utils/workspaceLayout";
import { findLeaf, orderedLeaves, type PaneNode } from "@/views/termPanes";
import { readLastScreen, writeLastScreen, type NormalizedScreen } from "@/utils/lastScreen";
import { noteSwitch } from "@/utils/uxPerf";
import {
  liftTerminalDesks,
  migrateWorkspaces,
  SPLIT_TITLE,
  type MigratedWorkspace,
} from "@/utils/workspaceMigrate";

export const UNGROUPED_ID = "__ungrouped__";
/** 拖放到「全部主机」：分组升顶层；主机进未分组 */
export const ROOT_DROP_ID = "__root__";
/** 拖放到侧栏顶部置顶区 */
export const PINNED_DROP_ID = "__pinned__";
export const MAX_GROUP_DEPTH = 1;

const PINNED_HOSTS_KEY = "1pannel-pinned-hosts";

export type SubTab =
  | "overview"
  | "file-manager"
  | "monitor"
  | "apps"
  | "nginx"
  | "processes"
  | "network"
  | "hosts"
  | "apt"
  | "files"
  | "services"
  | "certs"
  | "cron"
  | "packages"
  | "logs"
  | "terminal";

/** 工作区会话种类。sftp 保留为双栏 XFPT，file-manager 是旧版文件管理器。 */
export type SessionKind =
  | "terminal"
  | "info"
  | "file-manager"
  | "sftp"
  | "monitor"
  | "certs"
  | "nginx"
  | "processes"
  | "network"
  | "hosts"
  | "apt"
  | "apps"
  | "services"
  | "cron"
  | "logs"
  | "packages";

export type WorkspaceRole = "host" | "bench";

/** 终端模块里的一个 SSH 会话。分屏树仍挂在这个 id 上。 */
export interface TerminalDesk {
  id: string;
  host: string;
  title: string;
  titleCustom?: boolean;
  /** 窗格里有多台主机。列表里归到「分屏」，不占主机标签。 */
  crossHost: boolean;
}

/**
 * 主机管理标签。一台主机一个。服务保留兼容旧数据，但不再出现在主机功能栏。
 * 终端会话在 terminalDesks，关这个标签不会拆掉它们。
 */
export interface WorkspaceSession {
  id: string;
  host: string;
  role: "host";
  tool: SessionKind;
  title: string;
  /** 用户右键改过名字后，不再自动改标题 */
  titleCustom?: boolean;
}

export function subTabToKind(sub?: SubTab | null): SessionKind {
  if (sub === "terminal") return "terminal";
  if (sub === "file-manager") return "file-manager";
  if (sub === "files") return "sftp";
  if (sub === "monitor") return "monitor";
  if (sub === "certs") return "certs";
  if (sub === "nginx") return "nginx";
  if (sub === "processes") return "processes";
  if (sub === "network") return "network";
  if (sub === "hosts") return "hosts";
  if (sub === "apt") return "apt";
  if (sub === "apps") return "apps";
  if (sub === "services") return "services";
  if (sub === "cron") return "cron";
  if (sub === "logs") return "logs";
  if (sub === "packages") return "packages";
  return "info";
}

export function kindToSubTab(kind: SessionKind): SubTab {
  if (kind === "terminal") return "terminal";
  if (kind === "file-manager") return "file-manager";
  if (kind === "sftp") return "files";
  if (kind === "monitor") return "monitor";
  if (kind === "certs") return "certs";
  if (kind === "nginx") return "nginx";
  if (kind === "processes") return "processes";
  if (kind === "network") return "network";
  if (kind === "hosts") return "hosts";
  if (kind === "apt") return "apt";
  if (kind === "apps") return "apps";
  if (kind === "services") return "services";
  if (kind === "cron") return "cron";
  if (kind === "logs") return "logs";
  if (kind === "packages") return "packages";
  return "overview";
}

export function sessionKindLabel(kind: SessionKind): string {
  if (kind === "terminal") return "终端";
  if (kind === "info") return "概览";
  if (kind === "file-manager") return "文件";
  if (kind === "sftp") return "XFPT";
  if (kind === "certs") return "证书";
  if (kind === "nginx") return "Nginx";
  if (kind === "processes") return "进程";
  if (kind === "network") return "网络";
  if (kind === "hosts") return "Hosts";
  if (kind === "apt") return "apt 源";
  if (kind === "apps") return "应用";
  if (kind === "services") return "服务";
  if (kind === "cron") return "定时任务";
  if (kind === "logs") return "日志";
  if (kind === "packages") return "软件包";
  return "监控";
}

function hostWorkspaceId(host: string): string {
  return `host:${host}`;
}

/** 终端会话 id。旧数据里的 terminal:host:n 继续认，避免布局键对不上。 */
let terminalSeq = 0;
function newTermDeskId(host: string): string {
  terminalSeq += 1;
  return `term:${host}:${terminalSeq}`;
}

function noteTerminalSeq(id: string) {
  const i = id.lastIndexOf(":");
  if (i < 0) return;
  const n = Number(id.slice(i + 1));
  if (!Number.isFinite(n)) return;
  if (n > terminalSeq) terminalSeq = n;
}

/** 工作区：主机 / 终端 / 本机应用 / 巡检 / 通知。主机仍用 remote，避免把通知流程一起改名。 */
export type Workspace = "remote" | "terminal" | "local" | "inspect" | "notify";

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

/** 通知页：消息列表，或同一页里的通道、内容与主机订阅 */
export type NotifySection = "messages" | "setup";

/** 巡检二级栏：页面导航 */
export type InspectSection = "menuCheck";

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
  /** 访问过的子页；v-if 用它决定首挂，v-show 负责切换。已访问页面持续保活。 */
  visited: SubTab[];
}

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

  /** ⌘F / Ctrl+F：聚焦侧栏主机搜索 */
  const homeSearchFocusSeq = ref(0);
  function openHomeHostSearch() {
    closeSettings();
    if (workspace.value !== "remote") {
      setWorkspace("remote");
    }
    if (!sidebarOpen.value) setSidebarOpen(true);
    homeSearchFocusSeq.value += 1;
  }

  /** 侧栏顶部置顶主机（快捷入口；不改变分组归属；持久化） */
  function loadPinnedHosts(): string[] {
    try {
      const raw = localStorage.getItem(PINNED_HOSTS_KEY);
      if (!raw) return [];
      const arr = JSON.parse(raw);
      if (!Array.isArray(arr)) return [];
      const out: string[] = [];
      const seen = new Set<string>();
      for (const x of arr) {
        if (typeof x !== "string") continue;
        const n = x.trim();
        if (!n || seen.has(n)) continue;
        seen.add(n);
        out.push(n);
      }
      return out;
    } catch {
      return [];
    }
  }
  const pinnedHosts = ref<string[]>(loadPinnedHosts());
  function persistPinnedHosts() {
    try {
      localStorage.setItem(PINNED_HOSTS_KEY, JSON.stringify(pinnedHosts.value));
    } catch {
      /* ignore */
    }
  }
  function prunePinnedHosts(validNames: Set<string>) {
    const next = pinnedHosts.value.filter((n) => validNames.has(n));
    if (next.length === pinnedHosts.value.length) return;
    pinnedHosts.value = next;
    persistPinnedHosts();
  }
  function isPinned(name: string): boolean {
    return pinnedHosts.value.includes(name);
  }
  function pinHost(name: string) {
    const n = name.trim();
    if (!n || pinnedHosts.value.includes(n)) return;
    pinnedHosts.value = [...pinnedHosts.value, n];
    persistPinnedHosts();
  }
  function unpinHost(name: string) {
    const next = pinnedHosts.value.filter((n) => n !== name);
    if (next.length === pinnedHosts.value.length) return;
    pinnedHosts.value = next;
    persistPinnedHosts();
  }
  function togglePinHost(name: string) {
    if (isPinned(name)) unpinHost(name);
    else pinHost(name);
  }
  /** 在置顶列表内重排：将 from 移到 beforeName 之前；beforeName 空则移到末尾 */
  function reorderPinnedHost(from: string, beforeName: string | null) {
    const list = [...pinnedHosts.value];
    const fromIdx = list.indexOf(from);
    if (fromIdx < 0) return;
    list.splice(fromIdx, 1);
    if (!beforeName) {
      list.push(from);
    } else {
      let toIdx = list.indexOf(beforeName);
      if (toIdx < 0) toIdx = list.length;
      list.splice(toIdx, 0, from);
    }
    pinnedHosts.value = list;
    persistPinnedHosts();
  }
  function renamePinnedHost(oldName: string, newName: string) {
    const idx = pinnedHosts.value.indexOf(oldName);
    if (idx < 0) return;
    const next = [...pinnedHosts.value];
    if (next.includes(newName)) {
      next.splice(idx, 1);
    } else {
      next[idx] = newName;
    }
    pinnedHosts.value = next;
    persistPinnedHosts();
  }

  /** 为真时启动后停在离开前的那一页；标签无论哪个选项都会恢复 */
  function startupResumesLastScreen(): boolean {
    return useSettingsStore().startupPage === "resume";
  }

  /**
   * 设置整页覆盖主区，但不改 activeView。
   * 再点设置 / Esc 即回到底下那一页；点主机/分组/全部主机会关掉设置并切过去。
   * 「继续上次」时，离开前若停在设置页，启动后仍盖着。
   * 选「应用首页」时标签照常恢复，但启动落在主机页，不盖设置。
   */
  const settingsOpen = ref(
    startupResumesLastScreen() && readLastScreen()?.settingsOpen === true
  );
  function openSettings() {
    settingsOpen.value = true;
  }
  function closeSettings() {
    settingsOpen.value = false;
  }
  function toggleSettings() {
    settingsOpen.value = !settingsOpen.value;
  }

  /** 工作区：远程为主路径；通知仍可进。选「应用首页」时启动落在远程主机页，标签仍会恢复。 */
  function loadWorkspace(): Workspace {
    if (!startupResumesLastScreen()) return "remote";
    const screen = readLastScreen();
    if (screen) return screen.workspace;
    try {
      const v = localStorage.getItem("1pannel-workspace");
      if (v === "notify") return "notify";
    } catch {
      /* ignore */
    }
    return "remote";
  }
  const workspace = ref<Workspace>(loadWorkspace());
  const termActionName = ref("");
  const termActionN = ref(0);
  let termActionAt = 0;
  let termActionLast = "";
  const pendingTrees = new Map<string, PaneNode>();

  function setWorkspace(w: Workspace) {
    workspace.value = w;
    // 设置整页盖在主区上；切工作区时先关掉，否则仍停在设置页
    settingsOpen.value = false;
    if (w === "terminal") ensureDefaultTerminalPicker();
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
  const visitedLocalSections = ref<LocalSection[]>([localSection.value]);
  function setLocalSection(v: LocalSection) {
    localSection.value = v;
    if (!visitedLocalSections.value.includes(v)) {
      visitedLocalSections.value = [...visitedLocalSections.value, v];
    }
    try {
      localStorage.setItem("1pannel-local-section", v);
    } catch {
      /* ignore */
    }
  }

  /** 通知页：消息 / 设置（持久化）。旧的五段导航收进「设置」。 */
  function loadNotifySection(): NotifySection {
    try {
      const v = localStorage.getItem("1pannel-notify-section");
      if (v === "messages") return "messages";
      if (
        v === "setup" ||
        v === "hostSubs" ||
        v === "metricSubs" ||
        v === "appSubs" ||
        v === "channels" ||
        v === "content"
      ) {
        return "setup";
      }
    } catch {
      /* ignore */
    }
    return "messages";
  }
  const notifySection = ref<NotifySection>(loadNotifySection());
  const visitedNotifySections = ref<NotifySection[]>([notifySection.value]);
  function setNotifySection(v: NotifySection) {
    notifySection.value = v;
    if (!visitedNotifySections.value.includes(v)) {
      visitedNotifySections.value = [...visitedNotifySections.value, v];
    }
    try {
      localStorage.setItem("1pannel-notify-section", v);
    } catch {
      /* ignore */
    }
  }

  /** 巡检二级栏：页面导航（持久化） */
  function loadInspectSection(): InspectSection {
    try {
      const v = localStorage.getItem("1pannel-inspect-section");
      if (v === "menuCheck") return v;
    } catch {
      /* ignore */
    }
    return "menuCheck";
  }
  const inspectSection = ref<InspectSection>(loadInspectSection());
  const visitedInspectSections = ref<InspectSection[]>([inspectSection.value]);
  function setInspectSection(v: InspectSection) {
    inspectSection.value = v;
    if (!visitedInspectSections.value.includes(v)) {
      visitedInspectSections.value = [...visitedInspectSections.value, v];
    }
    try {
      localStorage.setItem("1pannel-inspect-section", v);
    } catch {
      /* ignore */
    }
  }

  /**
   * 系统通知点击后定位到某条告警（后续消息页消费；可先写后读）。
   * 与 alertHistory.focusEventId 用途相近，此处挂在 app 上方便跨工作区跳转。
   */
  const focusAlertId = ref("");
  function setFocusAlertId(id: string) {
    focusAlertId.value = (id || "").trim();
  }
  function clearFocusAlertId() {
    focusAlertId.value = "";
  }

  /** 后台常挂的主机会话（按打开顺序） */
  const hostSessions = ref<Record<string, HostSession>>({});
  const runningOrder = ref<string[]>([]);
  /** 工作区级会话条：跨主机的终端/信息/SFTP/监控标签 */
  const workspaceSessions = ref<WorkspaceSession[]>([]);
  const activeSessionId = ref<string | null>(null);
  /** 全部 SSH 会话。与主机管理标签分开，关主机页不会拆掉这里。 */
  const terminalDesks = ref<TerminalDesk[]>([]);
  const activeTerminalId = ref("");
  const lastDeskByHost = new Map<string, string>();
  const terminalFocusHost = ref("");
  const terminalSplitSeq = ref(0);
  const terminalSessionCount = computed(() => {
    const map: Record<string, number> = {};
    for (const d of terminalDesks.value) {
      const names = new Set<string>([d.host]);
      for (const h of deskHosts.get(d.id) || []) names.add(h);
      for (const h of names) {
        if (!h) continue;
        map[h] = (map[h] || 0) + 1;
      }
    }
    return map;
  });
  /** 每个终端会话当前树里的主机，用来判断关主机时会不会拆掉工作台 */
  const deskHosts = new Map<string, string[]>();
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
      // 清理已不存在的主机会话 / 置顶
      const names = new Set((h || []).map((x) => x.name));
      for (const n of Object.keys(hostSessions.value)) {
        if (!names.has(n)) stopHost(n);
      }
      prunePinnedHosts(names);
      const keptSessions: WorkspaceSession[] = [];
      let droppedSession = false;
      for (const s of workspaceSessions.value) {
        if (names.has(s.host)) {
          keptSessions.push(s);
          continue;
        }
        droppedSession = true;
      }
      if (droppedSession) {
        workspaceSessions.value = keptSessions;
      }
      const keptDesks: TerminalDesk[] = [];
      for (const d of terminalDesks.value) {
        if (deskStillValid(d, names)) {
          keptDesks.push(d);
          continue;
        }
        forgetWorkspaceLayout(d.id);
        deskHosts.delete(d.id);
      }
      if (keptDesks.length !== terminalDesks.value.length) {
        terminalDesks.value = keptDesks;
        if (!keptDesks.some((d) => d.id === activeTerminalId.value)) {
          activeTerminalId.value = keptDesks[keptDesks.length - 1]?.id || "";
        }
      }
      restoreStartupScreen(names);
      // 等这次恢复触发的写入先被丢掉，再开始记画面。否则「落在首页」会把上次定位覆盖掉。
      void nextTick(() => {
        screenReady = true;
      });
      if (activeSessionId.value) {
        const still = workspaceSessions.value.some((s) => s.id === activeSessionId.value);
        if (!still) {
          activeSessionId.value = null;
          activeView.value = null;
        }
      }
      ensureSelectedGroup();
    } finally {
      loading.value = false;
    }
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
    if (!hostSessions.value[name]) {
      dropHostWorkspace(name);
      return;
    }
    const next = { ...hostSessions.value };
    delete next[name];
    hostSessions.value = next;
    runningOrder.value = runningOrder.value.filter((n) => n !== name);
    dropHostWorkspace(name);
  }

  /** 只拿掉这台主机的管理页。终端会话留在终端模块。 */
  function dropHostWorkspace(name: string) {
    const dropped = workspaceSessions.value.filter((s) => s.host === name);
    if (dropped.length === 0) {
      if (activeView.value?.kind === "host" && activeView.value.id === name) {
        const fallbackSess = workspaceSessions.value[workspaceSessions.value.length - 1];
        if (fallbackSess) activateWorkspaceSession(fallbackSess.id);
        else {
          activeSessionId.value = null;
          activeView.value = null;
        }
      }
      return;
    }
    const dropIds = new Set(dropped.map((s) => s.id));
    workspaceSessions.value = workspaceSessions.value.filter((s) => !dropIds.has(s.id));
    if (activeSessionId.value && dropIds.has(activeSessionId.value)) {
      const fallbackSess = workspaceSessions.value[workspaceSessions.value.length - 1];
      if (fallbackSess) {
        activateWorkspaceSession(fallbackSess.id);
      } else {
        activeSessionId.value = null;
        activeView.value = null;
      }
    } else if (activeView.value?.kind === "host" && activeView.value.id === name) {
      activeView.value = null;
    }
  }

  /** 断开后端连接（终端会话 + 连接池）并清理前端会话。仅供用户主动关闭使用。 */
  function disconnectAndStop(name: string) {
    const had = !!hostSessions.value[name] || !!hostWorkspaceOf(name);
    if (!had) return;
    const keepPty = hostHasTerminal(name);
    stopHost(name);
    if (keepPty) return;
    void api.disconnectHost(name).catch((err) => {
      ElMessage.error(`断开连接失败: ${formatErr(err)}`);
    });
  }

  /**
   * 关闭主机标签：直接断开该主机全部连接
   * （终端会话独立连接 + 连接池连接），再清理前端会话状态。
   * 返回 true 表示已断开；会话不存在返回 false。
   */
  async function closeHostTab(name: string): Promise<boolean> {
    if (!hostSessions.value[name]) return false;
    disconnectAndStop(name);
    return true;
  }

  const terminalReconnectFns = new Map<string, () => void>();

  function registerTerminalReconnect(id: string, fn: (() => void) | null) {
    if (!id) return;
    if (!fn) {
      terminalReconnectFns.delete(id);
      return;
    }
    terminalReconnectFns.set(id, fn);
  }

  function reconnectWorkspaceTerminals(id: string) {
    const fn = terminalReconnectFns.get(id);
    if (fn) fn();
  }

  /**
   * 回「全部主机」首页并定位到某分组区块。
   * 滚动/高亮由 AllHostsOverviewView 挂载时注册的回调实现；
   * 回调未注册（首页未挂载）时只回首页不滚动。
   */
  let homeGroupLocator: ((groupId: string) => void) | null = null;

  function registerHomeGroupLocator(fn: ((groupId: string) => void) | null) {
    homeGroupLocator = fn;
  }

  function locateGroupOnHome(groupId: string) {
    const gid = (groupId || "").trim();
    if (!gid) return;
    selectGroup(gid);
    goHome();
  }

  const SELECTED_GROUP_KEY = "1pannel-selected-group";
  function loadSelectedGroup(): string {
    try {
      return localStorage.getItem(SELECTED_GROUP_KEY) || "";
    } catch {
      return "";
    }
  }

  /** 当前选中的分组；空串时 refresh 后会落到第一组 */
  const homeSelectedGroupId = ref(loadSelectedGroup());

  function persistSelectedGroup(id: string) {
    try {
      localStorage.setItem(SELECTED_GROUP_KEY, id);
    } catch {
      /* ignore */
    }
  }

  function selectGroup(id: string) {
    const gid = (id || "").trim();
    if (!gid) return;
    homeSelectedGroupId.value = gid;
    persistSelectedGroup(gid);
  }

  /** 清除首页分组选中（切换到其它视图时） */
  function clearHomeSelectedGroup() {
    homeSelectedGroupId.value = "";
    persistSelectedGroup("");
  }

  function ensureSelectedGroup() {
    const nodes = groupNodes.value;
    if (!nodes.length) return;
    const ids = new Set(nodes.map((n) => n.group?.id || UNGROUPED_ID));
    if (homeSelectedGroupId.value && ids.has(homeSelectedGroupId.value)) return;
    const first = nodes[0];
    selectGroup(first.group?.id || UNGROUPED_ID);
  }

  const activeSession = computed(() => {
    const id = activeSessionId.value;
    if (!id) return null;
    return workspaceSessions.value.find((s) => s.id === id) || null;
  });

  function hostWorkspaceOf(name: string): WorkspaceSession | null {
    return (
      workspaceSessions.value.find((s) => s.role === "host" && s.host === name) ||
      null
    );
  }

  function patchWorkspace(id: string, patch: Partial<WorkspaceSession>) {
    workspaceSessions.value = workspaceSessions.value.map((s) =>
      s.id === id ? { ...s, ...patch } : s
    );
  }

  function syncActiveViewFromSession(sess: WorkspaceSession | null) {
    if (!sess) {
      activeView.value = null;
      return;
    }
    const hostSess = hostSessions.value[sess.host];
    activeView.value = {
      id: sess.host,
      title: hostSess?.title || sess.title || sess.host,
      subtitle: hostSess?.subtitle,
      kind: "host",
      subTab: kindToSubTab(sess.tool),
    };
  }

  function activateWorkspaceSession(id: string) {
    const sess = workspaceSessions.value.find((s) => s.id === id);
    if (!sess) return;
    settingsOpen.value = false;
    workspace.value = "remote";
    activeSessionId.value = id;
    syncActiveViewFromSession(sess);
    markVisited(sess.host, kindToSubTab(sess.tool));
    touchSavedWorkspaceActive(id);
  }

  function deskOf(id: string): TerminalDesk | null {
    if (!id) return null;
    return terminalDesks.value.find((d) => d.id === id) || null;
  }

  function patchDesk(id: string, patch: Partial<TerminalDesk>) {
    terminalDesks.value = terminalDesks.value.map((d) => (d.id === id ? { ...d, ...patch } : d));
  }

  function deskIncludesHost(desk: TerminalDesk, name: string): boolean {
    if (desk.host === name) return true;
    const list = deskHosts.get(desk.id);
    return !!list && list.includes(name);
  }

  function hostHasTerminal(name: string): boolean {
    return terminalDesks.value.some((d) => deskIncludesHost(d, name));
  }

  function deskStillValid(desk: TerminalDesk, names: Set<string>): boolean {
    if (!desk.host) return true;
    if (names.has(desk.host)) return true;
    const list = deskHosts.get(desk.id) || [];
    return list.some((h) => names.has(h));
  }

  function rememberDesk(desk: TerminalDesk) {
    activeTerminalId.value = desk.id;
    if (desk.host && !desk.crossHost) lastDeskByHost.set(desk.host, desk.id);
    const focused = deskHosts.get(desk.id);
    terminalFocusHost.value = (focused && focused[0]) || desk.host;
  }

  function makeTermDesk(host: string): TerminalDesk {
    if (!host) {
      return { id: newTermDeskId("new"), host: "", title: "新建终端", crossHost: false };
    }
    const n = terminalDesks.value.filter((d) => d.host === host && !d.crossHost).length;
    const title = n === 0 ? "终端" : `终端 ${n + 1}`;
    const id = newTermDeskId(host);
    noteDeskHosts(id, [host]);
    return { id, host, title, crossHost: false };
  }

  function noteDeskHosts(id: string, hosts: string[]) {
    const list = hosts.map((h) => h.trim()).filter(Boolean);
    deskHosts.set(id, list);
  }

  function openHostWorkspace(host: string, tool: SessionKind) {
    if (tool === "terminal") {
      connectTerminal(host);
      return;
    }
    const name = (host || "").trim();
    if (!name) return;
    if (!hosts.value.some((h) => h.name === name)) return;
    let sess = hostWorkspaceOf(name);
    if (!sess) {
      if (!ensureSession(name)) return;
      const id = hostWorkspaceId(name);
      workspaceSessions.value = [
        ...workspaceSessions.value,
        {
          id,
          host: name,
          role: "host",
          tool,
          title: name,
        },
      ];
      activateWorkspaceSession(id);
      return;
    }
    if (sess.tool !== tool) patchWorkspace(sess.id, { tool });
    activateWorkspaceSession(sess.id);
  }

  function openWorkspaceSession(host: string, kind: SessionKind) {
    openHostWorkspace(host, kind);
  }

  /** 切到终端模块。已有单主机会话就激活最近一次；没有才新建。 */
  function connectTerminal(host: string) {
    const name = (host || "").trim();
    if (!name) return;
    if (!hosts.value.some((h) => h.name === name)) return;
    settingsOpen.value = false;
    workspace.value = "terminal";
    const singles = terminalDesks.value.filter((d) => !d.crossHost && deskIncludesHost(d, name));
    if (singles.length > 0) {
      const remembered = lastDeskByHost.get(name) || "";
      const hit = singles.find((d) => d.id === remembered) || singles[singles.length - 1];
      rememberDesk(hit);
      return;
    }
    const splits = terminalDesks.value.filter((d) => d.crossHost && deskIncludesHost(d, name));
    if (splits.length > 0) {
      rememberDesk(splits[splits.length - 1]);
      return;
    }
    openAnotherTerminal(name);
  }

  /** 终端模块里一个会话都没有时，自动放一个「新建终端」标签。 */
  function ensureDefaultTerminalPicker() {
    if (terminalDesks.value.length > 0) return;
    const desk = makeTermDesk("");
    terminalDesks.value = [desk];
    rememberDesk(desk);
  }

  /** 每次点「新建终端」都开一个空标签，不复用已有未选主机的页。 */
  function openNewTerminalPicker() {
    const desk = makeTermDesk("");
    terminalDesks.value = [...terminalDesks.value, desk];
    settingsOpen.value = false;
    workspace.value = "terminal";
    rememberDesk(desk);
  }

  function bindTerminalHost(deskId: string, host: string) {
    const name = (host || "").trim();
    const desk = deskOf(deskId);
    if (!desk || !name) return;
    if (!hosts.value.some((h) => h.name === name)) return;
    const n = terminalDesks.value.filter((d) => d.id !== deskId && d.host === name && !d.crossHost).length;
    const title = n === 0 ? "终端" : `终端 ${n + 1}`;
    noteDeskHosts(deskId, [name]);
    patchDesk(deskId, { host: name, title, titleCustom: false });
    rememberDesk({ ...desk, host: name, title, titleCustom: false });
  }

  /** 明确再开一个会话。 */
  function openAnotherTerminal(host: string) {
    const name = (host || "").trim();
    if (!name) return;
    if (!hosts.value.some((h) => h.name === name)) return;
    const desk = makeTermDesk(name);
    terminalDesks.value = [...terminalDesks.value, desk];
    settingsOpen.value = false;
    workspace.value = "terminal";
    rememberDesk(desk);
  }

  function activateTerminalDesk(deskId: string) {
    const desk = deskOf(deskId);
    if (!desk) return;
    settingsOpen.value = false;
    workspace.value = "terminal";
    rememberDesk(desk);
  }

  function focusOrOpenTerminal(name: string) {
    connectTerminal(name);
  }

  function runTermAction(name: string) {
    const action = (name || "").trim();
    if (!action) return;
    const now = Date.now();
    if (action === termActionLast && now - termActionAt < 280) return;
    termActionLast = action;
    termActionAt = now;
    termActionName.value = action;
    termActionN.value += 1;
  }

  function requestTerminalSplit(way: "right" | "down" = "right") {
    if (!activeTerminalId.value) return;
    runTermAction(way === "down" ? "split-down" : "split-right");
  }

  function returnToHost(sub: SubTab = "overview") {
    const host = (terminalFocusHost.value || "").trim();
    if (!host) {
      ElMessage.info("当前没有焦点窗格，无法返回主机");
      return;
    }
    openHostTool(host, sub);
  }

  function consumePendingTree(deskId: string): PaneNode | null {
    const tree = pendingTrees.get(deskId) || null;
    if (tree) pendingTrees.delete(deskId);
    return tree;
  }

  /** 把已有窗格收成新的独立会话。paneId 必须已经停在 termLive 的 park 里。 */
  function openDetachedDesk(host: string, paneId: string) {
    const name = (host || "").trim();
    const leafId = (paneId || "").trim();
    if (!name || !leafId) return;
    if (!hosts.value.some((h) => h.name === name)) return;
    const desk = makeTermDesk(name);
    pendingTrees.set(desk.id, { kind: "leaf", id: leafId, host: name });
    terminalDesks.value = [...terminalDesks.value, desk];
    settingsOpen.value = false;
    workspace.value = "terminal";
    rememberDesk(desk);
  }

  function noteTerminalFocusHost(deskId: string, host: string) {
    if (deskId !== activeTerminalId.value) return;
    const name = (host || "").trim();
    if (!name) return;
    terminalFocusHost.value = name;
  }

  function openHostTool(host: string, sub: SubTab) {
    const name = (host || "").trim();
    if (!name) return;
    if (sub === "terminal") {
      connectTerminal(name);
      return;
    }
    openHostWorkspace(name, subTabToKind(sub));
  }

  /** 启动后只恢复一次。之后 refresh 不再把已关掉的工作区加回来。 */
  let layoutsRestored = false;
  /** 恢复完成前不写「上次画面」，避免用空标签覆盖掉真正离开前的记录 */
  let screenReady = false;
  const restoredLayouts = new Map<string, { tree: PaneNode; focusedId: string }>();
  const layoutSaveTimers = new Map<string, number>();

  function consumeWorkspaceLayout(id: string): { tree: PaneNode; focusedId: string } | null {
    const saved = restoredLayouts.get(id);
    if (!saved) return null;
    restoredLayouts.delete(id);
    return saved;
  }

  function forgetWorkspaceLayout(id: string) {
    const prev = layoutSaveTimers.get(id);
    if (prev) window.clearTimeout(prev);
    layoutSaveTimers.delete(id);
    removeSavedWorkspace(id);
  }

  function writeWorkspaceLayout(id: string, tree: PaneNode, focusedId: string) {
    const owner = deskOf(id);
    if (!owner) {
      removeSavedWorkspace(id);
      return;
    }
    let snap: PaneNode;
    try {
      snap = JSON.parse(JSON.stringify(tree)) as PaneNode;
    } catch {
      return;
    }
    const treeHosts = hostsInTree(snap);
    noteDeskHosts(id, treeHosts);
    if (new Set(treeHosts).size > 1) promoteDeskToBench(id);
    const fresh = deskOf(id) || owner;
    const focus = findLeaf(snap, focusedId) ? focusedId : orderedLeaves(snap)[0] || focusedId;
    upsertSavedWorkspace({
      id,
      title: fresh.title,
      titleCustom: !!fresh.titleCustom,
      host: treeHosts[0] || fresh.host,
      tree: snap,
      focusedId: focus,
    });
  }

  function persistWorkspaceLayout(id: string, tree: PaneNode, focusedId: string) {
    const prev = layoutSaveTimers.get(id);
    if (prev) window.clearTimeout(prev);
    const handle = window.setTimeout(() => {
      layoutSaveTimers.delete(id);
      writeWorkspaceLayout(id, tree, focusedId);
    }, 250);
    layoutSaveTimers.set(id, handle);
  }

  function persistWorkspaceLayoutNow(id: string, tree: PaneNode, focusedId: string) {
    const prev = layoutSaveTimers.get(id);
    if (prev) window.clearTimeout(prev);
    layoutSaveTimers.delete(id);
    writeWorkspaceLayout(id, tree, focusedId);
  }

  function workspaceFromMigrated(raw: MigratedWorkspace): WorkspaceSession {
    const tool = raw.tool === "terminal" ? "info" : raw.tool;
    return {
      id: raw.id,
      host: raw.host,
      role: "host",
      tool,
      title: raw.title || raw.host,
      titleCustom: raw.titleCustom,
    };
  }

  function applyNormalized(screen: NormalizedScreen, names: Set<string>) {
    const saved = loadSavedWorkspaces();
    const layoutById = new Map(saved.items.map((it) => [it.id, it]));
    const hostOut: WorkspaceSession[] = [];
    for (const raw of screen.hostSessions) {
      if (raw.role !== "host") continue;
      if (!names.has(raw.host)) continue;
      if (raw.tool === "terminal") continue;
      const sess = workspaceFromMigrated(raw);
      seedHostSession(sess.host, sess.tool);
      hostOut.push(sess);
    }
    const deskOut: TerminalDesk[] = [];
    for (const raw of screen.desks) {
      const layout = layoutById.get(raw.id);
      const treeHosts = layout ? hostsInTree(layout.tree) : [raw.host];
      const keep = names.has(raw.host) || treeHosts.some((h) => names.has(h));
      if (!keep) {
        removeSavedWorkspace(raw.id);
        continue;
      }
      noteTerminalSeq(raw.id);
      const known = treeHosts.filter((h) => names.has(h));
      noteDeskHosts(raw.id, known.length > 0 ? known : [raw.host]);
      if (layout) {
        restoredLayouts.set(raw.id, { tree: layout.tree, focusedId: layout.focusedId });
      }
      const host = names.has(raw.host) ? raw.host : known[0] || raw.host;
      const crossHost = raw.crossHost || known.length > 1;
      deskOut.push({
        id: raw.id,
        host,
        title: raw.title || (crossHost ? SPLIT_TITLE : "终端"),
        titleCustom: raw.titleCustom,
        crossHost,
      });
      if (!crossHost) lastDeskByHost.set(host, raw.id);
    }
    for (const it of saved.items) {
      if (deskOut.some((d) => d.id === it.id)) continue;
      if (!hostsInTree(it.tree).some((h) => names.has(h))) removeSavedWorkspace(it.id);
    }
    if (hostOut.length > 0) {
      workspaceSessions.value = [...hostOut, ...workspaceSessions.value];
    }
    if (deskOut.length > 0) {
      terminalDesks.value = [...deskOut, ...terminalDesks.value];
    }
    const wantDesk = screen.activeTerminalId;
    if (wantDesk && deskOut.some((d) => d.id === wantDesk)) {
      activeTerminalId.value = wantDesk;
      const hit = deskOut.find((d) => d.id === wantDesk);
      if (hit && !hit.crossHost) lastDeskByHost.set(hit.host, hit.id);
    } else if (!activeTerminalId.value && deskOut.length > 0) {
      activeTerminalId.value = deskOut[deskOut.length - 1].id;
    }
  }

  /** 恢复时记下主机，不走超限挤占：这是用户离开前开着的，不该一启动就被关掉 */
  function seedHostSession(name: string, kind: SessionKind) {
    const sub = kindToSubTab(kind);
    const existing = hostSessions.value[name];
    if (existing) {
      if (existing.visited.includes(sub)) return;
      hostSessions.value = {
        ...hostSessions.value,
        [name]: { ...existing, visited: [...existing.visited, sub], subTab: sub },
      };
      return;
    }
    const host = hosts.value.find((h) => h.name === name);
    if (!host) return;
    const sess: HostSession = {
      name,
      title: name,
      subtitle: `${host.user || "?"}@${host.hostName || "?"}`,
      subTab: sub,
      openedAt: Date.now(),
      visited: [sub],
    };
    hostSessions.value = { ...hostSessions.value, [name]: sess };
    runningOrder.value = [...runningOrder.value, name];
  }

  /**
   * 启动时恢复主机管理页和终端会话。
   * 旧画面里夹在主机上的终端、以及工作台，会抬进终端模块。
   */
  function restoreStartupScreen(names: Set<string>) {
    if (layoutsRestored) return;
    layoutsRestored = true;
    const resume = startupResumesLastScreen();
    let screen = readLastScreen();
    if (!screen) {
      const saved = loadSavedWorkspaces();
      const migrated = migrateWorkspaces([], saved.items, saved.activeId);
      const lifted = liftTerminalDesks(migrated.sessions, migrated.activeSessionId);
      screen = {
        workspace: lifted.openedOnTerminal ? "terminal" : "remote",
        settingsOpen: false,
        activeHostSessionId: lifted.activeHostSessionId,
        activeTerminalId: lifted.activeDeskId,
        hostSessions: lifted.hostSessions,
        desks: lifted.desks,
      };
    }
    applyNormalized(screen, names);
    if (!resume) {
      landOnHostHome();
      return;
    }
    if (screen.workspace === "notify" || screen.workspace === "terminal") {
      workspace.value = screen.workspace;
    } else {
      workspace.value = "remote";
    }
    settingsOpen.value = screen.settingsOpen;
    if (screen.workspace !== "terminal" && screen.activeHostSessionId) {
      const sess = workspaceSessions.value.find((s) => s.id === screen.activeHostSessionId);
      if (sess) {
        activeSessionId.value = sess.id;
        syncActiveViewFromSession(sess);
        markVisited(sess.host, kindToSubTab(sess.tool));
      }
    }
    if (screen.workspace === "terminal") {
      ensureDefaultTerminalPicker();
      const desk = deskOf(activeTerminalId.value);
      if (desk) rememberDesk(desk);
    }
  }

  function landOnHostHome() {
    activeSessionId.value = null;
    activeView.value = null;
    workspace.value = "remote";
    settingsOpen.value = false;
  }

  watch(
    [workspaceSessions, terminalDesks, activeSessionId, activeTerminalId, workspace, settingsOpen],
    () => {
      if (!screenReady) return;
      let w: "remote" | "notify" | "terminal" = "remote";
      if (workspace.value === "notify") w = "notify";
      else if (workspace.value === "terminal") w = "terminal";
      writeLastScreen({
        workspace: w,
        settingsOpen: settingsOpen.value,
        activeHostSessionId: activeSessionId.value || "",
        activeTerminalId: activeTerminalId.value,
        hostSessions: workspaceSessions.value.map((s) => ({
          id: s.id,
          host: s.host,
          role: "host" as const,
          tool: s.tool === "terminal" ? "info" : s.tool,
          title: s.title,
          titleCustom: !!s.titleCustom,
          terminals: [],
          activeTerminalId: "",
        })),
        desks: terminalDesks.value
          .filter((d) => !!d.host)
          .map((d) => ({
          id: d.id,
          host: d.host,
          title: d.title,
          titleCustom: !!d.titleCustom,
          crossHost: d.crossHost,
        })),
      });
    }
  );

  function closeWorkspaceSession(id: string) {
    const sess = workspaceSessions.value.find((s) => s.id === id);
    if (!sess) return;
    workspaceSessions.value = workspaceSessions.value.filter((s) => s.id !== id);
    const name = sess.host;
    if (hostSessions.value[name]) {
      const next = { ...hostSessions.value };
      delete next[name];
      hostSessions.value = next;
      runningOrder.value = runningOrder.value.filter((n) => n !== name);
    }
    if (!hostHasTerminal(name)) {
      void api.disconnectHost(name).catch((err) => {
        ElMessage.error(`断开连接失败: ${formatErr(err)}`);
      });
    }
    if (activeSessionId.value === id) {
      const fallback = workspaceSessions.value[workspaceSessions.value.length - 1];
      if (fallback) activateWorkspaceSession(fallback.id);
      else {
        activeSessionId.value = null;
        activeView.value = null;
      }
    }
  }

  function closeTerminalDesk(deskId: string, quiet = false) {
    const desk = deskOf(deskId);
    if (!desk) return;
    forgetWorkspaceLayout(deskId);
    deskHosts.delete(deskId);
    terminalDesks.value = terminalDesks.value.filter((d) => d.id !== deskId);
    if (lastDeskByHost.get(desk.host) === deskId) lastDeskByHost.delete(desk.host);
    if (activeTerminalId.value === deskId) {
      const next = terminalDesks.value[terminalDesks.value.length - 1];
      if (next) rememberDesk(next);
      else {
        activeTerminalId.value = "";
        terminalFocusHost.value = "";
      }
    }
    if (!quiet) ElMessage.success("已关闭这个终端会话，没有断开主机");
    if (workspace.value === "terminal" && !settingsOpen.value) {
      ensureDefaultTerminalPicker();
    }
  }

  function closeDesksOfHost(name: string) {
    const ids = terminalDesks.value.filter((d) => deskIncludesHost(d, name)).map((d) => d.id);
    for (const id of ids) closeTerminalDesk(id, true);
  }

  function promoteDeskToBench(deskId: string) {
    const desk = deskOf(deskId);
    if (!desk || desk.crossHost) return;
    // 默认标题按现有分屏数编号成「合并 N」；用户改过名则保留
    let title = desk.title;
    if (!desk.titleCustom) {
      const n = terminalDesks.value.filter((d) => d.crossHost && d.id !== deskId).length;
      title = `合并 ${n + 1}`;
    }
    patchDesk(deskId, { crossHost: true, title });
  }

  function demoteDeskIfSingle(deskId: string, host: string) {
    const desk = deskOf(deskId);
    if (!desk || !desk.crossHost || desk.titleCustom) return;
    const name = (host || "").trim() || desk.host;
    patchDesk(deskId, { crossHost: false, host: name, title: "终端" });
  }

  function releaseAdoptedSource(id: string) {
    if (!deskOf(id)) return;
    closeTerminalDesk(id, true);
  }

  const deskMergeN = ref(0);
  /** 本批合并来自多选「合并打开终端」：TerminalView 并完每台后按网格重排窗格 */
  const deskMergeAutoLayout = ref(false);
  type DeskMergeJob = { sourceId: string; host: string; targetId: string };
  const deskMerge = ref<DeskMergeJob | null>(null);
  const deskMergeQueue = ref<DeskMergeJob[]>([]);

  /**
   * 入队多个终端合并任务，但始终只把队首任务暴露给 TerminalView。
   * TerminalView 完成真实窗格接管后调用 clearDeskMerge，才会推进下一项。
   */
  function queueTerminalDeskMerges(jobs: DeskMergeJob[]) {
    const first = jobs[0];
    if (!first) return;
    const target = deskOf(first.targetId);
    if (!target?.host) return;

    const pending = [...(deskMerge.value ? [deskMerge.value] : []), ...deskMergeQueue.value];
    if (pending[0] && pending[0].targetId !== first.targetId) return;
    const seen = new Set(pending.map((job) => job.sourceId));
    const next = jobs.filter((job) => {
      if (!job.sourceId || !job.host || job.sourceId === job.targetId || seen.has(job.sourceId)) {
        return false;
      }
      const source = deskOf(job.sourceId);
      if (!source || !source.host || job.targetId !== first.targetId) return false;
      seen.add(job.sourceId);
      return true;
    });
    if (next.length === 0) return;

    // 一次排进多个合并任务（多选「合并打开终端」）时，收尾把窗格重排成网格
    if (next.length > 1) deskMergeAutoLayout.value = true;
    settingsOpen.value = false;
    workspace.value = "terminal";
    rememberDesk(target);
    if (deskMerge.value) {
      deskMergeQueue.value = [...deskMergeQueue.value, ...next];
      return;
    }
    const [current, ...rest] = next;
    deskMerge.value = current || null;
    deskMergeQueue.value = rest;
    deskMergeN.value += 1;
  }

  /** 把 source 会话拖进 target，合成一个分屏工作区。 */
  function mergeTerminalDesk(sourceId: string, targetId: string, host: string) {
    if (!sourceId || !targetId || sourceId === targetId) return;
    const src = deskOf(sourceId);
    const dst = deskOf(targetId);
    if (!src || !dst || !dst.host) return;
    const name = (host || src.host || "").trim();
    if (!name) return;
    queueTerminalDeskMerges([{ sourceId, host: name, targetId }]);
  }

  function clearDeskMerge() {
    const [next, ...rest] = deskMergeQueue.value;
    deskMergeQueue.value = rest;
    deskMerge.value = next || null;
    if (next) deskMergeN.value += 1;
    else deskMergeAutoLayout.value = false;
  }

  function isTerminalDeskVisible(deskId: string): boolean {
    if (settingsOpen.value || workspace.value !== "terminal") return false;
    return activeTerminalId.value === deskId;
  }

  function setTerminalDeskTitle(id: string, title: string, custom = false) {
    const desk = deskOf(id);
    if (!desk) return;
    const next = (title || "").trim();
    if (!next) return;
    const titleCustom = custom || !!desk.titleCustom;
    patchDesk(id, { title: next, titleCustom });
    patchSavedWorkspaceTitle(id, next, titleCustom);
  }

  /** 关掉这台主机的全部终端并断开 SSH。主机管理页留着。 */
  async function disconnectHostLink(name: string) {
    const host = (name || "").trim();
    if (!host) return;
    closeDesksOfHost(host);
    try {
      await api.disconnectHost(host);
    } catch (err) {
      ElMessage.error(`断开连接失败: ${formatErr(err)}`);
      return;
    }
    ElMessage.success(`已断开 ${host}`);
  }

  /** 改标签名。custom 为真表示用户手动改的，之后不再自动覆盖。 */
  function setWorkspaceSessionTitle(id: string, title: string, custom = false) {
    const next = (title || "").trim();
    if (!next) return;
    if (deskOf(id)) {
      setTerminalDeskTitle(id, next, custom);
      return;
    }
    const sess = workspaceSessions.value.find((s) => s.id === id);
    if (!sess) return;
    const titleCustom = custom || !!sess.titleCustom;
    if (sess.title === next && titleCustom === !!sess.titleCustom) return;
    patchWorkspace(id, { title: next, titleCustom });
  }

  /** 从界面拿掉会话，但不断开主机。拖进另一个窗格时用。 */
  function releaseWorkspaceSession(id: string) {
    if (deskOf(id)) {
      closeTerminalDesk(id, true);
      return;
    }
    const sess = workspaceSessions.value.find((s) => s.id === id);
    if (!sess) return;
    workspaceSessions.value = workspaceSessions.value.filter((s) => s.id !== sess.id);
    if (activeSessionId.value !== sess.id) return;
    const fallback = workspaceSessions.value[workspaceSessions.value.length - 1];
    if (fallback) {
      activateWorkspaceSession(fallback.id);
      return;
    }
    activeSessionId.value = null;
    activeView.value = null;
  }

  function reorderWorkspaceSession(fromIndex: number, toIndex: number) {
    const list = [...workspaceSessions.value];
    if (
      fromIndex < 0 ||
      toIndex < 0 ||
      fromIndex >= list.length ||
      toIndex >= list.length ||
      fromIndex === toIndex
    ) {
      return;
    }
    const [item] = list.splice(fromIndex, 1);
    list.splice(toIndex, 0, item);
    workspaceSessions.value = list;
  }

  function openHostTab(name: string, subTab?: SubTab) {
    if (subTab) {
      openHostWorkspace(name, subTabToKind(subTab));
      return;
    }
    focusHost(name);
  }

  /** 拖到左侧主机页区域时只创建会话，不切走当前页面。 */
  function openHostTabInBackground(name: string, subTab: SubTab = "overview") {
    const host = (name || "").trim();
    if (!host || !hosts.value.some((h) => h.name === host)) return;
    const tool = subTabToKind(subTab);
    const existing = hostWorkspaceOf(host);
    if (existing) return;
    if (!ensureSession(host)) return;
    workspaceSessions.value = [
      ...workspaceSessions.value,
      { id: hostWorkspaceId(host), host, role: "host", tool, title: host },
    ];
  }

  /** 点主机：已有管理页则回到该页，否则打开概览。不新建终端。 */
  function focusHost(name: string) {
    const host = (name || "").trim();
    if (!host) return;
    const mine = hostWorkspaceOf(host);
    if (!mine) {
      openHostWorkspace(host, "info");
      return;
    }
    if (
      activeSession.value?.id === mine.id &&
      !settingsOpen.value &&
      workspace.value === "remote"
    ) {
      return;
    }
    activateWorkspaceSession(mine.id);
  }

  function openGroupTab(id: string, _title?: string) {
    const gid = (id || "").trim();
    if (!gid) return;
    const title = (_title || groupNameOf(gid) || gid).trim();
    settingsOpen.value = false;
    workspace.value = "remote";
    activeSessionId.value = null;
    activeView.value = {
      id: gid,
      title,
      kind: "group",
      subTab: "overview",
    };
    selectGroup(gid);
    if (!visitedGroupIds.value.includes(gid)) {
      visitedGroupIds.value = [...visitedGroupIds.value, gid];
    }
  }

  /** 关闭分组标签：从常驻列表移除；若正看该分组则回首页 */
  function closeGroupTab(id: string) {
    const gid = (id || "").trim();
    if (!gid) return;
    if (!visitedGroupIds.value.includes(gid)) return;
    visitedGroupIds.value = visitedGroupIds.value.filter((x) => x !== gid);
    if (activeView.value?.kind === "group" && activeView.value.id === gid) {
      goHome();
    }
  }

  /** 调整已打开主机标签顺序 */
  function reorderRunningHost(fromIndex: number, toIndex: number) {
    const list = [...runningOrder.value];
    if (
      fromIndex < 0 ||
      toIndex < 0 ||
      fromIndex >= list.length ||
      toIndex >= list.length ||
      fromIndex === toIndex
    ) {
      return;
    }
    const [item] = list.splice(fromIndex, 1);
    list.splice(toIndex, 0, item);
    runningOrder.value = list;
  }

  /** 调整已访问分组标签顺序 */
  function reorderVisitedGroup(fromIndex: number, toIndex: number) {
    const list = [...visitedGroupIds.value];
    if (
      fromIndex < 0 ||
      toIndex < 0 ||
      fromIndex >= list.length ||
      toIndex >= list.length ||
      fromIndex === toIndex
    ) {
      return;
    }
    const [item] = list.splice(fromIndex, 1);
    list.splice(toIndex, 0, item);
    visitedGroupIds.value = list;
  }

  /** 分组显示名（常驻分组页的 group-name 派生源，改名后自动更新） */
  function groupNameOf(id: string): string {
    if (id === UNGROUPED_ID) return "未分组";
    return groupList.value.find((g) => g.id === id)?.name || id;
  }

  /** 主机所属分组显示名；未分到任何组时为「未分组」 */
  function groupNameOfHost(name: string): string {
    for (const g of groupList.value) {
      if ((g.hosts || []).includes(name)) return g.name || "未分组";
    }
    return "未分组";
  }

  /** 回到当前分组的主机列表（已打开的会话仍保活） */
  function goHome() {
    settingsOpen.value = false;
    workspace.value = "remote";
    activeSessionId.value = null;
    activeView.value = null;
  }

  function markVisited(name: string, sub: SubTab) {
    const sess = hostSessions.value[name];
    if (!sess) return;
    const visited = sess.visited.includes(sub)
      ? sess.visited
      : [...sess.visited, sub];
    hostSessions.value = {
      ...hostSessions.value,
      [name]: { ...sess, subTab: sub, visited },
    };
  }

  function setSubTab(tabId: string, sub: SubTab) {
    const fromArg = (tabId || "").trim();
    const argIsHost = !!fromArg && hosts.value.some((h) => h.name === fromArg);
    const name = argIsHost
      ? fromArg
      : activeView.value?.kind === "host"
        ? activeView.value.id
        : fromArg;
    if (!name) return;
    const t0 = performance.now();
    const tool = sub;
    openHostWorkspace(name, subTabToKind(sub));
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        noteSwitch(tool, performance.now() - t0);
      });
    });
  }

  /** 某主机的某子页当前是否正被查看 */
  function isHostSubActive(host: string, sub: SubTab): boolean {
    return isSessionKindVisible(host, subTabToKind(sub));
  }

  function isSessionKindVisible(host: string, kind: SessionKind): boolean {
    if (settingsOpen.value || workspace.value !== "remote") return false;
    const id = activeSessionId.value;
    if (!id) return false;
    const s = workspaceSessions.value.find((x) => x.id === id);
    return !!s && s.role === "host" && s.host === host && s.tool === kind;
  }

  function isLocalSectionActive(section: LocalSection): boolean {
    return (
      !settingsOpen.value &&
      workspace.value === "local" &&
      localSection.value === section
    );
  }

  function isNotifySectionActive(section: NotifySection): boolean {
    return (
      !settingsOpen.value &&
      workspace.value === "notify" &&
      notifySection.value === section
    );
  }

  function isInspectSectionActive(section: InspectSection): boolean {
    return (
      !settingsOpen.value &&
      workspace.value === "inspect" &&
      inspectSection.value === section
    );
  }

  function isHomeActive(): boolean {
    return (
      !settingsOpen.value &&
      workspace.value === "remote" &&
      !activeSessionId.value
    );
  }

  /** 某主机会话当前是否可见 */
  function isHostVisible(host: string): boolean {
    if (settingsOpen.value) return false;
    if (workspace.value === "terminal") {
      const desk = deskOf(activeTerminalId.value);
      if (!desk) return false;
      return deskIncludesHost(desk, host);
    }
    if (workspace.value !== "remote") return false;
    const id = activeSessionId.value;
    if (!id) return false;
    const s = workspaceSessions.value.find((x) => x.id === id);
    return !!s && s.host === host;
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
  async function runInTerminal(cmd: string, hostName?: string) {
    const fromView = activeView.value?.kind === "host" ? activeView.value.id : "";
    const host = (hostName || "").trim() || fromView;
    if (!host) return;
    focusOrOpenTerminal(host);
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
    const siblings = groupList.value.filter(
      (g) => (g.parentId || "").trim() === pid
    );
    const nextOrder =
      siblings.reduce(
        (max, g) => Math.max(max, Number.isFinite(g.order) ? g.order : -1),
        -1
      ) + 1;
    await api.upsertGroup({
      id,
      name,
      parentId: pid || undefined,
      order: nextOrder,
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

  /** 分组拖拽排序：按给定同级顺序重排 order 并刷新 */
  async function reorderGroups(parentId: string, orderedIds: string[]) {
    await api.reorderGroups(parentId, orderedIds);
    await refresh();
  }

  /** 分组内主机拖拽排序：先改本地顺序，失败再回滚 */
  async function reorderGroupHosts(groupId: string, orderedNames: string[]) {
    const list = groupList.value;
    const idx = list.findIndex((g) => g.id === groupId);
    if (idx < 0) return;
    const prev = list[idx].hosts ? [...list[idx].hosts] : [];
    const nextList = list.slice();
    nextList[idx] = { ...list[idx], hosts: [...orderedNames] };
    groupList.value = nextList;
    try {
      await api.reorderGroupHosts(groupId, orderedNames);
    } catch (err) {
      const rollback = groupList.value.slice();
      const i = rollback.findIndex((g) => g.id === groupId);
      if (i >= 0) {
        rollback[i] = { ...rollback[i], hosts: prev };
        groupList.value = rollback;
      }
      throw err;
    }
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
    renamePinnedHost(oldName, next);

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
      const idMap = new Map<string, string>();
      workspaceSessions.value = workspaceSessions.value.map((s) => {
        if (s.host !== oldName) return s;
        const newId = hostWorkspaceId(next);
        idMap.set(s.id, newId);
        return {
          ...s,
          id: newId,
          host: next,
          title: s.titleCustom ? s.title.replace(oldName, next) : next,
        };
      });
      terminalDesks.value = terminalDesks.value.map((d) => {
        const listed = deskHosts.get(d.id) || [];
        const touches = d.host === oldName || listed.includes(oldName);
        if (!touches) return d;
        const newDesk = d.id
          .replace(`term:${oldName}:`, `term:${next}:`)
          .replace(`terminal:${oldName}:`, `terminal:${next}:`);
        idMap.set(d.id, newDesk);
        const movedHosts = listed.map((h) => (h === oldName ? next : h));
        deskHosts.delete(d.id);
        deskHosts.set(newDesk, movedHosts.length > 0 ? movedHosts : [next]);
        if (lastDeskByHost.get(oldName) === d.id) {
          lastDeskByHost.delete(oldName);
          lastDeskByHost.set(next, newDesk);
        }
        return {
          ...d,
          id: newDesk,
          host: d.host === oldName ? next : d.host,
          title: d.title.replace(oldName, next),
        };
      });
      if (activeTerminalId.value && idMap.has(activeTerminalId.value)) {
        activeTerminalId.value = idMap.get(activeTerminalId.value) || activeTerminalId.value;
      }
      if (activeSessionId.value && idMap.has(activeSessionId.value)) {
        activeSessionId.value = idMap.get(activeSessionId.value) || null;
      }
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
    await api.updateHost({ ...input, note: input.note ?? "" });
    closeDesksOfHost(input.name);
    void api.disconnectHost(input.name).catch(() => {});
    stopHost(input.name);
    await refresh();
  }

  /** 从 ~/.ssh/config 删除主机 */
  async function deleteHost(name: string) {
    await api.deleteHost(name);
    closeDesksOfHost(name);
    void api.disconnectHost(name).catch(() => {});
    stopHost(name);
    unpinHost(name);
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
    terminalSessionCount,
    terminalDesks,
    activeTerminalId,
    terminalFocusHost,
    termActionName,
    termActionN,
    terminalSplitSeq,
    workspaceSessions,
    activeSessionId,
    activeSession,
    runningHosts,
    runningOrder,
    visitedGroupIds,
    sidebarOpen,
    setSidebarOpen,
    toggleSidebar,
    homeSearchFocusSeq,
    openHomeHostSearch,
    pinnedHosts,
    isPinned,
    pinHost,
    unpinHost,
    togglePinHost,
    reorderPinnedHost,
    settingsOpen,
    openSettings,
    closeSettings,
    toggleSettings,
    workspace,
    setWorkspace,
    localSection,
    setLocalSection,
    visitedLocalSections,
    notifySection,
    setNotifySection,
    visitedNotifySections,
    inspectSection,
    setInspectSection,
    visitedInspectSections,
    focusAlertId,
    setFocusAlertId,
    clearFocusAlertId,
    refresh,
    rememberOsRelease,
    refreshHostIcon,
    refreshAllHostIcons,
    isRunning,
    openHostTab,
    openHostTabInBackground,
    focusHost,
    openGroupTab,
    openAnotherTerminal,
    openNewTerminalPicker,
    bindTerminalHost,
    connectTerminal,
    disconnectHostLink,
    requestTerminalSplit,
    runTermAction,
    returnToHost,
    consumePendingTree,
    openDetachedDesk,
    noteTerminalFocusHost,
    openHostTool,
    hostHasTerminal,
    hostWorkspaceOf,
    closeTerminalDesk,
    activateTerminalDesk,
    promoteDeskToBench,
    demoteDeskIfSingle,
    releaseAdoptedSource,
    mergeTerminalDesk,
    queueTerminalDeskMerges,
    deskMerge,
    deskMergeN,
    deskMergeAutoLayout,
    clearDeskMerge,
    isTerminalDeskVisible,
    noteDeskHosts,
    closeWorkspaceSession,
    persistWorkspaceLayout,
    persistWorkspaceLayoutNow,
    consumeWorkspaceLayout,
    setWorkspaceSessionTitle,
    releaseWorkspaceSession,
    activateWorkspaceSession,
    reorderWorkspaceSession,
    selectGroup,
    registerTerminalReconnect,
    reconnectWorkspaceTerminals,
    registerHomeGroupLocator,
    locateGroupOnHome,
    closeGroupTab,
    reorderRunningHost,
    reorderVisitedGroup,
    groupNameOf,
    groupNameOfHost,
    goHome,
    setSubTab,
    isHostSubActive,
    isLocalSectionActive,
    isNotifySectionActive,
    isInspectSectionActive,
    isHomeActive,
    isHostVisible,
    isGroupVisible,
    stopHost,
    closeHostTab,
    sendTerminalCmd,
    clearTerminalCmd,
    runInTerminal,
    createGroup,
    renameGroup,
    setBoardTitle,
    moveGroup,
    reorderGroups,
    reorderGroupHosts,
    homeSelectedGroupId,
    clearHomeSelectedGroup,
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
