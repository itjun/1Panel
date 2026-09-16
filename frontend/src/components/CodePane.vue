<template>
  <div class="code-pane">
    <div class="code-tools">
      <div v-if="searchOpen" class="code-search">
        <input
          ref="searchInputRef"
          v-model="query"
          class="code-search-input"
          type="text"
          placeholder="搜索内容…"
          spellcheck="false"
          autocomplete="off"
          aria-label="搜索文本内容"
          @keydown.enter.prevent="onEnter"
          @keydown.esc.prevent="onEsc"
        />
        <span class="code-search-count">{{ countLabel }}</span>
        <button
          type="button"
          class="code-search-btn"
          v-tip="'上一个匹配 (Shift+Enter)'"
          aria-label="上一个匹配"
          :disabled="!matchCount"
          @click="stepMatch(-1)"
        >
          <el-icon :size="13"><ArrowUp /></el-icon>
        </button>
        <button
          type="button"
          class="code-search-btn"
          v-tip="'下一个匹配 (Enter)'"
          aria-label="下一个匹配"
          :disabled="!matchCount"
          @click="stepMatch(1)"
        >
          <el-icon :size="13"><ArrowDown /></el-icon>
        </button>
        <button
          type="button"
          class="code-search-btn"
          v-tip="'关闭搜索 (Esc)'"
          aria-label="关闭搜索"
          @click="closeSearch"
        >
          <el-icon :size="13"><Close /></el-icon>
        </button>
      </div>
      <button
        v-if="searchable && !searchOpen"
        type="button"
        class="code-copy"
        v-tip="'搜索 (Ctrl+F)'"
        aria-label="搜索文本内容"
        @click="openSearch"
      >
        <el-icon :size="15"><Search /></el-icon>
      </button>
      <button
        v-if="text"
        type="button"
        class="code-copy"
        :class="{ 'is-copied': copied }"
        v-tip="copied ? '已复制' : '复制'"
        :aria-label="copied ? '已复制' : '复制'"
        @click="copyContent"
      >
        <el-icon :size="15"><Check v-if="copied" /><CopyDocument v-else /></el-icon>
      </button>
    </div>
    <pre ref="preRef" class="code-pre" tabindex="-1" v-html="html"></pre>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { ElMessage } from "element-plus";
import {
  ArrowDown,
  ArrowUp,
  Check,
  Close,
  CopyDocument,
  Search,
} from "@element-plus/icons-vue";
import { copyText } from "@/utils/clipboard";

const props = withDefaults(
  defineProps<{
    /* 已处理好的安全 HTML（含行级 .ng-line 包装），直接 v-html */
    html: string;
    /* 复制用的原始文本（不含行号），为空则不显示复制按钮 */
    text?: string;
    /* 是否提供文本内搜索（搜索栏 + Ctrl+F + 匹配跳转） */
    searchable?: boolean;
  }>(),
  { text: "", searchable: false }
);

/* ============ 复制 ============ */
/* 复制原始文本，成功后图标短暂变对勾 */
const copied = ref(false);
let copiedTimer: number | undefined;

async function copyContent() {
  try {
    await copyText(props.text);
    copied.value = true;
    window.clearTimeout(copiedTimer);
    copiedTimer = window.setTimeout(() => (copied.value = false), 1600);
  } catch {
    ElMessage.error("复制失败");
  }
}

/* ============ 文本内搜索 ============ */
/* v-html 由外部生成（含语法高亮 span），无法用模板插匹配标记；
   改为渲染后遍历 pre 的文本节点：拼接全文求偏移、倒序拆分包裹 <mark>，
   可正确处理跨 span 的匹配（等价浏览器 Ctrl+F）。 */
const preRef = ref<HTMLPreElement | null>(null);
const searchInputRef = ref<HTMLInputElement | null>(null);
const searchOpen = ref(false);
const query = ref("");
const matchCount = ref(0);
/* 当前命中序号（1 起） */
const matchIndex = ref(0);

const MAX_MATCHES = 5000;
const APPLY_DEBOUNCE_MS = 180;
let applyTimer: number | undefined;

const countLabel = computed(() => {
  if (!query.value.trim()) return "";
  if (!matchCount.value) return "0";
  if (matchCount.value >= MAX_MATCHES) return `${matchIndex.value}/${matchCount.value}+`;
  return `${matchIndex.value}/${matchCount.value}`;
});

function openSearch() {
  if (searchOpen.value) {
    searchInputRef.value?.focus();
    searchInputRef.value?.select();
    return;
  }
  searchOpen.value = true;
  nextTick(() => {
    searchInputRef.value?.focus();
  });
}

function closeSearch() {
  searchOpen.value = false;
  query.value = "";
  applySearch();
}

function onEnter(e: KeyboardEvent) {
  if (e.isComposing) return;
  stepMatch(e.shiftKey ? -1 : 1);
}

function onEsc(e: KeyboardEvent) {
  if (e.isComposing) return;
  closeSearch();
}

