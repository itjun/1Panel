<template>
  <div class="term-enl">
  <div
    class="term-page page-panel"
    data-file-drop-target
    :class="{ 'is-dragover': dragOver }"
    @dragenter.prevent="onDragEnter"
    @dragover.prevent
    @dragleave.prevent="onDragLeave"
    @drop.prevent="onDropFallback"
  >
    <!-- 会话标签：与顶部 Primary Tabs 同规格（浅色条 + 蓝下划线） -->
    <div class="term-bar">
      <div class="term-tabs-scroll" role="tablist" aria-label="终端会话">
        <button
          v-for="(t, idx) in sessions"
          :key="t.id"
          type="button"
          role="tab"
          class="term-tab"
          :class="{ 'is-active': t.id === activeId, closed: t.closed }"
          :aria-selected="t.id === activeId"
          @click="activate(t.id)"
        >
          <span class="term-tab__label">会话 {{ idx + 1 }}</span>
          <span v-if="t.reconnecting" class="term-tab__badge is-reconnecting">重连中</span>
          <span v-else-if="t.closed" class="term-tab__badge is-closed">已断开</span>
          <span
            class="term-tab__close"
            title="关闭会话"
            @click.stop="closeSession(t.id)"
          >×</span>
        </button>
        <button
          type="button"
          class="term-tab term-tab--add"
          title="新开终端会话"
          @click="openNew"
        >
          <el-icon :size="16"><Plus /></el-icon>
        </button>
      </div>
      <span class="term-host" :title="host">{{ host }}</span>
    </div>

    <div
      ref="containerRef"
      class="term-body"
      @contextmenu.prevent
    />

    <!-- 拖拽上传遮罩：仅 UI 反馈；路径来自 Wails file:drop（需 data-file-drop-target） -->
    <div class="term-drop-overlay">
      <el-icon class="term-drop-icon"><UploadFilled /></el-icon>
      <div class="term-drop-text">松开以上传到 /tmp</div>
    </div>

    <!-- 上传进度浮层：不遮挡终端操作（pointer-events:none） -->
    <div
      v-if="uploadState.visible"
      class="term-upload-toast"
      :class="{ 'is-done': uploadState.done, 'is-error': uploadState.error }"
    >
      <div v-if="!uploadState.done && !uploadState.error" class="term-upload-bar">
        <div class="term-upload-fill" :style="{ width: pct + '%' }" />
      </div>
      <span class="term-upload-msg">
        <template v-if="uploadState.error">上传失败：{{ uploadState.error }}</template>
        <template v-else-if="uploadState.done">已上传到 /tmp</template>
        <template v-else>{{ pct }}% · {{ uploadState.current || "准备中…" }}</template>
      </span>
    </div>

    <!-- 右键菜单：复制 / 粘贴 -->
    <div
      v-if="ctxMenu"
      class="term-ctx"
      :style="{ left: ctxMenu.x + 'px', top: ctxMenu.y + 'px' }"
      @click.stop
      @contextmenu.prevent
    >
      <button
        type="button"
        class="ctx-item"
        :disabled="!ctxMenu.hasSelection"
        @click="copySelection"
      >
        复制
        <span class="ctx-kbd">⌘C</span>
      </button>
      <button type="button" class="ctx-item" @click="pasteClipboard">
        粘贴
        <span class="ctx-kbd">⌘V</span>
      </button>
    </div>
  </div>
  </div>
</template>

<script setup lang="ts">
/**
 * 终端 Tab。
 * 后端 OpenTerminal / WriteTerminal / ResizeTerminal / CloseTerminal 已就绪；
 * 此处用 xterm.js + Wails EventsOn 接 PTY 输出。
 */
import {
  computed,
  nextTick,
  onActivated,
  onBeforeUnmount,
  onDeactivated,
  onMounted,
  ref,
  shallowRef,
  watch,
} from "vue";
import { Plus, UploadFilled } from "@element-plus/icons-vue";
import { ElMessageBox, ElNotification } from "element-plus";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import "@xterm/xterm/css/xterm.css";
import { Events } from "@wailsio/runtime";
import { api } from "@/api";
import { useAppStore } from "@/stores/app";
import { useSettingsStore } from "@/stores/settings";
import { storeToRefs } from "pinia";
import { formatErr } from "@/utils/format";
import { registerFileDrop } from "@/utils/fileDrop";

