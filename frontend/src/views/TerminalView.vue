<template>
  <div class="term-enl">
  <div
    class="term-page"
    data-file-drop-target
    :class="{ 'is-dragover': dragOver }"
    @dragenter.prevent="onDragEnter"
    @dragover.prevent
    @dragleave.prevent="onDragLeave"
    @drop.prevent="onDropFallback"
  >
    <div ref="stageRef" class="term-stage" :class="{ 'is-vtabs': vtabs }">
      <aside v-if="vtabs" class="term-vlist">
        <div class="term-vlist__title">终端 · {{ paneCount }}</div>
        <button
          v-for="leaf in paneLeaves"
          :key="leaf.id"
          type="button"
          class="term-vitem"
          :class="{ 'is-active': leaf.id === focusedPaneId }"
          @click="focusPane(leaf.id)"
        >
          <DistroLogo :os-release="osOf(leaf.host)" :size="16" />
          <span class="term-vitem__text">
            <span class="term-vitem__host">{{ leaf.host }}</span>
            <span class="term-vitem__sub">{{ userOf(leaf.host) }} · {{ pathOf(leaf.id) }}</span>
          </span>
          <span
            v-if="faces[leaf.id] === 'down' || faces[leaf.id] === 'blind' || faces[leaf.id] === 'missing'"
            class="term-vitem__re is-down"
            title="重试"
            @click.stop="retryPane(leaf.id)"
          >
            ↻
          </span>
        </button>
      </aside>
      <TermPaneTree
        :node="displayTree"
        :focused-id="focusedPaneId"
        :show-focus="paneCount > 1 && !zoomed && !vtabs"
        :show-head="paneCount > 1 && !vtabs"
        :cwd-by-id="cwdById"
        :faces="faces"
        @focus="focusPane"
        @slot="onPaneSlot"
        @ratio="onPaneRatio"
        @drag-end="scheduleFitAll"
        @close="closePane"
        @retry="retryPane"
        @reconnect="reconnectPane"
        @move="onMovePane"
        @adopt="onAdoptHost"
      />
    </div>
    <div ref="parkRef" class="term-park" />

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

    <!-- 右键：复制粘贴，以及和快捷键一致的终端操作 -->
    <div
      v-if="ctxMenu"
      class="term-ctx"
      :style="{ left: ctxMenu.x + 'px', top: ctxMenu.y + 'px' }"
      @click.stop
      @contextmenu.prevent
    >
      <button type="button" class="ctx-item" :disabled="!ctxMenu.hasSelection" @click="copySelection">
        复制
        <span class="ctx-kbd">⌘C</span>
      </button>
      <button type="button" class="ctx-item" @click="pasteClipboard">
        粘贴
        <span class="ctx-kbd">⌘V</span>
      </button>
      <div class="ctx-sep" />
      <button type="button" class="ctx-item" @click="runCtx('sessions')">
        显示会话
        <span class="ctx-kbd">⌘⇧L</span>
      </button>
      <button type="button" class="ctx-item" @click="runCtx('new')">
        新建终端
        <span class="ctx-kbd">⌘T</span>
      </button>
      <button type="button" class="ctx-item" @click="runCtx('split-right')">
        左右分屏
        <span class="ctx-kbd">⌘D</span>
      </button>
      <button type="button" class="ctx-item" @click="runCtx('split-down')">
        上下分屏
        <span class="ctx-kbd">⌘⇧D</span>
      </button>
      <div class="ctx-sep" />
      <button type="button" class="ctx-item" :disabled="!focusHostName" @click="runCtx('return-host')">
        返回主机
        <span class="ctx-kbd">⌘⇧H</span>
      </button>
      <button
        v-for="b in jumpTabs"
        :key="b.value"
        type="button"
        class="ctx-item ctx-item--sub"
        :disabled="!focusHostName"
        @click="returnTool(b.value)"
      >
        {{ b.label }}
      </button>
      <div class="ctx-sep" />
      <button type="button" class="ctx-item" :disabled="paneCount < 2" @click="runCtx('close-pane')">
        关闭窗格
        <span class="ctx-kbd">⌘W</span>
      </button>
      <button type="button" class="ctx-item" :disabled="paneCount < 2" @click="runCtx('detach')">
        移出分屏
        <span class="ctx-kbd">⌘⇧M</span>
      </button>
      <button type="button" class="ctx-item ctx-item--danger" @click="runCtx('close-session')">
        关闭会话
        <span class="ctx-kbd">⌘⇧W</span>
      </button>
      <button type="button" class="ctx-item" @click="reconnectFromMenu">
        重连
      </button>
      <button type="button" class="ctx-item ctx-item--danger" :disabled="!focusHostName" @click="runCtx('disconnect-host')">
        断开这台主机
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
import { UploadFilled } from "@element-plus/icons-vue";
import { ElMessage, ElNotification } from "element-plus";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import "@xterm/xterm/css/xterm.css";
import { Events, Window } from "@wailsio/runtime";
import { noteListener, noteTerm, noteWebgl } from "@/utils/uxPerf";
import { api } from "@/api";
import { HOST_SUB_TABS } from "@/constants/hostSubTabs";
import { useAppStore, type SubTab } from "@/stores/app";
import { useSettingsStore } from "@/stores/settings";
import { storeToRefs } from "pinia";
import { formatErr } from "@/utils/format";
import { registerFileDrop } from "@/utils/fileDrop";
import { ctrlLetter, shouldCloseDeskOnLastPane } from "@/utils/termKeys";
import DistroLogo from "@/components/DistroLogo.vue";
import TermPaneTree from "@/views/TermPaneTree.vue";
import {
  equalizeRatios,
  findLeaf,
  hostOf,
  moveLeaf,
  neighborId,
  orderedLeaves,
  placeBeside,
  removeLeaf,
  resizeHit,
  setRatio,
  splitLeaf,
  splitRatioOf,
  type PaneLeaf,
  type PaneNode,
  type PaneSide,
} from "@/views/termPanes";
import {
  claimTermPane,
  forgetSession,
  liveEpoch,
  liveState,
  parkTermEl,
  parkTermPane,
  patchLive,
  rememberSession,
  registerTermDesk,
  sessionBody,
  sidOf,
  takeTermDesk,
  type PaneHandoff,
} from "@/views/termLive";
import {
  paneFace,
  parentAfterSlotSwap,
  probeUnchanged,
  shouldSettleAttached,
  terminalInputReady,
  type PaneFace,
  type PaneProbe,
} from "@/views/termMount";

