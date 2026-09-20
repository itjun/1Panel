<template>
  <div class="sftp">
    <SftpPane
      side="local"
      title="本机"
      :cwd="localCwd"
      :root-path="localRoot"
      :entries="localEntries"
      :loading="loadingLocal"
      :error="localErr"
      :can-back="localBack.length > 0"
      :can-forward="localFwd.length > 0"
      :accept-drop="dragFrom === 'remote'"
      :locked="!!pending || asking || busy"
      :can-remove="false"
      :home-path="localHome"
      drop-hint="松手即可下载"
      @navigate="onLocalNavigate"
      @back="localGoBack"
      @forward="localGoForward"
      @refresh="refreshLocal"
      @send="onLocalSend"
      @receive="onLocalReceive"
      @drag-begin="onDragBegin('local', $event)"
      @drag-end="onDragEnd"
    />
    <SftpPane
      side="remote"
      :title="host"
      :cwd="remoteCwd"
      root-path="/"
      :entries="remoteEntries"
      :loading="loadingRemote"
      :error="remoteErr"
      :can-back="remoteBack.length > 0"
      :can-forward="remoteFwd.length > 0"
      :accept-drop="dragFrom === 'local'"
      :locked="!!pending || asking || busy"
      :can-remove="true"
      :home-path="remoteHome"
      drop-hint="松手即可上传"
      @navigate="onRemoteNavigate"
      @back="remoteGoBack"
      @forward="remoteGoForward"
      @refresh="refreshRemote"
      @send="onRemoteSend"
      @receive="onRemoteReceive"
      @drag-begin="onDragBegin('remote', $event)"
      @drag-end="onDragEnd"
      @remove="askDelete"
      @hover-target="remoteHover = $event"
    />

    <div v-if="xfer" class="xfer">{{ xfer }}</div>

    <div v-if="pending" class="confirm-mask" @mousedown.self="closeDelete">
      <div class="confirm" role="dialog" aria-modal="true">
        <header>
          <span>{{ confirmTitle }}</span>
          <button type="button" class="x" @click="closeDelete">×</button>
        </header>
        <div class="body">
          <p v-for="item in pendingPreview" :key="item.path">{{ item.name }}</p>
          <p v-if="pendingMore" class="more">还有 {{ pendingMore }} 项</p>
          <p class="note">{{ confirmNote }}</p>
        </div>
        <footer class="choices">
          <button v-if="confirmArmed" type="button" class="text" :disabled="deleting" @click="confirmArmed = false">
            取消
          </button>
          <button type="button" class="danger" :disabled="deleting" @click="confirmDelete">
            {{ deleting ? "正在删除…" : confirmArmed ? "确认删除" : "删除" }}
          </button>
        </footer>
      </div>
    </div>

    <div v-if="conflict" class="confirm-mask" @mousedown.self="pickConflict('cancel')">
      <div class="confirm" role="dialog" aria-modal="true">
        <header>
          <span>目标里已有同名文件</span>
          <button type="button" class="x" @click="pickConflict('cancel')">×</button>
        </header>
        <div class="body">
          <p v-for="name in conflictPreview" :key="name">{{ name }}</p>
          <p v-if="conflictMore" class="more">还有 {{ conflictMore }} 项</p>
          <p class="note">
            覆盖会替换这些文件或文件夹。保留副本会在名字后面加序号，例如 {{ conflictExample }}，这个名字也被占用就继续用 2、3、4。
          </p>
        </div>
        <footer class="choices">
          <button type="button" class="text" @click="pickConflict('cancel')">取消</button>
          <button type="button" class="plain" @click="pickConflict('rename')">保留副本</button>
          <button type="button" class="danger" @click="pickConflict('overwrite')">覆盖</button>
        </footer>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { Events } from "@wailsio/runtime";
import { ElMessage } from "element-plus";
import { api } from "@/api";
import type { monitor } from "@/api";
import { useAppStore } from "@/stores/app";
import { formatErr } from "@/utils/format";
import { registerFileDrop } from "@/utils/fileDrop";
import SftpPane, { type SftpDeleteItem } from "@/views/SftpPane.vue";

const props = defineProps<{ host: string }>();
const app = useAppStore();