const props = defineProps<{ host: string }>();
const app = useAppStore();
const settings = useSettingsStore();
const { pendingTerminalCmd } = storeToRefs(app);
const { terminalFontSize, terminalFontFamily, fontFamily } =
  storeToRefs(settings);

function resolveTermFontFamily(): string {
  const f = terminalFontFamily.value;
  if (!f || f === "inherit") return fontFamily.value;
  return f;
}

// GPU 渲染：优先 WebGL（性能最好），上下文丢失或不支持时回退
// xterm 6 内置的 Canvas 默认渲染器（6.0 起 canvas 即默认，DOM 渲染器已移除）。
// 必须在 term.open() 之后调用。
function loadRenderer(term: XTerm) {
  try {
    const webgl = new WebglAddon();
    webgl.onContextLoss(() => {
      webgl.dispose();
      // 卸载 WebGL addon 后 xterm 自动回到内置 Canvas 渲染器
    });
    term.loadAddon(webgl);
  } catch {
    // WebGL 不可用：保持内置 Canvas 渲染器
  }
}

interface Session {
  id: string;
  sessionID: string;
  eventName: string;
  term: XTerm;
  fit: FitAddon;
  closed: boolean;
  reconnecting: boolean;
  el: HTMLDivElement;
  /** v3 Events.On 返回的退订函数（销毁会话时调用） */
  offData?: () => void;
  offExit?: () => void;
}

interface ReconnectCtl {
  timer: ReturnType<typeof setTimeout> | null;
  attempt: number;
  stopped: boolean;
  /** 防止并发 connect（异常 exit 与定时器重叠） */
  inFlight: boolean;
  /** 网络恢复时立刻踢一脚，不等退避 */
  kick: (() => void) | null;
}

/** 重连退避：每个 Tab 独立，最多尝试 RECONNECT_MAX_ATTEMPTS 次 */
const RECONNECT_BASE_MS = 200;
const RECONNECT_MAX_MS = 2000;
const RECONNECT_MAX_ATTEMPTS = 3;

interface CtxMenu {
  x: number;
  y: number;
  sessionID: string;
  term: XTerm;
  hasSelection: boolean;
}

const containerRef = ref<HTMLDivElement | null>(null);
// shallowRef：避免 Vue 对 XTerm 实例做深度代理
const sessions = shallowRef<Session[]>([]);
const activeId = ref<string | null>(null);
const ctxMenu = ref<CtxMenu | null>(null);
let seq = 0;
let opening = false;
/** 打开新会话前暂存的 pending（避免 open 过程中 store 被清空） */
let pendingCmdLocal: string | null = null;

// ---- 拖拽上传 ----
// 终端拖拽上传固定目标目录：/tmp（通用、权限宽松、适合临时传文件执行）
const TERM_UPLOAD_DIR = "/tmp";

/** Termius 风莫妮卡：纯黑底 + 原版 Monokai ANSI */
const MONOKAI_XTERM_THEME = {
  background: "#000000",
  foreground: "#F8F8F2",
  cursor: "#F8F8F0",
  cursorAccent: "#000000",
  selectionBackground: "#49483E",
  selectionInactiveBackground: "#3E3D32",
  black: "#1B1D1E",
  red: "#F92672",
  green: "#A6E22E",
  yellow: "#FD971F",
  blue: "#66D9EF",
  magenta: "#AE81FF",
  cyan: "#A1EFE4",
  white: "#F8F8F2",
  brightBlack: "#75715E",
  brightRed: "#F92672",
  brightGreen: "#A6E22E",
  brightYellow: "#E6DB74",
  brightBlue: "#66D9EF",
  brightMagenta: "#AE81FF",
  brightCyan: "#A1EFE4",
  brightWhite: "#F9F8F5",
} as const;
const dragOver = ref(false);
// dragCounter：抵消子元素进出导致的 dragenter/dragleave 抖动（同 FilesView 技巧）
let dragCounter = 0;
const uploadState = ref({
  visible: false,
  done: false,
  error: "" as string,
  current: "",
  uploaded: 0,
  total: 0,
});
let uploadToastTimer: ReturnType<typeof setTimeout> | null = null;
// v3 全局事件订阅的退订函数（组件卸载时调用）
let offDrop: (() => void) | null = null;
let offProgress: (() => void) | null = null;
const pct = computed(() => {
  const t = uploadState.value.total;
  if (!t) return 0;
  return Math.min(100, Math.round((uploadState.value.uploaded / t) * 100));
});