const props = defineProps<{ host: string; workspaceSessionId: string }>();
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
function trackEvent<T>(name: string, cb: (ev: T) => void) {
  noteListener(1);
  const off = Events.On(name, cb as (ev: { name: string; data: unknown }) => void);
  return () => {
    noteListener(-1);
    off();
  };
}

function loadWebgl(term: XTerm, onLoss: () => void): { dispose: () => void } | null {
  try {
    const webgl = new WebglAddon();
    webgl.onContextLoss(() => {
      try {
        webgl.dispose();
      } catch {
        /* ignore */
      }
      onLoss();
    });
    term.loadAddon(webgl);
    return webgl;
  } catch {
    return null;
  }
}

interface Session {
  id: string;
  host: string;
  ownerDesk: string;
  sessionID: string;
  eventName: string;
  term: XTerm;
  fit: FitAddon;
  closed: boolean;
  reconnecting: boolean;
  el: HTMLDivElement;
  /** 自定义标签名；空则显示「会话」 */
  title?: string;
  /** v3 Events.On 返回的退订函数（销毁会话时调用） */
  offData?: () => void;
  offExit?: () => void;
  webgl: boolean;
  webglAddon: { dispose: () => void } | null;
}

interface ReconnectCtl {
  timer: ReturnType<typeof setTimeout> | null;
  attempt: number;
  stopped: boolean;
  /** 防止并发 connect（异常 exit 与定时器重叠） */
  inFlight: boolean;
  /** 网络恢复时立刻踢一脚，不等退避 */
  kick: (() => void) | null;
  /** 用户点了重连。只在已经断开时生效，返回是否真的发起了重连 */
  manual: (() => boolean) | null;
}

/** 重连退避：每个 Tab 独立，最多尝试 RECONNECT_MAX_ATTEMPTS 次 */
const RECONNECT_BASE_MS = 200;
const RECONNECT_MAX_MS = 2000;
const RECONNECT_MAX_ATTEMPTS = 3;

interface CtxMenu {
  x: number;
  y: number;
  paneId: string;
  sessionID: string;
  term: XTerm;
  hasSelection: boolean;
}

const stageRef = ref<HTMLDivElement | null>(null);
const parkRef = ref<HTMLDivElement | null>(null);
const windowFullscreen = ref(false);
const cwdById = ref<Record<string, string>>({});
// shallowRef：避免 Vue 对 XTerm 实例做深度代理
const sessions = shallowRef<Session[]>([]);
let seq = 0;
function newPaneId(): string {
  seq += 1;
  return `pane-${Date.now()}-${seq}`;
}
const savedLayout = app.consumeWorkspaceLayout(props.workspaceSessionId);
const pendingTree = app.consumePendingTree(props.workspaceSessionId);
function initialTree(): PaneNode {
  if (pendingTree) return pendingTree;
  if (savedLayout?.tree) return savedLayout.tree;
  return { kind: "leaf", id: newPaneId(), host: props.host };
}
const paneTree = ref<PaneNode>(initialTree());
function initialFocus(): string {
  if (savedLayout && findLeaf(paneTree.value, savedLayout.focusedId)) {
    return savedLayout.focusedId;
  }
  if (paneTree.value.kind === "leaf") return paneTree.value.id;
  return orderedLeaves(paneTree.value)[0] || "";
}
const focusedPaneId = ref(initialFocus());
const zoomed = ref(false);
const paneCount = computed(() => orderedLeaves(paneTree.value).length);

watch([paneTree, focusedPaneId], () => {
  app.persistWorkspaceLayout(props.workspaceSessionId, paneTree.value, focusedPaneId.value);
});

function flushWorkspaceLayout() {
  app.persistWorkspaceLayoutNow(props.workspaceSessionId, paneTree.value, focusedPaneId.value);
}
window.addEventListener("beforeunload", flushWorkspaceLayout);
const vtabs = computed(() => windowFullscreen.value && paneCount.value > 1);
const displayTree = computed<PaneNode>(() => {
  if (zoomed.value || vtabs.value) {
    return findLeaf(paneTree.value, focusedPaneId.value) || paneTree.value;
  }
  return paneTree.value;
});

function collectLeaves(node: PaneNode): PaneLeaf[] {
  if (node.kind === "leaf") return [node];
  return [...collectLeaves(node.a), ...collectLeaves(node.b)];
}
const paneLeaves = computed(() => collectLeaves(paneTree.value));
function osOf(host: string): string {
  return app.osReleaseMap.get(host) || "";
}
function userOf(host: string): string {
  return app.hosts.find((h) => h.name === host)?.user || "";
}
function pathOf(id: string): string {
  return cwdById.value[id] || "~";
}

function readCwd(raw: string): string {
  const osc = raw.match(/\x1b\]7;file:\/\/[^/\x07\x1b]*(\/[^ \x07\x1b]*)/);
  if (osc?.[1]) {
    try {
      return decodeURIComponent(osc[1]);
    } catch {
      return osc[1];
    }
  }
  const iterm = raw.match(/\x1b\]1337;CurrentDir=([^\x07]+)/);
  if (iterm?.[1]) return iterm[1];
  const plain = raw.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "");
  const prompt = plain.match(/ in (~|~\/\S+|\/\S+) /);
  if (prompt?.[1]) return prompt[1];
  return "";
}

