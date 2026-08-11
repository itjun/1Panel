<template>
  <div class="term-root">
    <!-- 会话标签：深色工具条，与上方「概览/进程/终端」模块 Tab 明确分层 -->
    <div class="term-bar">
      <div class="term-tabs" role="tablist" aria-label="终端会话">
        <button
          v-for="(t, idx) in sessions"
          :key="t.id"
          type="button"
          role="tab"
          class="term-tab"
          :class="{ active: t.id === activeId, closed: t.closed }"
          :aria-selected="t.id === activeId"
          @click="activate(t.id)"
        >
          <span class="tab-label">会话 {{ idx + 1 }}</span>
          <span v-if="t.closed" class="tab-closed">已断开</span>
          <span
            class="tab-close"
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
          <el-icon :size="14"><Plus /></el-icon>
        </button>
      </div>
      <div class="term-bar__meta">{{ host }}</div>
    </div>

    <div
      ref="containerRef"
      class="term-body"
      @contextmenu.prevent
    />

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
</template>

<script setup lang="ts">
/**
 * 终端 Tab：移植自 frontend-react TerminalTab。
 * 后端 OpenTerminal / WriteTerminal / ResizeTerminal / CloseTerminal 已就绪；
 * 此处用 xterm.js + Wails EventsOn 接 PTY 输出。
 */
import {
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  shallowRef,
  watch,
} from "vue";
import { Plus } from "@element-plus/icons-vue";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";
import { EventsOff, EventsOn } from "@wailsjs/runtime/runtime";
import { api } from "@/api";
import { useAppStore } from "@/stores/app";
import { useSettingsStore } from "@/stores/settings";
import { storeToRefs } from "pinia";

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

interface Session {
  id: string;
  sessionID: string;
  eventName: string;
  term: XTerm;
  fit: FitAddon;
  closed: boolean;
  el: HTMLDivElement;
}

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


function patchSession(id: string, patch: Partial<Session>) {
  sessions.value = sessions.value.map((s) =>
    s.id === id ? { ...s, ...patch } : s
  );
}

async function openNew() {
  const container = containerRef.value;
  if (!container || opening) return;
  opening = true;

  const id = `term-${Date.now()}-${seq++}`;
  const eventName = `term:${id}`;

  const term = new XTerm({
    cursorBlink: true,
    fontSize: terminalFontSize.value || 13,
    fontFamily: resolveTermFontFamily(),
    rightClickSelectsWord: false,
    theme: {
      background: "#0a0a0a",
      foreground: "#e4e4e7",
      cursor: "#e4e4e7",
      selectionBackground: "#3f3f46",
      black: "#0a0a0a",
      red: "#ef4444",
      green: "#22c55e",
      yellow: "#eab308",
      blue: "#3b82f6",
      magenta: "#a855f7",
      cyan: "#06b6d4",
      white: "#e4e4e7",
      brightBlack: "#52525b",
      brightRed: "#f87171",
      brightGreen: "#4ade80",
      brightYellow: "#facc15",
      brightBlue: "#60a5fa",
      brightMagenta: "#c084fc",
      brightCyan: "#22d3ee",
      brightWhite: "#fafafa",
    },
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

  await new Promise<void>((r) => requestAnimationFrame(() => r()));
  try {
    fit.fit();
  } catch {
    /* ignore */
  }
  let cols = term.cols || 80;
  let rows = term.rows || 24;
  if (cols < 20) cols = 80;
  if (rows < 5) rows = 24;

  let sessionID = "";
  try {
    sessionID = await api.openTerminal(props.host, eventName, cols, rows);
  } catch (e) {
    term.write(`\x1b[31m连接失败: ${e}\x1b[0m\r\n`);
  }

  if (sessionID) {
    try {
      fit.fit();
      if (term.cols !== cols || term.rows !== rows) {
        await api.resizeTerminal(sessionID, term.cols, term.rows);
      }
    } catch {
      /* ignore */
    }
    term.onResize(({ cols: c, rows: r }) => {
      api.resizeTerminal(sessionID, c, r).catch(() => {});
    });
  }

  EventsOn(eventName, (payload: { data?: string }) => {
    if (payload?.data) term.write(payload.data);
  });
  EventsOn(`${eventName}:exit`, () => {
    term.write("\r\n\x1b[33m[连接已关闭]\x1b[0m\r\n");
    patchSession(id, { closed: true });
  });

  // 输入：普通按键合并，控制字符立即发
  const sessionIDRef = sessionID;
  let inputBuf = "";
  let flushScheduled = false;
  const flushInput = () => {
    flushScheduled = false;
    if (inputBuf && sessionIDRef) {
      api.writeTerminal(sessionIDRef, inputBuf).catch(() => {});
      inputBuf = "";
    }
  };
  term.onData((d) => {
    if (!sessionIDRef) return;
    inputBuf += d;
    if (!flushScheduled) {
      flushScheduled = true;
      if (d === "\r" || d === "\n" || d.charCodeAt(0) < 32) {
        flushInput();
      } else {
        setTimeout(flushInput, 0);
      }
    }
  });

  el.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    e.stopPropagation();
    const sel = term.getSelection();
    ctxMenu.value = {
      x: e.clientX,
      y: e.clientY,
      sessionID: sessionIDRef,
      term,
      hasSelection: !!sel && sel.length > 0,
    };
  });

  const tab: Session = {
    id,
    sessionID,
    eventName,
    term,
    fit,
    closed: false,
    el,
  };
  sessions.value = [...sessions.value, tab];
  activeId.value = id;
  term.focus();
  opening = false;

  // 若有待执行命令（如软件包「检查更新」），连接后稍等再写入
  const pending = pendingTerminalCmd.value || pendingCmdLocal;
  if (sessionID && pending) {
    pendingCmdLocal = null;
    app.clearTerminalCmd();
    const cmd = pending;
    setTimeout(() => {
      api.writeTerminal(sessionID, cmd + "\n").catch(() => {});
    }, 1200);
  }
}

