/**
 * 文件管理页的目录导航逻辑：
 * 当前目录 + 目录列表加载、前进/后退历史、地址栏编辑、家目录解析。
 * 一次只打开一个路径，从 FilesView.vue 抽出，行为保持不变。
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
    backStack.value = [];
    forwardStack.value = [];

    const home = await resolveHomeDir();
    homeDir.value = home;
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
  };
}