function patchSession(id: string, patch: Partial<Session>) {
  sessions.value = sessions.value.map((s) =>
    s.id === id ? { ...s, ...patch } : s
  );
}

// 重连控制：会话 id -> 状态（定时器 / 退避次数 / 是否已停止）
const reconnectMap = new Map<string, ReconnectCtl>();

// 断连通知：2s 窗口内多个会话断开合并成一条，避免刷屏
let pendingDisconnects = 0;
let disconnectNotifyTimer: ReturnType<typeof setTimeout> | null = null;
function notifyDisconnect() {
  pendingDisconnects++;
  if (disconnectNotifyTimer) return;
  disconnectNotifyTimer = setTimeout(() => {
    const n = pendingDisconnects;
    pendingDisconnects = 0;
    disconnectNotifyTimer = null;
    ElNotification({
      title: "终端连接已断开",
      message:
        n > 1 ? `${n} 个会话已断开，正在自动重连…` : "会话已断开，正在自动重连…",
      type: "warning",
      duration: 5000,
    });
  }, 2000);
}

async function openNew() {
  const container = containerRef.value;
  if (!container || opening) return;
  opening = true;

  const id = `term-${Date.now()}-${seq++}`;
  const eventName = `term:${id}`;

  const term = new XTerm({
    cursorBlink: true,
    fontSize: terminalFontSize.value || 14,
    fontFamily: resolveTermFontFamily(),
    rightClickSelectsWord: false,
    // macOS：Option 键作为 Meta（Alt+b/f 跳词等 readline 快捷键可用）
    macOptionIsMeta: true,
    scrollback: 3000,
    theme: { ...MONOKAI_XTERM_THEME },
    allowProposedApi: true,
  });
  const fit = new FitAddon();
  term.loadAddon(fit);
  term.loadAddon(new WebLinksAddon());

  // 必须先挂到真实容器再 fit，否则行列错误 → 远程 PTY 开局乱码
  const el = document.createElement("div");
  el.style.cssText = "width:100%;height:100%;position:absolute;inset:0;";
  container.innerHTML = "";
  container.appendChild(el);
  term.open(el);
  loadRenderer(term);

  await new Promise<void>((r) => requestAnimationFrame(() => r()));
  try {
    fit.fit();
  } catch {
    /* ignore */
  }


  // 先登记 tab，sessionID 待连接成功后填充（重连会更新它）
  const tab: Session = {
    id,
    sessionID: "",
    eventName,
    term,
    fit,
    closed: false,
    reconnecting: false,
    el,
  };
  sessions.value = [...sessions.value, tab];
  activeId.value = id;

  // 当前 sessionID（重连后变化，统一从 sessions 里取）
  const currentSid = () =>
    sessions.value.find((x) => x.id === id)?.sessionID || "";

  // 重连控制（每个 Tab 独立；关 Tab 才 stopped）
  const ctl: ReconnectCtl = {
    timer: null,
    attempt: 0,
    stopped: false,
    inFlight: false,
    kick: null,
  };
  reconnectMap.set(id, ctl);

  function giveUpReconnect() {
    term.write(
      `\r\n\x1b[31m[重连失败：已尝试 ${RECONNECT_MAX_ATTEMPTS} 次，停止自动重连]\x1b[0m\r\n`
    );
    patchSession(id, { closed: true, reconnecting: false });
    ElNotification({
      title: "终端重连失败",
      message: `已尝试 ${RECONNECT_MAX_ATTEMPTS} 次仍无法连接，请检查网络后手动重开终端`,
      type: "error",
      duration: 6000,
    });
  }

  function scheduleReconnect() {
    if (ctl.stopped) return;
    if (ctl.timer) clearTimeout(ctl.timer);
    // 本次失败计入次数；满 3 次不再排下一轮
    ctl.attempt++;
    if (ctl.attempt >= RECONNECT_MAX_ATTEMPTS) {
      giveUpReconnect();
      return;
    }
    term.write(
      `\r\n\x1b[31m[重连失败（${ctl.attempt}/${RECONNECT_MAX_ATTEMPTS}），稍后重试…]\x1b[0m\r\n`
    );
    // 200ms → 400ms → 800ms → … 封顶 2s
    const delay = Math.min(
      RECONNECT_MAX_MS,
      RECONNECT_BASE_MS * Math.pow(2, ctl.attempt - 1)
    );
    patchSession(id, { closed: true, reconnecting: true });
    ctl.timer = setTimeout(() => void connect(false), delay);
  }

  // 连接（首次 + 自动重连复用）：成功填充 sessionID；失败短退避，最多 3 次
  async function connect(first: boolean) {
    if (ctl.stopped || ctl.inFlight) return;
    ctl.inFlight = true;
    if (ctl.timer) {
      clearTimeout(ctl.timer);
      ctl.timer = null;
    }
    const c = term.cols || 80;
    const r = term.rows || 24;
    try {
      // 数据通道：独立 SSH 连接 + Wails 事件推送
      const sid = await api.openTerminal(props.host, eventName, c, r);
      if (ctl.stopped) {
        if (sid) api.closeTerminal(sid).catch(() => {});
        return;
      }
      patchSession(id, { sessionID: sid, closed: false, reconnecting: false });
      ctl.attempt = 0;
      // 连接后 fit + resize 一次，确保 PTY 尺寸正确
      try {
        fit.fit();
        if (term.cols !== c || term.rows !== r) {
          await api.resizeTerminal(sid, term.cols, term.rows);
        }
      } catch {
        /* ignore */
      }
      if (!first) term.write("\r\n\x1b[32m[已重新连接]\x1b[0m\r\n");
      // 若有待执行命令（如软件包「检查更新」），连接后稍等再写入
      const pending = pendingTerminalCmd.value || pendingCmdLocal;
      if (pending) {
        pendingCmdLocal = null;
        app.clearTerminalCmd();
        const cmd = pending;
        setTimeout(() => {
          api.writeTerminal(sid, cmd + "\n").catch(() => {});
        }, 1200);
      }
    } catch (e) {
      if (ctl.stopped) return;
      if (first) term.write(`\x1b[31m连接失败: ${e}\x1b[0m\r\n`);
      scheduleReconnect();
    } finally {
      ctl.inFlight = false;
    }
  }

  // 本机网络恢复时：若仍在重连中，立刻重试（不等退避定时器）
  ctl.kick = () => {
    if (ctl.stopped) return;
    const s = sessions.value.find((x) => x.id === id);
    if (!s?.reconnecting) return;
    ctl.attempt = 0;
    if (ctl.timer) {
      clearTimeout(ctl.timer);
      ctl.timer = null;
    }
    void connect(false);
  };

  tab.offData = Events.On(eventName, (ev: { data?: { data?: string } }) => {
    if (ev?.data?.data) term.write(ev.data.data);
  });
  tab.offExit = Events.On(`${eventName}:exit`, (ev: { data?: { reason?: string } }) => {
    const payload = ev?.data;
    if (ctl.stopped) return;
    if (payload?.reason === "error") {
      // 异常断开：每个 Tab 各自立即自动重连，互不影响
      term.write("\r\n\x1b[33m[连接已断开，正在自动重连…]\x1b[0m\r\n");
      patchSession(id, { closed: true, reconnecting: true, sessionID: "" });
      notifyDisconnect();
      ctl.attempt = 0;
      if (ctl.timer) {
        clearTimeout(ctl.timer);
        ctl.timer = null;
      }
      void connect(false);
    } else {
      // 正常退出（exit）：不重连
      term.write("\r\n\x1b[33m[连接已关闭]\x1b[0m\r\n");
      patchSession(id, { closed: true, reconnecting: false });
    }
  });

  // 输入：每个字符直接发送（对齐 uniterm，无合并、无 setTimeout，保证输入连贯）
  term.onData((d) => {
    const sid = currentSid();
    if (sid) api.writeTerminal(sid, d).catch(() => {});
  });

  // 窗口尺寸变化：用当前 sessionID 同步 PTY（重连后仍是此回调）
  term.onResize(({ cols: c, rows: r }) => {
    const sid = currentSid();
    if (sid) api.resizeTerminal(sid, c, r).catch(() => {});
  });

  el.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    e.stopPropagation();
    const sel = term.getSelection();
    ctxMenu.value = {
      x: e.clientX,
      y: e.clientY,
      sessionID: currentSid(),
      term,
      hasSelection: !!sel && sel.length > 0,
    };
  });

  term.focus();
  opening = false;

  // 首次连接
  void connect(true);
}