async function destroySession(t: Session) {
  if (t.sessionID) {
    try {
      await api.closeTerminal(t.sessionID);
    } catch {
      /* ignore */
    }
  }
  EventsOff(t.eventName);
  EventsOff(`${t.eventName}:exit`);
  try {
    t.term.dispose();
  } catch {
    /* ignore */
  }
}

async function closeSession(id: string) {
  const t = sessions.value.find((x) => x.id === id);
  if (!t) return;
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
watch(pendingTerminalCmd, (cmd) => {
  if (!cmd) return;
  const active = sessions.value.find((x) => x.id === activeId.value);
  if (active?.sessionID) {
    const c = cmd;
    app.clearTerminalCmd();
    setTimeout(() => {
      api.writeTerminal(active.sessionID, c + "\n").catch(() => {});
    }, 300);
  } else {
    pendingCmdLocal = cmd;
  }
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
    const size = terminalFontSize.value || 13;
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

function onWinResize() {
  const active = sessions.value.find((x) => x.id === activeId.value);
  if (!active) return;
  try {
    active.fit.fit();
  } catch {
    /* ignore */
  }
}

function onDocClick() {
  ctxMenu.value = null;
}

onMounted(() => {
  window.addEventListener("resize", onWinResize);
  window.addEventListener("click", onDocClick);
  // 等容器布局稳定再开
  setTimeout(() => {
    if (sessions.value.length === 0) void openNew();
  }, 50);
});

onBeforeUnmount(() => {
  window.removeEventListener("resize", onWinResize);
  window.removeEventListener("click", onDocClick);
  void teardownAll();
});
</script>

<style scoped lang="scss">
.term-root {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  width: 100%;
  height: 100%;
  min-height: 0;
  min-width: 0;
  background: #0d0d0d;
  /* 盖住 content-pad 的浅色底，避免「白条夹在 Tab 与终端之间」 */
  overflow: hidden;
}

.term-bar {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 36px;
  padding: 0 10px 0 8px;
  background: #161616;
  border-bottom: 1px solid #2a2a2a;
  box-sizing: border-box;
}

.term-tabs {
  display: flex;
  flex-wrap: nowrap;
  align-items: center;
  gap: 4px;
  min-width: 0;
  flex: 1;
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: thin;

  &::-webkit-scrollbar {
    height: 4px;
  }
  &::-webkit-scrollbar-thumb {
    background: #3a3a3a;
    border-radius: 2px;
  }
}

.term-tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 8px 0 12px;
  border: none;
  border-radius: 6px 6px 0 0;
  background: transparent;
  color: #9ca3af;
  font-size: 12px;
  line-height: 1;
  cursor: pointer;
  white-space: nowrap;
  flex-shrink: 0;
  transition: background 0.12s, color 0.12s;

  &:hover {
    color: #e5e7eb;
    background: #222;
  }
  &.active {
    color: #f3f4f6;
    background: #0d0d0d;
    box-shadow: inset 0 -2px 0 var(--el-color-primary, #005eeb);
  }
  &.closed .tab-label {
    opacity: 0.55;
    text-decoration: line-through;
  }

  &--add {
    width: 28px;
    padding: 0;
    justify-content: center;
    border-radius: 6px;
    color: #9ca3af;

    &:hover {
      color: #fff;
      background: #2a2a2a;
    }
  }
}

.term-bar__meta {
  flex-shrink: 0;
  font-size: 11px;
  color: #6b7280;
  font-variant-numeric: tabular-nums;
  max-width: 40%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tab-label {
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tab-closed {
  font-size: 10px;
  color: #fbbf24;
}

.tab-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  margin-left: 2px;
  border-radius: 4px;
  font-size: 14px;
  line-height: 1;
  opacity: 0.45;
  color: inherit;

  &:hover {
    opacity: 1;
    background: rgba(255, 255, 255, 0.1);
  }
}

.term-body {
  position: relative;
  flex: 1 1 auto;
  min-height: 0;
  min-width: 0;
  overflow: hidden;
  border: none;
  border-radius: 0;
  background: #0d0d0d;
  /* xterm 选中文本可复制 */
  user-select: text;

  /* xterm 填满容器 */
  :deep(.xterm),
  :deep(.xterm-viewport),
  :deep(.xterm-screen) {
    height: 100%;
  }
  :deep(.xterm) {
    padding: 4px 8px 8px;
    box-sizing: border-box;
  }
}

.term-ctx {
  position: fixed;
  z-index: 3000;
  min-width: 140px;
  padding: 4px;
  border-radius: 6px;
  border: 1px solid var(--el-border-color);
  background: var(--el-bg-color-overlay, #fff);
  box-shadow: var(--el-box-shadow-light);
}

.ctx-item {
  display: flex;
  align-items: center;
  width: 100%;
  padding: 6px 10px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--el-text-color-primary);
  font-size: 12px;
  text-align: left;
  cursor: pointer;

  &:hover:not(:disabled) {
    background: var(--el-fill-color-light);
  }
  &:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
}

.ctx-kbd {
  margin-left: auto;
  padding-left: 12px;
  font-size: 10px;
  color: var(--el-text-color-secondary);
}
</style>