/* dir: 1 下一个 / -1 上一个，循环跳转 */
function stepMatch(dir: 1 | -1) {
  const total = matchCount.value;
  if (!total) return;
  let idx = matchIndex.value + dir;
  if (idx < 1) idx = total;
  if (idx > total) idx = 1;
  matchIndex.value = idx;
  highlightCurrent(true);
}

function scheduleApply() {
  window.clearTimeout(applyTimer);
  applyTimer = window.setTimeout(() => {
    applyTimer = undefined;
    applySearch();
  }, APPLY_DEBOUNCE_MS);
}

/* 拆掉全部 <mark> 还原 DOM（normalize 合并被拆分的文本节点） */
function clearMarks(pre: HTMLElement) {
  const marks = Array.from(pre.querySelectorAll("mark.ng-hit"));
  for (const m of marks) {
    const parent = m.parentNode;
    if (!parent) continue;
    while (m.firstChild) parent.insertBefore(m.firstChild, m);
    parent.removeChild(m);
    parent.normalize();
  }
}

/* 把文本节点 node 的 [ls, le) 片段包进 <mark> */
function wrapMatch(node: Text, ls: number, le: number) {
  if (ls >= le) return;
  if (le < node.data.length) node.splitText(le);
  const mid = ls > 0 ? node.splitText(ls) : node;
  const mark = document.createElement("mark");
  mark.className = "ng-hit";
  mid.parentNode?.insertBefore(mark, mid);
  mark.appendChild(mid);
}

function applySearch() {
  const pre = preRef.value;
  if (!pre) return;
  clearMarks(pre);
  matchCount.value = 0;
  const q = query.value.trim();
  if (!q) {
    matchIndex.value = 0;
    return;
  }
  if (matchIndex.value < 1) matchIndex.value = 1;

  /* 按文档序收集全部文本节点，拼接全文并记录各节点区间 */
  const walker = document.createTreeWalker(pre, NodeFilter.SHOW_TEXT);
  const texts: Text[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) texts.push(n as Text);
  if (!texts.length) return;
  let combined = "";
  const spans = texts.map((node) => {
    const start = combined.length;
    combined += node.data;
    return { node, start, end: start + node.data.length };
  });

  /* 不区分大小写、不重叠匹配，封顶防大文件卡顿 */
  const hay = combined.toLowerCase();
  const needle = q.toLowerCase();
  const starts: number[] = [];
  let pos = 0;
  while (starts.length < MAX_MATCHES) {
    const found = hay.indexOf(needle, pos);
    if (found === -1) break;
    starts.push(found);
    pos = found + needle.length;
  }
  matchCount.value = starts.length;
  if (!starts.length) return;
  if (matchIndex.value > matchCount.value) matchIndex.value = 1;

  /* 倒序包裹：拆分节点只影响后方偏移，先包后面的匹配保前面偏移有效 */
  for (let mi = starts.length - 1; mi >= 0; mi--) {
    const s = starts[mi];
    const e = s + needle.length;
    for (let ri = spans.length - 1; ri >= 0; ri--) {
      const sp = spans[ri];
      if (sp.end <= s) break;
      if (sp.start >= e) continue;
      const ls = Math.max(s - sp.start, 0);
      const le = Math.min(e - sp.start, sp.node.data.length);
      wrapMatch(sp.node, ls, le);
    }
  }
  highlightCurrent(true);
}

/* 标记当前命中并滚动定位 */
function highlightCurrent(scroll: boolean) {
  const pre = preRef.value;
  if (!pre) return;
  const marks = pre.querySelectorAll<HTMLElement>("mark.ng-hit");
  marks.forEach((m) => m.classList.remove("is-current"));
  if (!matchCount.value) return;
  const cur = marks[Math.min(matchIndex.value, marks.length) - 1];
  if (cur) {
    cur.classList.add("is-current");
    if (scroll) cur.scrollIntoView({ block: "center", inline: "nearest" });
  }
}

/* 输入变化：回到第 1 个命中，防抖后重新标记 */
watch(query, () => {
  matchIndex.value = 1;
  scheduleApply();
});

/* html 变化（换文件/转换格式）后 v-html 重挂载会丢掉标记，需重新应用 */
watch(
  () => props.html,
  async () => {
    if (!searchOpen.value || !query.value.trim()) return;
    await nextTick();
    applySearch();
  }
);

/* 捕获阶段拦截：Esc 只关搜索条，不能冒泡给 el-drawer 关掉抽屉；
   中文输入法组合中的 Esc/Enter 不处理 */
function onGlobalKeydown(e: KeyboardEvent) {
  if ((e.ctrlKey || e.metaKey) && (e.key === "f" || e.key === "F")) {
    e.preventDefault();
    openSearch();
  } else if (e.key === "Escape" && searchOpen.value && !e.isComposing) {
    e.stopPropagation();
    closeSearch();
  }
}

onMounted(() => {
  if (props.searchable)
    window.addEventListener("keydown", onGlobalKeydown, { capture: true });
});

onBeforeUnmount(() => {
  window.removeEventListener("keydown", onGlobalKeydown, { capture: true });
  window.clearTimeout(applyTimer);
  window.clearTimeout(copiedTimer);
});
</script>