async function destroySession(t: Session) {
  // 停止该会话的自动重连
  const ctl = reconnectMap.get(t.id);
  if (ctl) {
    ctl.stopped = true;
    if (ctl.timer) clearTimeout(ctl.timer);
    reconnectMap.delete(t.id);
  }
  if (t.sessionID) {
    try {
      await api.closeTerminal(t.sessionID);
    } catch {
      /* ignore */
    }
  }
  t.offData?.();
  t.offExit?.();
  try {
    t.term.dispose();
  } catch {
    /* ignore */
  }
}

async function closeSession(id: string) {
  const idx = sessions.value.findIndex((x) => x.id === id);
  if (idx < 0) return;
  const t = sessions.value[idx];
  // 手动关闭前确认：会话断开不可恢复
  try {
    await ElMessageBox.confirm(
      `确定关闭「会话 ${idx + 1}」吗？该终端的远程连接将断开。`,
      "关闭会话",
      { type: "warning", confirmButtonText: "关闭", cancelButtonText: "取消" }
    );
  } catch {
    return; // 用户取消
  }
  await destroySession(t);
  const next = sessions.value.filter((x) => x.id !== id);
  sessions.value = next;
  if (activeId.value === id) {
    activeId.value = next.length ? next[next.length - 1].id : null;
  }
  if (next.length === 0) {
    // 全部关掉后自动再开一个，避免空壳
    await nextTick();
    void openNew();
  }
}