const localHome = ref("");
const remoteHome = ref("");
const localCwd = ref("");
const remoteCwd = ref("");
const localEntries = ref<monitor.FileEntry[]>([]);
const remoteEntries = ref<monitor.FileEntry[]>([]);
const localErr = ref("");
const remoteErr = ref("");
const loadingLocal = ref(false);
const loadingRemote = ref(false);
const localBack = ref<string[]>([]);
const localFwd = ref<string[]>([]);
const remoteBack = ref<string[]>([]);
const remoteFwd = ref<string[]>([]);

const dragFrom = ref<"local" | "remote" | null>(null);
const dragPaths = ref<string[]>([]);
const remoteHover = ref("");
const busy = ref(false);
const uploading = ref(false);
const xfer = ref("");

// 仅远程面板可删除；本机文件不允许删除
const pending = ref<{ items: SftpDeleteItem[] } | null>(null);
// 删除的二次确认：第一次点「删除」只进入确认态，再点「确认删除」才真正执行
const confirmArmed = ref(false);
const deleting = ref(false);
const asking = ref(false);

type ConflictChoice = "overwrite" | "rename" | "cancel";
const conflict = ref<{ names: string[]; resolve: (choice: ConflictChoice) => void } | null>(null);

let localSeq = 0;
let remoteSeq = 0;
let offDrop: (() => void) | null = null;
let offProgress: (() => void) | null = null;

const localRoot = computed(() => (localHome.value.startsWith("/") ? "/" : localHome.value));

const confirmTitle = computed(() => {
  const items = pending.value?.items ?? [];
  const lead = confirmArmed.value ? "再次确认：删除" : "确定删除";
  if (items.length > 1) return `${lead}这 ${items.length} 项？`;
  if (items[0]?.isDir) return `${lead}这个文件夹？`;
  return `${lead}这个文件？`;
});

const confirmNote = computed(() => {
  const items = pending.value?.items ?? [];
  if (confirmArmed.value) return "请再次确认：删除后无法恢复。";
  if (items.some((item) => item.isDir)) return "文件夹里的内容会一起删除，且无法恢复。";
  return "删除后无法恢复。";
});

const pendingPreview = computed(() => (pending.value?.items ?? []).slice(0, 6));
const pendingMore = computed(() => Math.max(0, (pending.value?.items.length ?? 0) - 6));
const conflictPreview = computed(() => (conflict.value?.names ?? []).slice(0, 6));
const conflictMore = computed(() => Math.max(0, (conflict.value?.names.length ?? 0) - 6));
const conflictExample = computed(() => numberedName(conflict.value?.names[0] || "文件.pdf", 1));

function normalizeRemote(raw: string): string {
  let s = (raw || "").trim();
  if (!s) return "/";
  if (!s.startsWith("/")) s = "/" + s;
  s = s.replace(/\/{2,}/g, "/");
  if (s.length > 1 && s.endsWith("/")) s = s.slice(0, -1);
  return s;
}

function normalizeLocal(raw: string): string {
  let s = (raw || "").trim();
  if (!s) return localHome.value || "/";
  if (s === "~") return localHome.value || s;
  if (s.startsWith("~/")) return (localHome.value || "") + s.slice(1);
  return s;
}

function pushHistory(back: typeof localBack, fwd: typeof localFwd, from: string, to: string, record: boolean) {
  if (!record || !from || from === to) return;
  back.value = [...back.value, from];
  fwd.value = [];
}

async function loadLocalAt(path: string, record: boolean) {
  const seq = ++localSeq;
  loadingLocal.value = true;
  localErr.value = "";
  const from = localCwd.value;
  try {
    if (!localHome.value) localHome.value = await api.localHomeDir();
    if (seq !== localSeq) return;
    const target = path ? normalizeLocal(path) : localHome.value;
    const list = (await api.listLocalDir(target)) || [];
    if (seq !== localSeq) return;
    localEntries.value = list;
    localCwd.value = target;
    pushHistory(localBack, localFwd, from, target, record);
  } catch (e) {
    if (seq !== localSeq) return;
    localErr.value = formatErr(e);
  } finally {
    if (seq === localSeq) loadingLocal.value = false;
  }
}