<!-- v-html 内容不吃 scoped，需全局样式；统一以 .code-pane 前缀隔离 -->
<style lang="scss">
.code-pane {
  position: relative;
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  min-height: 0;

  .code-tools {
    position: absolute;
    top: 10px;
    right: 12px;
    z-index: 2;
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .code-copy {
    width: 30px;
    height: 30px;
    display: flex;
    align-items: center;
    justify-content: center;
    border: 1px solid rgba(248, 248, 242, 0.25);
    border-radius: var(--m3-shape-s);
    background: rgba(255, 255, 255, 0.08);
    color: #f8f8f2;
    opacity: 0.6;
    cursor: pointer;
    box-sizing: border-box;
    transition: opacity var(--m3-motion-state),
      background-color var(--m3-motion-state), color var(--m3-motion-state),
      border-color var(--m3-motion-state);

    &:hover {
      opacity: 1;
      background: rgba(255, 255, 255, 0.18);
    }

    &.is-copied {
      opacity: 1;
      color: #a6e22e;
      border-color: rgba(166, 226, 46, 0.45);
    }
  }

  /* 文本内搜索条（深色浮层，覆盖在代码上方） */
  .code-search {
    display: flex;
    align-items: center;
    gap: 4px;
    height: 30px;
    padding: 0 6px;
    border: 1px solid rgba(248, 248, 242, 0.25);
    border-radius: var(--m3-shape-s);
    background: rgba(13, 13, 15, 0.95);
    backdrop-filter: blur(6px);
  }

  .code-search-input {
    width: 150px;
    height: 100%;
    border: none;
    outline: none;
    background: transparent;
    color: #f8f8f2;
    font-size: 12px;
    font-family: var(--m3-font-mono);

    &::placeholder {
      color: rgba(248, 248, 242, 0.4);
    }
  }

  .code-search-count {
    min-width: 44px;
    text-align: center;
    font-size: 11px;
    line-height: 1;
    color: #a1a1aa;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  .code-search-btn {
    width: 22px;
    height: 22px;
    display: flex;
    align-items: center;
    justify-content: center;
    border: none;
    border-radius: 4px;
    background: transparent;
    color: #c8c8cd;
    cursor: pointer;
    transition: background-color var(--m3-motion-state),
      color var(--m3-motion-state);

    &:hover:not(:disabled) {
      background: rgba(255, 255, 255, 0.14);
      color: #ffffff;
    }

    &:disabled {
      opacity: 0.4;
      cursor: default;
    }
  }

  .code-pre {
    margin: 0;
    flex: 1;
    height: 100%;
    min-height: 0;
    padding: 16px 20px;
    overflow: auto;
    box-sizing: border-box;
    font-family: var(--m3-font-mono);
    font-size: 15px;
    line-height: 1.5;
    white-space: pre;
    word-break: normal;
    background: #000000;
    color: #f8f8f2;
    user-select: text;
    cursor: text;
    outline: none;
    counter-reset: ngline;
  }

  .code-pre .ng-line {
    display: block;
    counter-increment: ngline;

    &::before {
      content: counter(ngline);
      display: inline-block;
      min-width: 3.5em;
      padding-right: 18px;
      margin-right: 10px;
      text-align: right;
      color: #49483e;
      font-weight: 400;
      font-variant-numeric: tabular-nums;
      user-select: none;
    }
  }

  /* 搜索命中标记：全部命中淡黄，当前命中橙底深字 */
  .code-pre mark.ng-hit {
    background: rgba(255, 213, 79, 0.3);
    color: inherit;
    border-radius: 2px;

    &.is-current {
      background: #ffb300;
      color: #1a1a1a;
    }
  }

  /* 固定黑底 Monokai 色板（对齐终端，跨亮暗主题不变） */
  .code-pre .hljs-comment,
  .code-pre .hljs-quote,
  .code-pre .raw-comment {
    color: #75715e;
    font-style: italic;
  }

  .code-pre .hljs-keyword,
  .code-pre .hljs-selector-tag,
  .code-pre .hljs-literal,
  .code-pre .hljs-variable {
    color: #f92672;
  }

  .code-pre .hljs-section,
  .code-pre .hljs-attribute,
  .code-pre .hljs-built_in,
  .code-pre .hljs-builtin-name,
  .code-pre .hljs-type,
  .code-pre .hljs-selector-class,
  .code-pre .hljs-selector-attr,
  .code-pre .hljs-selector-pseudo,
  .code-pre .hljs-symbol {
    color: #66d9ef;
  }

  .code-pre .hljs-string,
  .code-pre .hljs-title,
  .code-pre .hljs-name,
  .code-pre .hljs-selector-id,
  .code-pre .hljs-template-tag,
  .code-pre .hljs-addition {
    color: #a6e22e;
  }

  .code-pre .hljs-number,
  .code-pre .hljs-meta,
  .code-pre .hljs-bullet,
  .code-pre .hljs-link {
    color: #ae81ff;
  }

  .code-pre .hljs-params,
  .code-pre .hljs-attr {
    color: #fd971f;
  }

  .code-pre .hljs-regexp,
  .code-pre .hljs-deletion {
    color: #f92672;
  }
}
</style>