function activate(id: string) {
  activeId.value = id;
}

async function mountActive() {
  const container = containerRef.value;
  const id = activeId.value;
  if (!container || !id) return;
  const active = sessions.value.find((x) => x.id === id);
  if (!active) return;

  while (container.firstChild) {
    container.removeChild(container.firstChild);
  }
  container.appendChild(active.el);

  await nextTick();
  requestAnimationFrame(() => {
    fitActiveTerminal();
    active.term.focus();
  });
}

async function copySelection() {
  if (!ctxMenu.value) return;
  const text = ctxMenu.value.term.getSelection();
  ctxMenu.value = null;
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
  }
}

async function pasteClipboard() {
  if (!ctxMenu.value) return;
  const { sessionID, term } = ctxMenu.value;
  ctxMenu.value = null;
  try {
    const text = await navigator.clipboard.readText();
    if (!text) return;
    if (sessionID) {
      await api.writeTerminal(sessionID, text);
    } else {
      term.paste(text);
    }
  } catch (e) {
    console.error("粘贴失败", e);
  }
  term.focus();
}

// ---- 拖拽上传 ----
function onDragEnter() {
  dragCounter++;
  dragOver.value = true;
}
function onDragLeave() {
  dragCounter--;
  if (dragCounter <= 0) {
    dragOver.value = false;
    dragCounter = 0;
  }
}
// drop 兜底：webview 拿不到本地路径，真正的路径走 Wails OnFileDrop；
// 这里仅复位遮罩，避免回调未触发时遮罩卡死
function onDropFallback() {
  dragOver.value = false;
  dragCounter = 0;
}

// 文件拖放：v3 由后端 "file:drop" 事件提供本地绝对路径 → 上传到 /tmp → 回填远程路径到光标
async function handleFileDrop(paths: string[]) {
  dragOver.value = false;
  dragCounter = 0;
  if (!paths?.length) return;

  if (uploadToastTimer) {
    clearTimeout(uploadToastTimer);
    uploadToastTimer = null;
  }
  uploadState.value = {
    visible: true,
    done: false,
    error: "",
    current: "准备上传…",
    uploaded: 0,
    total: 0,
  };

  try {
    // 原样上传到 /tmp（convertPaths 传空数组 = 不做编码转换）
    await api.uploadPaths(props.host, paths, [], TERM_UPLOAD_DIR);
    uploadState.value.done = true;
    writeRemotePathsToTerm(paths);
  } catch (e) {
    uploadState.value.error = formatErr(e);
  } finally {
    // 完成 / 失败后 1.5s 自动淡出浮层
    uploadToastTimer = setTimeout(() => {
      uploadState.value.visible = false;
    }, 1500);
  }
}