function noteCwd(paneId: string, raw: string) {
  const next = readCwd(raw);
  if (!next || cwdById.value[paneId] === next) return;
  cwdById.value = { ...cwdById.value, [paneId]: next };
}
const ctxMenu = ref<CtxMenu | null>(null);
const openingIds = new Set<string>();
const slots = new Map<string, HTMLElement>();
const pendingSlot = new Map<string, HTMLElement | null>();
const slotQueued = new Set<string>();
const probes = ref<Record<string, PaneProbe>>({});

function dropWebgl(s: Session) {
  if (!s.webglAddon && !s.webgl) return;
  const addon = s.webglAddon;
  s.webglAddon = null;
  if (s.webgl) {
    s.webgl = false;
    noteWebgl(-1);
  }
  if (!addon) return;
  try {
    addon.dispose();
  } catch {
    /* ignore */
  }
}

function appleShell(): boolean {
  const plat = navigator.platform || "";
  const ua = navigator.userAgent || "";
  if (/Mac|iPhone|iPad/.test(plat)) return true;
  if (/Macintosh|Mac OS X/.test(ua)) return true;
  const os = (window as unknown as { _wails?: { environment?: { OS?: string } } })._wails?.environment?.OS;
  return os === "darwin" || os === "ios";
}

function ensureWebgl(s: Session) {
  // macOS WKWebView 会把 WebGL canvas 合成到窗口最上层，盖住顶部导航，
  // 点「主机 / 通知 / 设置」会点进画布。这台桌面壳用 xterm 自带的 Canvas。
  if (appleShell()) return;
  if (s.webglAddon) return;
  const addon = loadWebgl(s.term, () => {
    s.webglAddon = null;
    if (s.webgl) {
      s.webgl = false;
      noteWebgl(-1);
    }
    try {
      s.term.refresh(0, Math.max(0, s.term.rows - 1));
    } catch {
      /* ignore */
    }
  });
  if (!addon) return;
  s.webglAddon = addon;
  s.webgl = true;
  noteWebgl(1);
}

function measurePane(id: string): { inputMounted: boolean; slotSized: boolean } {
  const slot = slots.get(id) || null;
  const slotSized = !!slot && slot.isConnected && slot.clientWidth >= 2 && slot.clientHeight >= 2;
  return {
    inputMounted: terminalInputReady(slot),
    slotSized,
  };
}

function writeProbe(id: string, patch: Partial<PaneProbe>) {
  const prev = probes.value[id];
  const live = liveState(id);
  const next: PaneProbe = {
    hasLive: !!live,
    closed: !!live?.closed,
    sessionID: live?.sessionID || "",
    inputMounted: prev?.inputMounted ?? false,
    slotSized: prev?.slotSized ?? false,
    probed: prev?.probed ?? false,
    ...patch,
  };
  if (probeUnchanged(prev, next)) return;
  probes.value = { ...probes.value, [id]: next };
}

const faces = computed(() => {
  void liveEpoch.value;
  void probes.value;
  const out: Record<string, PaneFace> = {};
  for (const leaf of paneLeaves.value) {
    const live = liveState(leaf.id);
    const probe = probes.value[leaf.id];
    out[leaf.id] = paneFace(
      probe
        ? {
            ...probe,
            hasLive: !!live,
            closed: !!live?.closed,
            sessionID: live?.sessionID || "",
          }
        : live
          ? {
              hasLive: true,
              closed: !!live.closed,
              sessionID: live.sessionID || "",
              inputMounted: false,
              slotSized: false,
              probed: false,
            }
          : null
    );
  }
  return out;
});
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
  patchLive(id, patch);
  if (!sessions.value.some((s) => s.id === id)) return;
  sessions.value = sessions.value.slice();
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