async function loadRemoteOnce(path: string, record: boolean, from: string, seq: number) {
  let target = path ? normalizeRemote(path) : "";
  if (!target) {
    target = normalizeRemote(await api.sftpHomeDir(props.host));
    remoteHome.value = target;
  }
  if (seq !== remoteSeq) return;
  const list = (await api.listSftp(props.host, target)) || [];
  if (seq !== remoteSeq) return;
  remoteEntries.value = list;
  remoteCwd.value = target;
  pushHistory(remoteBack, remoteFwd, from, target, record);
}

function remoteConnDead(err: unknown): boolean {
  const s = formatErr(err).toLowerCase();
  return (
    s.includes("eof") ||
    s.includes("closed") ||
    s.includes("reset") ||
    s.includes("broken pipe") ||
    s.includes("会话创建失败") ||
    s.includes("connection lost")
  );
}

async function loadRemoteAt(path: string, record: boolean) {
  if (!app.isHostSubActive(props.host, "files")) return;
  const seq = ++remoteSeq;
  loadingRemote.value = true;
  remoteErr.value = "";
  const from = remoteCwd.value;
  try {
    await loadRemoteOnce(path, record, from, seq);
  } catch (e) {
    if (seq !== remoteSeq) return;
    if (!remoteConnDead(e) || !app.isHostSubActive(props.host, "files")) {
      remoteErr.value = formatErr(e);
      return;
    }
    // 关掉标签时后端会拆连接。第一次请求可能正好撞上旧连接，稍等再连一次。
    await new Promise((r) => window.setTimeout(r, 250));
    if (seq !== remoteSeq || !app.isHostSubActive(props.host, "files")) return;
    try {
      await loadRemoteOnce(path, record, from, seq);
    } catch (e2) {
      if (seq !== remoteSeq) return;
      remoteErr.value = formatErr(e2);
    }
  } finally {
    if (seq === remoteSeq) loadingRemote.value = false;
  }
}

function refreshLocal() {
  void loadLocalAt(localCwd.value, false);
}
function refreshRemote() {
  void loadRemoteAt(remoteCwd.value, false);
}
function onLocalNavigate(path: string) {
  void loadLocalAt(path, true);
}
function onRemoteNavigate(path: string) {
  void loadRemoteAt(path, true);
}

function goBack(back: typeof localBack, fwd: typeof localFwd, cwd: string, load: (p: string) => void) {
  if (!back.value.length) return;
  const prev = back.value[back.value.length - 1];
  back.value = back.value.slice(0, -1);
  if (cwd) fwd.value = [...fwd.value, cwd];
  load(prev);
}
function goForward(back: typeof localBack, fwd: typeof localFwd, cwd: string, load: (p: string) => void) {
  if (!fwd.value.length) return;
  const next = fwd.value[fwd.value.length - 1];
  fwd.value = fwd.value.slice(0, -1);
  if (cwd) back.value = [...back.value, cwd];
  load(next);
}

function localGoBack() {
  goBack(localBack, localFwd, localCwd.value, (p) => void loadLocalAt(p, false));
}
function localGoForward() {
  goForward(localBack, localFwd, localCwd.value, (p) => void loadLocalAt(p, false));
}
function remoteGoBack() {
  goBack(remoteBack, remoteFwd, remoteCwd.value, (p) => void loadRemoteAt(p, false));
}
function remoteGoForward() {
  goForward(remoteBack, remoteFwd, remoteCwd.value, (p) => void loadRemoteAt(p, false));
}

function onDragBegin(side: "local" | "remote", paths: string[]) {
  dragFrom.value = side;
  dragPaths.value = paths;
}
function onDragEnd() {
  dragFrom.value = null;
  dragPaths.value = [];
  remoteHover.value = "";
}

function takeDragPaths(): string[] {
  const paths = dragPaths.value.slice();
  dragFrom.value = null;
  dragPaths.value = [];
  return paths;
}

function onLocalSend(paths: string[]) {
  if (blocked()) return;
  void uploadTo(paths, remoteCwd.value);
}
function onRemoteSend(paths: string[]) {
  if (blocked()) return;
  void downloadTo(paths, localCwd.value);
}
function onLocalReceive(dir: string) {
  if (blocked()) return;
  void downloadTo(takeDragPaths(), dir || localCwd.value);
}
function onRemoteReceive(dir: string) {
  if (blocked()) return;
  void uploadTo(takeDragPaths(), dir || remoteHover.value || remoteCwd.value);
}