// 把远程路径写到当前活动会话的光标处（不回车，便于接 vim/cat 等命令）
// 路径 = /tmp/<basename>，单引号包裹防空格 / 特殊字符，多个用空格拼接
function writeRemotePathsToTerm(localPaths: string[]) {
  const active = sessions.value.find((s) => s.id === activeId.value);
  if (!active?.sessionID) return;
  const remote = localPaths
    .map((p) => p.split(/[\\/]/).pop() || p)
    .map((name) => `'${TERM_UPLOAD_DIR}/${name}'`)
    .join(" ");
  api.writeTerminal(active.sessionID, remote).catch(() => {});
}

function onUploadProgress(ev: {
  uploaded?: number;
  total?: number;
  current?: string;
}) {
  uploadState.value.uploaded = ev.uploaded ?? 0;
  uploadState.value.total = ev.total ?? 0;
  uploadState.value.current = ev.current ?? "";
}

async function teardownAll() {
  const list = [...sessions.value];
  sessions.value = [];
  activeId.value = null;
  for (const t of list) {
    await destroySession(t);
  }
}

// 切换会话：把对应 DOM 挂回容器并 fit
watch(activeId, () => {
  void mountActive();
});

// 已有会话时收到 pending 命令：写入当前 active
function flushPendingTerminalCmd(cmd: string | null | undefined) {
  if (!cmd) return;
  const active = sessions.value.find((x) => x.id === activeId.value);
  if (active?.sessionID) {
    const c = cmd;
    app.clearTerminalCmd();
    pendingCmdLocal = null;
    setTimeout(() => {
      api.writeTerminal(active.sessionID, c + "\n").catch(() => {});
    }, 300);
    return;
  }
  pendingCmdLocal = cmd;
}

watch(pendingTerminalCmd, (cmd) => {
  flushPendingTerminalCmd(cmd);
});

// 换主机：关掉旧会话，重新开
watch(
  () => props.host,
  async () => {
    await teardownAll();
    await nextTick();
    void openNew();
  }
);

// 设置变更：同步到所有已开终端
watch(
  [terminalFontSize, terminalFontFamily, fontFamily],
  () => {
    const size = terminalFontSize.value || 14;
    const fam = resolveTermFontFamily();
    for (const s of sessions.value) {
      s.term.options.fontSize = size;
      s.term.options.fontFamily = fam;
      try {
        s.fit.fit();
      } catch {
        /* ignore */
      }
    }
  }
);

function fitActiveTerminal() {
  const active = sessions.value.find((x) => x.id === activeId.value);
  if (!active) return;
  try {
    active.fit.fit();
    if (active.sessionID) {
      api
        .resizeTerminal(active.sessionID, active.term.cols, active.term.rows)
        .catch(() => {});
    }
  } catch {
    /* ignore */
  }
}

function onWinResize() {
  fitActiveTerminal();
}

function onDocClick() {
  ctxMenu.value = null;
}

/** 浏览器 online：本机网络恢复后，立刻踢所有重连中的 Tab */
function onNetworkOnline() {
  for (const ctl of reconnectMap.values()) {
    ctl.kick?.();
  }
}

let resizeObs: ResizeObserver | null = null;
let fitRaf = 0;

function scheduleFitActive() {
  // 合并同帧多次尺寸抖动，避免 fit → resize PTY → 回流 的连环卡顿
  if (fitRaf) cancelAnimationFrame(fitRaf);
  fitRaf = requestAnimationFrame(() => {
    fitRaf = 0;
    fitActiveTerminal();
  });
}