async function openNew(container: HTMLElement, paneId: string, takePending: boolean) {
  if (openingIds.has(paneId)) return;
  if (sessions.value.some((s) => s.id === paneId)) return;
  openingIds.add(paneId);

  const id = paneId;
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

  // 先挂到当前槽位并立刻登记。await 之前不登记的话，分屏换槽会被 opening 标志吃掉，
  // xterm 留在已经卸掉的节点上，窗格全黑且没有 Terminal input。
  const el = document.createElement("div");
  el.style.cssText = "width:100%;height:100%;position:absolute;inset:0;";
  slots.set(paneId, container);
  container.appendChild(el);
  term.open(el);
  noteTerm(1);

  const host = hostOf(paneTree.value, paneId) || props.host;
  const tab: Session = {
    id,
    host,
    ownerDesk: props.workspaceSessionId,
    sessionID: "",
    eventName,
    term,
    fit,
    closed: false,
    reconnecting: false,
    el,
    title: undefined,
    webgl: false,
    webglAddon: null,
  };
  rememberSession(id, tab, {
    id,
    host,
    ownerDesk: props.workspaceSessionId,
    sessionID: "",
    closed: false,
    reconnecting: false,
  });
  sessions.value = [...sessions.value, tab];
  if (!focusedPaneId.value || focusedPaneId.value === id) {
    focusedPaneId.value = id;
  }
  openingIds.delete(paneId);

  // 当前 sessionID（重连后变化，统一从 sessions 里取）
  const currentSid = () => sidOf(id);

  // 重连控制（每个 Tab 独立；关 Tab 才 stopped）
  const ctl: ReconnectCtl = {
    timer: null,
    attempt: 0,
    stopped: false,
    inFlight: false,
    kick: null,
    manual: null,
  };
  reconnectMap.set(id, ctl);

  function giveUpReconnect() {
    term.write(
      `\r\n\x1b[31m[重连失败：已尝试 ${RECONNECT_MAX_ATTEMPTS} 次，停止自动重连]\x1b[0m\r\n`
    );
    patchSession(id, { closed: true, reconnecting: false });
    ElNotification({
      title: "终端重连失败",
      message: `已尝试 ${RECONNECT_MAX_ATTEMPTS} 次仍无法连接。可点窗格上的刷新，或在标签上右键「全部重连」`,
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
      const host = liveState(id)?.host || hostOf(paneTree.value, paneId) || props.host;
      const sid = await api.openTerminal(host, eventName, c, r);
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
      const pending = takePending
        ? pendingTerminalCmd.value || pendingCmdLocal
        : null;
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
    const s = liveState(id);
    if (!s?.reconnecting) return;
    ctl.attempt = 0;
    if (ctl.timer) {
      clearTimeout(ctl.timer);
      ctl.timer = null;
    }
    void connect(false);
  };

  // 只重连已经断开的窗格。还连着就直接返回，避免掐掉正在执行的命令。
  let ignoreSid = "";
  ctl.manual = () => {
    if (ctl.stopped) return false;
    const cur = liveState(id);
    if (!cur || !cur.closed) return false;
    if (ctl.timer) {
      clearTimeout(ctl.timer);
      ctl.timer = null;
    }
    ctl.attempt = 0;
    const old = currentSid();
    if (old) {
      ignoreSid = old;
      api.closeTerminal(old).catch(() => {});
      patchSession(id, { sessionID: "" });
    }
    term.write("\r\n\x1b[33m[正在重新连接…]\x1b[0m\r\n");
    patchSession(id, { closed: true, reconnecting: true });
    if (!ctl.inFlight) void connect(false);
    return true;
  };

  tab.offData = trackEvent(eventName, (ev: { data?: { data?: string } }) => {
    const chunk = ev?.data?.data;
    if (!chunk) return;
    noteCwd(id, chunk);
    term.write(chunk);
  });
  tab.offExit = trackEvent(`${eventName}:exit`, (ev: { data?: { reason?: string; sessionId?: string } }) => {
    const payload = ev?.data;
    if (ctl.stopped) return;
    if (payload?.sessionId && payload.sessionId === ignoreSid) {
      ignoreSid = "";
      return;
    }
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
    } else if (shouldCloseDeskOnLastPane(orderedLeaves(paneTree.value).length)) {
      ctl.stopped = true;
      app.closeTerminalDesk(props.workspaceSessionId);
    } else {
      ctl.stopped = true;
      void closePane(id);
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
      paneId: id,
      sessionID: currentSid(),
      term,
      hasSelection: !!sel && sel.length > 0,
    };
  });

  if (focusedPaneId.value === id) term.focus();

  void (async () => {
    await new Promise<void>((r) => requestAnimationFrame(() => r()));
    const liveId = slots.get(paneId) ? "live" : null;
    const parent = parentAfterSlotSwap(true, "opened", liveId);
    const live = parent === "live" ? slots.get(paneId) : container;
    if (!isThisVisible()) {
      parkTermEl(el);
    } else if (live && el.parentElement !== live) {
      live.appendChild(el);
    }
    try {
      fit.fit();
    } catch {
      /* ignore */
    }
    await connect(true);
    await settleRender(tab);
    if (focusedPaneId.value === id) term.focus();
  })();
}

async function destroySession(t: Session) {
  dropWebgl(t);
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
  forgetSession(t.id);
  noteTerm(-1);
  if (t.webgl) noteWebgl(-1);
  try {
    t.term.dispose();
  } catch {
    /* ignore */
  }
}

function retryPane(id: string) {
  const face = faces.value[id] || "connecting";
  if (face === "down") {
    if (reconnectPane(id)) return;
  }
  const existing = sessions.value.find((s) => s.id === id);
  if (!existing) {
    openingIds.delete(id);
    const slot = slots.get(id);
    if (slot) void openNew(slot, id, false);
    return;
  }
  dropWebgl(existing);
  const slot = slots.get(id);
  if (slot && existing.el.parentElement !== slot) slot.appendChild(existing.el);
  void settleRender(existing).then(() => {
    if (focusedPaneId.value === id) existing.term.focus();
  });
}

async function settleRender(only?: Session) {
  const list = only ? [only] : [...sessions.value];
  for (const item of list) {
    const slot = slots.get(item.id);
    if (slot && item.el.parentElement !== slot) slot.appendChild(item.el);
  }
  await new Promise<void>((r) => requestAnimationFrame(() => r()));
  if (!app.isTerminalDeskVisible(props.workspaceSessionId)) return;
  for (const item of list) {
    const box = item.el;
    if (box.clientWidth >= 2 && box.clientHeight >= 2) {
      try {
        item.fit.fit();
      } catch {
        /* ignore */
      }
    }
    let measured = measurePane(item.id);
    if (measured.slotSized && !measured.inputMounted) {
      dropWebgl(item);
      try {
        item.fit.fit();
      } catch {
        /* ignore */
      }
      item.term.refresh(0, Math.max(0, item.term.rows - 1));
      measured = measurePane(item.id);
    } else if (measured.inputMounted && !item.webglAddon) {
      ensureWebgl(item);
      try {
        item.fit.fit();
      } catch {
        /* ignore */
      }
    } else if (measured.inputMounted) {
      item.term.refresh(0, Math.max(0, item.term.rows - 1));
    }
    if (item.sessionID && measured.slotSized) {
      api.resizeTerminal(item.sessionID, item.term.cols, item.term.rows).catch(() => {});
    }
    writeProbe(item.id, { ...measured, probed: true, hasLive: true });
  }
}

function reconnectPane(paneId: string): boolean {
  const ctl = reconnectMap.get(paneId);
  if (!ctl?.manual) return false;
  return ctl.manual();
}

function reconnectAllPanes() {
  let n = 0;
  for (const id of orderedLeaves(paneTree.value)) {
    if (reconnectPane(id)) n += 1;
  }
  if (n === 0) {
    ElMessage.info("这些终端都还连着，没有重连");
  }
}

const jumpTabs = HOST_SUB_TABS;
const focusHostName = computed(
  () => hostOf(paneTree.value, focusedPaneId.value) || props.host
);

function runCtx(name: string) {
  ctxMenu.value = null;
  app.runTermAction(name);
}

function returnTool(sub: SubTab) {
  const host = hostOf(paneTree.value, focusedPaneId.value) || props.host;
  ctxMenu.value = null;
  app.noteTerminalFocusHost(props.workspaceSessionId, host);
  app.returnToHost(sub);
}

function reconnectFromMenu() {
  const id = ctxMenu.value?.paneId;
  ctxMenu.value = null;
  if (!id) return;
  reconnectPane(id);
}

function focusPane(id: string) {
  if (focusedPaneId.value !== id) {
    focusedPaneId.value = id;
    const host = hostOf(paneTree.value, id) || props.host;
    app.noteTerminalFocusHost(props.workspaceSessionId, host);
  }
  const s = sessions.value.find((x) => x.id === id);
  s?.term.focus();
}

function onPaneSlot(id: string, el: HTMLElement | null) {
  pendingSlot.set(id, el);
  if (slotQueued.has(id)) return;
  slotQueued.add(id);
  queueMicrotask(() => {
    slotQueued.delete(id);
    const next = pendingSlot.has(id) ? (pendingSlot.get(id) ?? null) : null;
    pendingSlot.delete(id);
    applyPaneSlot(id, next);
  });
}

function applyPaneSlot(id: string, el: HTMLElement | null) {
  if (!el) {
    slots.delete(id);
    const existing = sessions.value.find((s) => s.id === id);
    if (existing?.el) {
      dropWebgl(existing);
      parkTermEl(existing.el);
    }
    return;
  }
  const parked = claimTermPane(id);
  if (parked) absorbHandoff([parked]);
  slots.set(id, el);
  const existing = sessions.value.find((s) => s.id === id);
  if (existing) {
    if (!isThisVisible()) {
      parkTermEl(existing.el);
      return;
    }
    const already = existing.el.parentElement === el;
    if (!already) el.appendChild(existing.el);
    if (shouldSettleAttached(already, true)) void settleRender(existing);
    return;
  }
  const takePending = sessions.value.length === 0;
  void openNew(el, id, takePending);
}

function absorbHandoff(items: PaneHandoff[]) {
  for (const item of items) {
    const s = item.session as Session;
    s.ownerDesk = props.workspaceSessionId;
    s.host = item.host || s.host;
    patchLive(s.id, { ownerDesk: props.workspaceSessionId, host: s.host });
    if (item.ctl) reconnectMap.set(s.id, item.ctl as ReconnectCtl);
    if (!sessions.value.some((x) => x.id === s.id)) {
      sessions.value = [...sessions.value, s];
    }
  }
}

function takeAllHandoff(): PaneHandoff[] {
  const out: PaneHandoff[] = [];
  for (const s of sessions.value) {
    const ctl = reconnectMap.get(s.id) || null;
    reconnectMap.delete(s.id);
    if (s.el) parkTermEl(s.el);
    out.push({ id: s.id, host: s.host || props.host, session: s, ctl });
  }
  sessions.value = [];
  return out;
}

function onPaneRatio(splitId: string, ratio: number) {
  paneTree.value = setRatio(paneTree.value, splitId, ratio);
  scheduleFitAll();
}

function splitFocused(way: "right" | "down") {
  const id = focusedPaneId.value;
  if (!id) return;
  zoomed.value = false;
  const newId = newPaneId();
  const host = hostOf(paneTree.value, id) || props.host;
  paneTree.value = splitLeaf(paneTree.value, id, way, newId, host);
  focusedPaneId.value = newId;
  scheduleFitAll();
}

function hostsIn(node: PaneNode): string[] {
  if (node.kind === "leaf") return [node.host];
  return [...hostsIn(node.a), ...hostsIn(node.b)];
}

/** 多个主机并到这个会话里时，把它从主机工作区拆成独立工作台。 */
function syncMergedTitle() {
  const names = [...new Set(hostsIn(paneTree.value))];
  app.noteDeskHosts(props.workspaceSessionId, names);
  if (names.length > 1) {
    app.promoteDeskToBench(props.workspaceSessionId);
    return;
  }
  app.demoteDeskIfSingle(props.workspaceSessionId, names[0] || props.host);
}

function onMovePane(paneId: string, targetId: string, side: PaneSide) {
  zoomed.value = false;
  paneTree.value = moveLeaf(paneTree.value, paneId, targetId, side);
  focusPane(paneId);
  scheduleFitAll();
}

function onAdoptHost(sessionId: string, host: string, targetId: string, side: PaneSide): boolean {
  const name = (host || "").trim();
  if (!name || sessionId === props.workspaceSessionId) return false;
  const taken = takeTermDesk(sessionId);
  if (taken.length === 0) {
    ElMessage.warning("没有拿到原来的会话，已取消，避免重开连接");
    return false;
  }
  absorbHandoff(taken);
  zoomed.value = false;
  let tree = paneTree.value;
  let anchor = targetId;
  for (const item of taken) {
    tree = placeBeside(tree, anchor, side, { kind: "leaf", id: item.id, host: item.host });
    anchor = item.id;
  }
  paneTree.value = tree;
  focusedPaneId.value = taken[taken.length - 1]?.id || focusedPaneId.value;
  app.releaseAdoptedSource(sessionId);
  syncMergedTitle();
  scheduleFitAll();
  ElMessage.success("已并入这个分屏，原来的 SSH 连接没有重开");
  return true;
}

let adoptingDeskMerge = false;

async function tryAdoptPending() {
  if (adoptingDeskMerge) return;
  const job = app.deskMerge;
  if (!job || job.targetId !== props.workspaceSessionId) return;
  if (!app.isTerminalDeskVisible(props.workspaceSessionId)) return;
  await nextTick();
  let leaf = focusedPaneId.value || orderedLeaves(paneTree.value)[0];
  if (!leaf) {
    await new Promise<void>((r) => requestAnimationFrame(() => r()));
    leaf = focusedPaneId.value || orderedLeaves(paneTree.value)[0];
  }
  if (!leaf) return;
  adoptingDeskMerge = true;
  try {
    if (onAdoptHost(job.sourceId, job.host, leaf, "right")) {
      app.clearDeskMerge();
    }
  } finally {
    adoptingDeskMerge = false;
  }
}

function detachFocused() {
  const id = focusedPaneId.value;
  if (orderedLeaves(paneTree.value).length < 2) {
    ElMessage.info("只有一个窗格，它已经是独立会话");
    return;
  }
  const s = sessions.value.find((x) => x.id === id);
  if (!s) return;
  const ctl = reconnectMap.get(id) || null;
  reconnectMap.delete(id);
  if (s.el) parkTermEl(s.el);
  sessions.value = sessions.value.filter((x) => x.id !== id);
  const host = s.host || hostOf(paneTree.value, id) || props.host;
  parkTermPane({ id, host, session: s, ctl });
  const next = removeLeaf(paneTree.value, id);
  if (!next) return;
  paneTree.value = next;
  focusedPaneId.value = orderedLeaves(next)[0] || "";
  syncMergedTitle();
  app.openDetachedDesk(host, id);
  ElMessage.success("已把这个窗格移成独立会话，连接没有重开");
}

async function closePane(id: string) {
  const owned = liveState(id);
  if (owned && owned.ownerDesk !== props.workspaceSessionId) return;
  const leaves = orderedLeaves(paneTree.value);
  if (!leaves.includes(id)) return;
  if (shouldCloseDeskOnLastPane(leaves.length)) {
    app.closeTerminalDesk(props.workspaceSessionId);
    return;
  }
  const victim = sessions.value.find((s) => s.id === id) || (sessionBody(id) as Session | undefined);
  if (victim) await destroySession(victim);
  sessions.value = sessions.value.filter((s) => s.id !== id);
  openingIds.delete(id);
  const nextTree = removeLeaf(paneTree.value, id);
  if (!nextTree) {
    app.closeTerminalDesk(props.workspaceSessionId);
    return;
  }
  paneTree.value = nextTree;
  syncMergedTitle();
  const remain = orderedLeaves(nextTree);
  const idx = leaves.indexOf(id);
  const fallback = remain[Math.max(0, idx - 1)] || remain[0] || "";
  zoomed.value = false;
  if (fallback) focusPane(fallback);
  scheduleFitAll();
  ElMessage.success("已关闭这个窗格，其它窗格的连接还在");
}

function gotoPane(side: PaneSide) {
  const next = neighborId(paneTree.value, focusedPaneId.value, side);
  if (!next) return;
  focusPane(next);
}

function cyclePane(dir: 1 | -1) {
  const ids = orderedLeaves(paneTree.value);
  if (ids.length < 2) return;
  const i = ids.indexOf(focusedPaneId.value);
  const next = ids[(i + dir + ids.length) % ids.length];
  focusPane(next);
}

function resizeFocused(side: PaneSide) {
  const hit = resizeHit(paneTree.value, focusedPaneId.value, side);
  if (!hit) return;
  const cur = splitRatioOf(paneTree.value, hit.splitId);
  if (cur == null) return;
  const el = stageRef.value?.querySelector(
    `[data-split-id="${hit.splitId}"]`
  ) as HTMLElement | null;
  const split = paneTree.value;
  let alongRow = true;
  if (el) {
    alongRow = el.classList.contains("is-row");
  } else if (split.kind === "split") {
    alongRow = split.dir === "row";
  }
  const size = el ? (alongRow ? el.clientWidth : el.clientHeight) : 400;
  const delta = (10 / Math.max(size, 40)) * hit.sign;
  paneTree.value = setRatio(paneTree.value, hit.splitId, cur + delta);
  scheduleFitAll();
}

function equalizeFocused() {
  paneTree.value = equalizeRatios(paneTree.value);
  scheduleFitAll();
}

function toggleZoom() {
  if (orderedLeaves(paneTree.value).length < 2) return;
  zoomed.value = !zoomed.value;
  scheduleFitAll();
  focusPane(focusedPaneId.value);
}

function isThisVisible(): boolean {
  return app.isTerminalDeskVisible(props.workspaceSessionId);
}

function focusInsideTerm(): boolean {
  const el = document.activeElement;
  if (!el || !(el instanceof Element)) return false;
  return !!el.closest(".term-page");
}

function eatKey(e: KeyboardEvent) {
  e.preventDefault();
  e.stopPropagation();
}

function arrowSide(e: KeyboardEvent): PaneSide | null {
  if (e.code === "ArrowLeft") return "left";
  if (e.code === "ArrowRight") return "right";
  if (e.code === "ArrowUp") return "up";
  if (e.code === "ArrowDown") return "down";
  return null;
}

const isMac = /Mac|iPhone|iPad/.test(navigator.platform);

function isChromeTyping(e: KeyboardEvent): boolean {
  const t = e.target;
  if (!(t instanceof HTMLElement)) return false;
  if (t.classList.contains("xterm-helper-textarea")) return false;
  return t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable;
}

function isTermTextareaFocused(): boolean {
  const el = document.activeElement;
  return !!(el instanceof HTMLElement && el.classList.contains("xterm-helper-textarea"));
}

function onTypeFallback(e: KeyboardEvent) {
  if (!isThisVisible()) return;
  if (e.isComposing || e.defaultPrevented) return;
  if (isChromeTyping(e)) return;
  if (isTermTextareaFocused()) return;
  const s = sessions.value.find((x) => x.id === focusedPaneId.value);
  if (!s) return;
  s.term.focus();
  const ctrl = ctrlLetter(e);
  if (ctrl) {
    e.preventDefault();
    e.stopPropagation();
    s.term.input(ctrl);
    return;
  }
  if (e.metaKey || e.ctrlKey) return;
  let data = "";
  if (e.key === "Enter") data = "\r";
  else if (e.key === "Backspace") data = "\x7f";
  else if (e.key === "Tab") data = "\t";
  else if (e.key === "Escape") data = "\x1b";
  else if (e.key.length === 1) data = e.key;
  else return;
  e.preventDefault();
  e.stopPropagation();
  s.term.input(data);
}

function onPaneKey(e: KeyboardEvent) {
  onTypeFallback(e);
  if (!isThisVisible() || !focusInsideTerm()) return;
  if (isMac) {
    onMacPaneKey(e);
    return;
  }
  onLinuxPaneKey(e);
}

function onMacPaneKey(e: KeyboardEvent) {
  if (!e.metaKey) return;
  const shift = e.shiftKey;
  const alt = e.altKey;
  const ctrl = e.ctrlKey;

  if (!ctrl && !alt && !shift && e.code === "KeyD") {
    eatKey(e);
    app.runTermAction("split-right");
    return;
  }
  if (!ctrl && !alt && shift && e.code === "KeyD") {
    eatKey(e);
    app.runTermAction("split-down");
    return;
  }
  if (!ctrl && alt && !shift) {
    const side = arrowSide(e);
    if (!side) return;
    eatKey(e);
    gotoPane(side);
    return;
  }
  if (!ctrl && !alt && !shift && e.code === "BracketLeft") {
    eatKey(e);
    cyclePane(-1);
    return;
  }
  if (!ctrl && !alt && !shift && e.code === "BracketRight") {
    eatKey(e);
    cyclePane(1);
    return;
  }
  if (ctrl && !alt && !shift) {
    const side = arrowSide(e);
    if (side) {
      eatKey(e);
      resizeFocused(side);
      return;
    }
    if (e.code === "Equal") {
      eatKey(e);
      equalizeFocused();
      return;
    }
  }
  if (!ctrl && !alt && shift && e.code === "Enter") {
    eatKey(e);
    toggleZoom();
    return;
  }
  if (!ctrl && !alt && !shift && e.code === "KeyW") {
    eatKey(e);
    app.runTermAction("close-pane");
  }
}

function onLinuxPaneKey(e: KeyboardEvent) {
  const ctrl = e.ctrlKey;
  const shift = e.shiftKey;
  const alt = e.altKey;
  const meta = e.metaKey;

  if (ctrl && shift && !meta && !alt && e.code === "KeyO") {
    eatKey(e);
    app.runTermAction("split-right");
    return;
  }
  if (ctrl && shift && !meta && !alt && e.code === "KeyE") {
    eatKey(e);
    app.runTermAction("split-down");
    return;
  }
  if (ctrl && alt && !meta && !shift) {
    const side = arrowSide(e);
    if (!side) return;
    eatKey(e);
    gotoPane(side);
    return;
  }
  if (ctrl && meta && !alt && !shift && e.code === "BracketLeft") {
    eatKey(e);
    cyclePane(-1);
    return;
  }
  if (ctrl && meta && !alt && !shift && e.code === "BracketRight") {
    eatKey(e);
    cyclePane(1);
    return;
  }
  if (ctrl && meta && shift && !alt) {
    const side = arrowSide(e);
    if (side) {
      eatKey(e);
      resizeFocused(side);
      return;
    }
    if (e.code === "Equal") {
      eatKey(e);
      equalizeFocused();
    }
    return;
  }
  if (ctrl && shift && !meta && !alt && e.code === "Enter") {
    eatKey(e);
    toggleZoom();
    return;
  }
  if (ctrl && shift && !meta && !alt && e.code === "KeyW") {
    eatKey(e);
    app.runTermAction("close-pane");
  }
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
function isPaneDrag(e: DragEvent): boolean {
  const types = e.dataTransfer?.types;
  if (!types) return false;
  for (const t of types) {
    if (t === "application/x-pane-id" || t === "application/x-term-session") return true;
  }
  return false;
}

function onDragEnter(e: DragEvent) {
  if (isPaneDrag(e)) return;
  dragCounter++;
  dragOver.value = true;
}
function onDragLeave(e: DragEvent) {
  if (isPaneDrag(e)) return;
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
    const host = hostOf(paneTree.value, focusedPaneId.value) || props.host;
    await api.uploadPaths(host, paths, [], TERM_UPLOAD_DIR);
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
  const active = sessions.value.find((s) => s.id === focusedPaneId.value);
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
  for (const t of list) {
    await destroySession(t);
  }
}

// 已有会话时收到 pending 命令：只写到当前焦点窗格
function flushPendingTerminalCmd(cmd: string | null | undefined) {
  if (!cmd) return;
  if (!app.isTerminalDeskVisible(props.workspaceSessionId)) return;
  const active = sessions.value.find((x) => x.id === focusedPaneId.value);
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

watch(
  () => !app.settingsOpen && app.isTerminalDeskVisible(props.workspaceSessionId),
  (vis) => {
    if (!vis) {
      offDrop?.();
      offDrop = null;
      for (const s of sessions.value) {
        dropWebgl(s);
        parkTermEl(s.el);
      }
      return;
    }
    if (!offDrop) offDrop = registerFileDrop(handleFileDrop);
    for (const s of sessions.value) {
      const slot = slots.get(s.id);
      if (slot && s.el.parentElement !== slot) slot.appendChild(s.el);
    }
    flushPendingTerminalCmd(pendingTerminalCmd.value || pendingCmdLocal);
    void nextTick(() => {
      requestAnimationFrame(() => {
        void settleRender().then(() => focusPane(focusedPaneId.value));
      });
    });
  },
  { immediate: true }
);

watch(
  () => app.termActionN,
  () => {
    if (!app.isTerminalDeskVisible(props.workspaceSessionId)) return;
    const name = app.termActionName;
    if (name === "split-right") splitFocused("right");
    if (name === "split-down") splitFocused("down");
    if (name === "close-pane") void closePane(focusedPaneId.value);
    if (name === "detach") detachFocused();
    if (name === "reconnect") reconnectAllPanes();
  }
);

watch(
  () => app.deskMergeN,
  () => {
    void tryAdoptPending();
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

function fitAll() {
  for (const s of sessions.value) {
    if (s.el.clientWidth < 2 || s.el.clientHeight < 2) continue;
    try {
      s.fit.fit();
      if (s.sessionID) {
        api
          .resizeTerminal(s.sessionID, s.term.cols, s.term.rows)
          .catch(() => {});
      }
    } catch {
      /* ignore */
    }
  }
  if (!app.isTerminalDeskVisible(props.workspaceSessionId)) return;
  for (const s of sessions.value) {
    const measured = measurePane(s.id);
    writeProbe(s.id, { ...measured, probed: true, hasLive: true });
  }
}

function onWinResize() {
  if (!app.isTerminalDeskVisible(props.workspaceSessionId)) return;
  fitAll();
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

function scheduleFitAll() {
  // 合并同帧多次尺寸抖动，避免 fit → resize PTY → 回流 的连环卡顿
  if (fitRaf) cancelAnimationFrame(fitRaf);
  fitRaf = requestAnimationFrame(() => {
    fitRaf = 0;
    fitAll();
  });
}

const fullscreenOffs: Array<() => void> = [];

let offDesk = () => {};

onMounted(() => {
  offDesk = registerTermDesk(props.workspaceSessionId, { takeAll: takeAllHandoff });
  void tryAdoptPending();
  app.registerTerminalReconnect(props.workspaceSessionId, reconnectAllPanes);
  window.addEventListener("resize", onWinResize);
  window.addEventListener("click", onDocClick);
  window.addEventListener("online", onNetworkOnline);
  window.addEventListener("keydown", onPaneKey, true);
  void Window.IsFullscreen().then((v) => {
    windowFullscreen.value = !!v;
  });
  fullscreenOffs.push(
    trackEvent(Events.Types.Common.WindowFullscreen, () => {
      windowFullscreen.value = true;
    })
  );
  fullscreenOffs.push(
    trackEvent(Events.Types.Common.WindowUnFullscreen, () => {
      windowFullscreen.value = false;
    })
  );
  fullscreenOffs.push(
    trackEvent(Events.Types.Mac.WindowDidEnterFullScreen, () => {
      windowFullscreen.value = true;
    })
  );
  fullscreenOffs.push(
    trackEvent(Events.Types.Mac.WindowDidExitFullScreen, () => {
      windowFullscreen.value = false;
    })
  );
  if (stageRef.value) {
    let lastW = 0;
    let lastH = 0;
    resizeObs = new ResizeObserver((entries) => {
      const cr = entries[0]?.contentRect;
      if (!cr) return;
      const w = Math.round(cr.width);
      const h = Math.round(cr.height);
      if (w === lastW && h === lastH) return;
      lastW = w;
      lastH = h;
      scheduleFitAll();
    });
    resizeObs.observe(stageRef.value);
  }
  offProgress = trackEvent(
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
  void nextTick(() => {
    requestAnimationFrame(() => {
      void settleRender().then(() => focusPane(focusedPaneId.value));
    });
  });
});

// KeepAlive 失活（切到其它子页签）：退出拖放栈，避免拦截文件页拖拽
onDeactivated(() => {
  offDrop?.();
  offDrop = null;
});

onBeforeUnmount(() => {
  offDesk();
  app.registerTerminalReconnect(props.workspaceSessionId, null);
  if (fitRaf) {
    cancelAnimationFrame(fitRaf);
    fitRaf = 0;
  }
  resizeObs?.disconnect();
  resizeObs = null;
  window.removeEventListener("resize", onWinResize);
  window.removeEventListener("click", onDocClick);
  window.removeEventListener("online", onNetworkOnline);
  window.removeEventListener("keydown", onPaneKey, true);
  window.removeEventListener("beforeunload", flushWorkspaceLayout);
  for (const off of fullscreenOffs) off();
  fullscreenOffs.length = 0;
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
  const deskLives = app.terminalDesks.some((d) => d.id === props.workspaceSessionId);
  if (deskLives) {
    for (const item of takeAllHandoff()) parkTermPane(item);
  } else {
    void teardownAll();
  }
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

.term-stage {
  position: relative;
  flex: 1 1 auto;
  min-height: 0;
  min-width: 0;
  display: flex;
  flex-direction: column;

  > :deep(*) {
    flex: 1 1 auto;
    min-width: 0;
    min-height: 0;
  }

  &.is-vtabs {
    flex-direction: row;
  }

  &.is-vtabs > .term-vlist {
    flex: 0 0 220px;
  }
}

.term-park {
  display: none;
}

.term-vlist {
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: #111;
  border-right: 1px solid #2a2a2a;
  overflow: auto;
}

.term-vlist__title {
  flex-shrink: 0;
  padding: 10px 12px 6px;
  color: #9a9a9a;
  font-size: 12px;
}

.term-vitem {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 8px 12px;
  border: 0;
  background: transparent;
  color: #e8e8e8;
  text-align: left;
  cursor: pointer;

  &:hover {
    background: rgba(255, 255, 255, 0.04);
  }

  &.is-active {
    background: rgba(255, 255, 255, 0.08);
  }
}

.term-vitem__text {
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.term-vitem__host {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
}

.term-vitem__sub {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: #9a9a9a;
  font-size: 11px;
}

.term-vitem__re {
  flex-shrink: 0;
  margin-left: auto;
  width: 18px;
  height: 18px;
  line-height: 18px;
  text-align: center;
  border-radius: 4px;
  color: #9a9a9a;
  font-size: 14px;

  &:hover,
  &.is-down {
    color: #fff;
    background: rgba(255, 255, 255, 0.08);
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
  top: 12px;
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
  min-height: 28px;
  padding: 4px 8px;
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

.ctx-sep {
  height: 1px;
  margin: 4px 8px;
  background: var(--m3-outline-variant);
}

.ctx-item--sub {
  padding-left: 28px;
  color: var(--m3-on-surface-variant);
}

.ctx-item--danger {
  color: var(--m3-error);
}
</style>