function blocked(): boolean {
  return asking.value || busy.value || !!pending.value || !!conflict.value;
}

function basenames(paths: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const p of paths) {
    const name = p.replace(/\\/g, "/").split("/").filter(Boolean).pop() || "";
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out;
}

function numberedName(name: string, n: number): string {
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return `${name} ${n}`;
  return `${name.slice(0, dot)} ${n}${name.slice(dot)}`;
}

function askConflict(names: string[]): Promise<ConflictChoice> {
  return new Promise((resolve) => {
    conflict.value = { names, resolve };
  });
}

function pickConflict(choice: ConflictChoice) {
  const job = conflict.value;
  if (!job) return;
  conflict.value = null;
  job.resolve(choice);
}

async function resolveMode(
  kind: "upload" | "download",
  paths: string[],
  dir: string
): Promise<"overwrite" | "rename" | null> {
  const names = basenames(paths);
  if (!names.length) return "overwrite";
  asking.value = true;
  xfer.value = "正在检查同名文件…";
  try {
    const hits =
      kind === "upload"
        ? await api.sftpExistingNames(props.host, dir, names)
        : await api.localExistingNames(dir, names);
    xfer.value = "";
    if (!hits.length) return "overwrite";
    const choice = await askConflict(hits);
    if (choice === "cancel") return null;
    return choice;
  } catch (e) {
    ElMessage.error(formatErr(e));
    return null;
  } finally {
    asking.value = false;
    if (xfer.value === "正在检查同名文件…") xfer.value = "";
  }
}

async function uploadTo(paths: string[], remoteDir: string) {
  if (!paths.length || !remoteDir || blocked()) return;
  const mode = await resolveMode("upload", paths, remoteDir);
  if (!mode || busy.value) return;
  busy.value = true;
  uploading.value = true;
  xfer.value = paths.length > 1 ? `正在上传 ${paths.length} 项…` : "正在上传…";
  try {
    await api.uploadPathsAs(props.host, paths, remoteDir, mode);
    ElMessage.success("已上传");
    await loadRemoteAt(remoteCwd.value, false);
  } catch (e) {
    ElMessage.error(formatErr(e));
  } finally {
    busy.value = false;
    uploading.value = false;
    xfer.value = "";
  }
}

async function downloadTo(paths: string[], localDir: string) {
  if (!paths.length || !localDir || blocked()) return;
  const mode = await resolveMode("download", paths, localDir);
  if (!mode || busy.value) return;
  busy.value = true;
  xfer.value = paths.length > 1 ? `正在下载 ${paths.length} 项…` : "正在下载…";
  try {
    await api.downloadSftpPathsAs(props.host, paths, localDir, mode);
    ElMessage.success("已下载");
    await loadLocalAt(localCwd.value, false);
  } catch (e) {
    ElMessage.error(formatErr(e));
  } finally {
    busy.value = false;
    xfer.value = "";
  }
}

function askDelete(items: SftpDeleteItem[]) {
  if (!items.length || deleting.value) return;
  confirmArmed.value = false;
  pending.value = { items };
}

function closeDelete() {
  if (deleting.value) return;
  pending.value = null;
  confirmArmed.value = false;
}

async function confirmDelete() {
  const job = pending.value;
  if (!job || deleting.value) return;
  if (!confirmArmed.value) {
    confirmArmed.value = true;
    return;
  }
  deleting.value = true;
  try {
    await api.deleteSftpPaths(props.host, job.items.map((item) => item.path));
    pending.value = null;
    confirmArmed.value = false;
    ElMessage.success("已删除");
    await loadRemoteAt(remoteCwd.value, false);
  } catch (e) {
    ElMessage.error(formatErr(e));
  } finally {
    deleting.value = false;
  }
}

function onOsDrop(paths: string[]) {
  if (!paths?.length || blocked()) return;
  const dir = remoteHover.value || remoteCwd.value;
  remoteHover.value = "";
  void uploadTo(paths, dir);
}

function onWinKey(ev: KeyboardEvent) {
  if (conflict.value) {
    if (ev.key === "Escape") {
      ev.preventDefault();
      pickConflict("cancel");
    }
    return;
  }
  if (!pending.value || deleting.value) return;
  if (ev.key === "Escape") {
    closeDelete();
    return;
  }
  if (ev.key !== "Enter") return;
  const tag = (ev.target as HTMLElement).tagName;
  if (tag === "INPUT" || tag === "TEXTAREA") return;
  ev.preventDefault();
  void confirmDelete();
}