onMounted(() => {
  window.addEventListener("resize", onWinResize);
  window.addEventListener("click", onDocClick);
  window.addEventListener("online", onNetworkOnline);
  if (containerRef.value) {
    resizeObs = new ResizeObserver(() => {
      scheduleFitActive();
    });
    resizeObs.observe(containerRef.value);
  }
  // 等容器布局稳定再开
  setTimeout(() => {
    if (sessions.value.length === 0) void openNew();
  }, 50);
  // v3：拖放经 LIFO 分发器，仅在终端页激活时注册（KeepAlive 失活即出栈）；
  // 上传进度各自订阅
  offProgress = Events.On(
    "upload:progress",
    (ev: { data?: { uploaded?: number; total?: number; current?: string } }) => {
      if (ev?.data) onUploadProgress(ev.data);
    }
  );
});

// KeepAlive 重新激活（从其他子页签切回终端）时重新适配尺寸：
// 隐藏期间容器尺寸变化不会触发任何事件，需要显式 fit
onActivated(() => {
  if (!offDrop) offDrop = registerFileDrop(handleFileDrop);
  // 概览「安装」等：先切 tab 再投递命令时，此处补一次 flush
  flushPendingTerminalCmd(pendingTerminalCmd.value || pendingCmdLocal);
  const active = sessions.value.find((x) => x.id === activeId.value);
  if (!active) return;
  void nextTick(() => {
    requestAnimationFrame(() => fitActiveTerminal());
  });
});

// KeepAlive 失活（切到其它子页签）：退出拖放栈，避免拦截文件页拖拽
onDeactivated(() => {
  offDrop?.();
  offDrop = null;
});

onBeforeUnmount(() => {
  if (fitRaf) {
    cancelAnimationFrame(fitRaf);
    fitRaf = 0;
  }
  resizeObs?.disconnect();
  resizeObs = null;
  window.removeEventListener("resize", onWinResize);
  window.removeEventListener("click", onDocClick);
  window.removeEventListener("online", onNetworkOnline);
  offDrop?.();
  offDrop = null;
  offProgress?.();
  if (uploadToastTimer) {
    clearTimeout(uploadToastTimer);
    uploadToastTimer = null;
  }
  if (disconnectNotifyTimer) {
    clearTimeout(disconnectNotifyTimer);
    disconnectNotifyTimer = null;
  }
  void teardownAll();
});
</script>

