/**
 * 文件管理页的目录导航逻辑：
 * 当前目录 + 目录列表加载、前进/后退历史、路径 Tab、地址栏编辑、家目录解析。
 * 从 FilesView.vue 抽出，行为保持不变。
 */
import { computed, onMounted, ref, nextTick, watch } from "vue";
import { ElMessage } from "element-plus";
import { api } from "@/api";
import { useAppStore } from "@/stores/app";
import { formatErr } from "@/utils/format";

export interface FileEntry {
  name: string;
  path: string;
  isDir: boolean;
  size: number;
  mode: string;
  modTime: string;
  owner: string;
  group: string;
}

export interface PathTab {
  id: string;
  label: string;
  path: string;
}

export interface PathSeg {
  name: string;
  url: string;
}

export function useFileNavigation(
  host: () => string,
  opts?: { onLoaded?: () => void }
) {
  const app = useAppStore();

  const loading = ref(false);
  const error = ref<string | null>(null);
  const entries = ref<FileEntry[]>([]);
  const cwd = ref("/");

  /** 当前主机用户家目录（默认入口）；解析失败前先占位 /root */
  const homeDir = ref("/root");

  const pathTabs = ref<PathTab[]>([
    { id: "tab-home", label: "home", path: "/root" },
  ]);
  const activeTabId = ref("tab-home");
  let tabSeq = 1;

  const backStack = ref<string[]>([]);
  const forwardStack = ref<string[]>([]);
  const canBack = computed(() => backStack.value.length > 0);
  const canForward = computed(() => forwardStack.value.length > 0);

  const addressEditing = ref(false);
  const addressDraft = ref("");
  const addressInputRef = ref<{ focus: () => void } | null>(null);

  const pathSegments = computed((): PathSeg[] => {
    if (!cwd.value || cwd.value === "/") return [];
    const parts = cwd.value.split("/").filter(Boolean);
    const segs: PathSeg[] = [];
    let acc = "";
    for (const p of parts) {
      acc += "/" + p;
      segs.push({ name: p, url: acc });
    }
    return segs;
  });

  function tabLabelFromPath(p: string): string {
    if (!p || p === "/") return "根目录";
    if (p === homeDir.value) {
      // 家目录：显示末级目录名（如 root / debian）
      const parts = p.split("/").filter(Boolean);
      return parts[parts.length - 1] || "home";
    }
    const parts = p.split("/").filter(Boolean);
    return parts[parts.length - 1] || p;
  }

  function syncTabLabel() {
    const t = pathTabs.value.find((x) => x.id === activeTabId.value);
    if (!t) return;
    t.path = cwd.value;
    t.label = tabLabelFromPath(cwd.value);
  }

  async function load(dir: string, o?: { pushHistory?: boolean }) {
    const pushHistory = o?.pushHistory !== false;
    if (pushHistory && dir !== cwd.value) {
      backStack.value = [...backStack.value, cwd.value];
      forwardStack.value = [];
    }
    loading.value = true;
    error.value = null;
    try {
      const list = (await api.listDir(host(), dir)) as FileEntry[];
      entries.value = list || [];
      cwd.value = dir;
      opts?.onLoaded?.();
      syncTabLabel();
    } catch (e) {
      error.value = formatErr(e);
      entries.value = [];
      ElMessage.error(`加载失败: ${formatErr(e)}`);
    } finally {
      loading.value = false;
    }
  }

  function jump(dir: string) {
    void load(dir);
  }

  function reload() {
    void load(cwd.value, { pushHistory: false });
  }

  function goBack() {
    if (!canBack.value) return;
    const prev = backStack.value[backStack.value.length - 1];
    backStack.value = backStack.value.slice(0, -1);
    forwardStack.value = [cwd.value, ...forwardStack.value];
    void load(prev, { pushHistory: false });
  }

  function goForward() {
    if (!canForward.value) return;
    const next = forwardStack.value[0];
    forwardStack.value = forwardStack.value.slice(1);
    backStack.value = [...backStack.value, cwd.value];
    void load(next, { pushHistory: false });
  }

  function startAddressEdit() {
    addressEditing.value = true;
    addressDraft.value = cwd.value;
    nextTick(() => addressInputRef.value?.focus?.());
  }

  function commitAddress() {
    addressEditing.value = false;
    const p = (addressDraft.value || "/").trim() || "/";
    if (p !== cwd.value) jump(p.startsWith("/") ? p : "/" + p);
  }

  function addTab() {
    if (pathTabs.value.length >= 8) {
      ElMessage.warning("最多 8 个路径标签");
      return;
    }
    const id = `tab-${++tabSeq}`;
    const start = homeDir.value || "/";
    pathTabs.value.push({ id, label: tabLabelFromPath(start), path: start });
    activeTabId.value = id;
    backStack.value = [];
    forwardStack.value = [];
    void load(start, { pushHistory: false });
  }

  function removeTab(name: string | number) {
    const id = String(name);
    if (id === "__add__") return;
    if (pathTabs.value.length <= 1) return;
    const idx = pathTabs.value.findIndex((t) => t.id === id);
    if (idx < 0) return;
    pathTabs.value.splice(idx, 1);
    if (activeTabId.value === id) {
      const next = pathTabs.value[Math.max(0, idx - 1)];
      activeTabId.value = next.id;
      void load(next.path, { pushHistory: false });
    }
  }

  function onTabChange(name: string | number) {
    const id = String(name);
    if (id === "__add__") {
      activeTabId.value = pathTabs.value[0]?.id || "tab-home";
      return;
    }
    const t = pathTabs.value.find((x) => x.id === id);
    if (!t) return;
    backStack.value = [];
    forwardStack.value = [];
    void load(t.path, { pushHistory: false });
  }

  async function resolveHomeDir(): Promise<string> {
    try {
      const h = await api.getHomeDir(host());
      const cleaned = (h || "").trim().replace(/\/+$/, "") || "/root";
      return cleaned.startsWith("/") ? cleaned : `/${cleaned}`;
    } catch {
      // 后端不可用时按侧栏主机 User 猜测
      const found = app.hosts.find((x) => x.name === host());
      const u = (found?.user || "root").trim();
      return u === "root" || !u ? "/root" : `/home/${u}`;
    }
  }

  async function resetHost() {
    tabSeq = 1;
    backStack.value = [];
    forwardStack.value = [];

    const home = await resolveHomeDir();
    homeDir.value = home;
    pathTabs.value = [
      { id: "tab-home", label: tabLabelFromPath(home), path: home },
    ];
    activeTabId.value = "tab-home";
    await load(home, { pushHistory: false });
  }

  watch(host, () => {
    void resetHost();
  });
  onMounted(() => {
    void resetHost();
  });

  return {
    loading,
    error,
    entries,
    cwd,
    homeDir,
    pathTabs,
    activeTabId,
    canBack,
    canForward,
    addressEditing,
    addressDraft,
    addressInputRef,
    pathSegments,
    load,
    jump,
    reload,
    goBack,
    goForward,
    startAddressEdit,
    commitAddress,
    addTab,
    removeTab,
    onTabChange,
  };
}