watch(
  () => [props.host, app.isHostSubActive(props.host, "files")] as const,
  ([host, vis], prev) => {
    if (vis) {
      if (!offDrop) offDrop = registerFileDrop(onOsDrop);
    } else {
      offDrop?.();
      offDrop = null;
    }
    if (!vis) return;
    const hostChanged = !prev || prev[0] !== host;
    if (hostChanged) {
      localBack.value = [];
      localFwd.value = [];
      remoteBack.value = [];
      remoteFwd.value = [];
      localCwd.value = "";
      remoteCwd.value = "";
      remoteHome.value = "";
      localEntries.value = [];
      remoteEntries.value = [];
      void loadLocalAt("", false);
      void loadRemoteAt("", false);
      return;
    }
    // 切走再回来：目录、选中和传输状态都还在，不重拉
    if (!localEntries.value.length) void loadLocalAt(localCwd.value, false);
    if (!remoteEntries.value.length) void loadRemoteAt(remoteCwd.value, false);
  },
  { immediate: true }
);

onMounted(() => {
  window.addEventListener("keydown", onWinKey);
  offProgress = Events.On(
    "upload:progress",
    (ev: { data?: { uploaded?: number; total?: number; done?: boolean } }) => {
      if (!uploading.value || !ev?.data || ev.data.done) return;
      const total = ev.data.total || 0;
      if (!total) return;
      const pct = Math.min(100, Math.round(((ev.data.uploaded || 0) / total) * 100));
      xfer.value = `正在上传 ${pct}%`;
    }
  );
});

onBeforeUnmount(() => {
  pickConflict("cancel");
  window.removeEventListener("keydown", onWinKey);
  offDrop?.();
  offProgress?.();
});
</script>

<style scoped lang="scss">
.sftp {
  position: relative;
  display: grid;
  grid-template-columns: 1fr 1fr;
  height: 100%;
  min-height: 0;
  background: #fff;

  > :first-child {
    border-right: 1px solid #e6e8eb;
  }
}

.xfer {
  position: absolute;
  left: 50%;
  bottom: 16px;
  transform: translateX(-50%);
  z-index: 6;
  padding: 8px 14px;
  border-radius: 999px;
  background: #1c1c1e;
  color: #fff;
  font-size: 13px;
  font-weight: 600;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18);
}

.confirm-mask {
  position: absolute;
  inset: 0;
  z-index: 8;
  display: grid;
  place-items: center;
  background: rgba(0, 0, 0, 0.28);
}

.confirm {
  width: min(420px, calc(100% - 48px));
  border-radius: 12px;
  overflow: hidden;
  background: #fff;
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.22);

  header {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 14px 16px;
    background: #2c2c2e;
    color: #fff;
    font-size: 15px;
    font-weight: 650;
  }

  .x {
    margin-left: auto;
    border: 0;
    background: transparent;
    color: #fff;
    font-size: 20px;
    line-height: 1;
    cursor: pointer;
  }

  .body {
    padding: 16px 16px 4px;
    max-height: 180px;
    overflow: auto;

    p {
      margin: 0 0 6px;
      font-size: 14px;
      color: #1c1c1e;
    }
  }

  .more,
  .note {
    color: #8e8e93 !important;
    font-size: 12px !important;
  }

  footer {
    display: flex;
    justify-content: flex-end;
    padding: 8px 16px 16px;
  }

  footer.choices {
    gap: 8px;
  }

  .text,
  .plain {
    border: 0;
    font: inherit;
    cursor: pointer;
  }

  .text {
    background: transparent;
    color: #636366;
    padding: 8px 10px;
  }

  .plain {
    border-radius: 8px;
    padding: 8px 14px;
    background: var(--m3-primary);
    color: #fff;
    font-weight: 650;
  }

  .danger {
    border: 0;
    border-radius: 8px;
    padding: 8px 18px;
    background: #e5484d;
    color: #fff;
    font: inherit;
    font-weight: 650;
    cursor: pointer;

    &:disabled {
      opacity: 0.6;
      cursor: default;
    }
  }
}
</style>