<style scoped lang="scss">
/* 占满 content-pad--fill 给的剩余空间 */
.term-enl {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.term-page {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  width: 100%;
  height: 100%;
  min-height: 0;
  min-width: 0;
  padding: 0;
  overflow: hidden;
  position: relative;
}

/* 会话栏：浅色 Primary Tabs，与 RouterButton 对齐 */
.term-bar {
  flex-shrink: 0;
  display: flex;
  align-items: stretch;
  gap: 12px;
  min-height: 44px;
  padding: 0 12px 0 4px;
  border-bottom: 1px solid var(--m3-outline-variant);
  background: var(--m3-surface-container-lowest);
  box-sizing: border-box;
}

.term-tabs-scroll {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: stretch;
  gap: 0;
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: none;

  &::-webkit-scrollbar {
    display: none;
  }
}

.term-tab {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  box-sizing: border-box;
  margin: 0;
  padding: 0 14px;
  min-width: 72px;
  height: 44px;
  border: none;
  border-radius: 0;
  background: transparent;
  color: var(--m3-on-surface-variant);
  cursor: pointer;
  position: relative;
  white-space: nowrap;
  -webkit-tap-highlight-color: transparent;

  &::after {
    content: "";
    position: absolute;
    left: 14px;
    right: 14px;
    bottom: 0;
    height: 2px;
    border-radius: 2px 2px 0 0;
    background: transparent;
    transition: background-color var(--m3-motion-state);
  }

  &:hover {
    color: var(--m3-on-surface);
    background: color-mix(in srgb, var(--m3-primary) 6%, transparent);
  }

  &.is-active {
    color: var(--m3-primary);

    &::after {
      background: var(--m3-primary);
    }

    .term-tab__label {
      font-weight: 600;
    }
  }

  &.closed .term-tab__label {
    opacity: 0.55;
    text-decoration: line-through;
  }

  &--add {
    min-width: 44px;
    padding: 0;
    justify-content: center;
    color: var(--m3-on-surface-variant);

    &::after {
      display: none;
    }

    &:hover {
      color: var(--m3-primary);
      background: color-mix(in srgb, var(--m3-primary) 8%, transparent);
    }
  }
}

.term-tab__label {
  font: var(--m3-title-small);
  font-weight: 500;
  line-height: 20px;
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.term-tab__badge {
  font-size: 10px;
  line-height: 1;
  padding: 2px 6px;
  border-radius: var(--m3-shape-full);
  font-weight: 500;

  &.is-closed {
    color: var(--m3-tertiary);
    background: var(--m3-tertiary-container);
  }

  &.is-reconnecting {
    color: var(--m3-primary);
    background: var(--m3-primary-container);
  }
}

.term-tab__close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  margin-left: 2px;
  border-radius: var(--m3-shape-full);
  font-size: 14px;
  line-height: 1;
  opacity: 0.45;
  color: inherit;

  &:hover {
    opacity: 1;
    background: color-mix(in srgb, var(--m3-on-surface) 8%, transparent);
  }
}

.term-host {
  flex-shrink: 0;
  align-self: center;
  max-width: 36%;
  padding-right: 28px;
  font: var(--m3-label-small);
  color: var(--m3-on-surface-variant);
  font-variant-numeric: tabular-nums;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.term-body {
  position: relative;
  flex: 1 1 auto;
  min-height: 0;
  min-width: 0;
  overflow: hidden;
  background: var(--panel-terminal-bg-color, #000000);
  user-select: text;

  :deep(.xterm),
  :deep(.xterm-viewport),
  :deep(.xterm-screen) {
    width: 100% !important;
    height: 100% !important;
  }

  :deep(.xterm) {
    padding: 8px 12px;
    box-sizing: border-box;
  }
}

/* ---- 拖拽上传遮罩 ---- */
.term-drop-overlay {
  position: absolute;
  inset: 0;
  z-index: 50;
  display: none;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  background: color-mix(in srgb, var(--m3-primary) 12%, transparent);
  border: 2px dashed var(--m3-primary);
  border-radius: 0 0 var(--m3-shape-m) var(--m3-shape-m);
  pointer-events: none;
}
.term-page.is-dragover .term-drop-overlay,
.term-page.file-drop-target-active .term-drop-overlay {
  display: flex;
}
.term-drop-icon {
  font-size: 56px;
  color: var(--m3-primary);
}
.term-drop-text {
  font: var(--m3-title-medium);
  color: var(--m3-primary);
}

/* ---- 上传进度浮层 ---- */
.term-upload-toast {
  position: absolute;
  top: 52px;
  right: 12px;
  z-index: 60;
  min-width: 200px;
  max-width: 320px;
  padding: 10px 12px;
  border-radius: var(--m3-shape-s);
  background: rgba(26, 29, 36, 0.94);
  border: 1px solid #363b44;
  color: #e8eaed;
  font-size: 12px;
  pointer-events: none;
  box-shadow: var(--m3-elevation-2);

  &.is-done {
    border-color: #22c55e;
    color: #4ade80;
  }
  &.is-error {
    border-color: #ef4444;
    color: #f87171;
  }
}
.term-upload-bar {
  height: 4px;
  margin-bottom: 8px;
  border-radius: 2px;
  background: #363b44;
  overflow: hidden;
}
.term-upload-fill {
  height: 100%;
  background: var(--m3-primary);
  transition: width var(--m3-duration-short3) linear;
}
.term-upload-msg {
  display: block;
  font-family: var(--m3-font-mono);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.term-ctx {
  position: fixed;
  z-index: 3000;
  min-width: 180px;
  padding: 8px;
  border-radius: var(--m3-shape-s);
  border: none;
  background: var(--m3-surface-container-lowest);
  box-shadow: var(--m3-elevation-2);
}

.ctx-item {
  display: flex;
  align-items: center;
  width: 100%;
  min-height: 40px;
  padding: 8px 12px;
  border: 0;
  border-radius: var(--m3-shape-xs);
  background: transparent;
  color: var(--m3-on-surface);
  font: var(--m3-label-large);
  text-align: left;
  cursor: pointer;

  &:hover:not(:disabled) {
    background: color-mix(in srgb, var(--m3-primary) 8%, transparent);
  }
  &:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
}

.ctx-kbd {
  margin-left: auto;
  padding-left: 24px;
  font: var(--m3-label-medium);
  color: var(--m3-on-surface-variant);
}
</style>
