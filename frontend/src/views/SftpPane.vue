<template>
  <section
    class="pane"
    :class="{ 'is-remote': side === 'remote' }"
    tabindex="0"
    @keydown="onKey"
  >
    <header class="bar">
      <span class="title">
        <svg v-if="side === 'local'" class="title-icon" viewBox="0 0 24 24" aria-hidden="true">
          <rect x="3" y="4" width="18" height="12" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.6" />
          <path d="M8 20h8M12 16v4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
        </svg>
        <span class="title-text">{{ title }}</span>
      </span>
      <label class="filter">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" stroke-width="1.8" />
          <path d="M16 16l4 4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
        </svg>
        <input v-model="filter" type="text" placeholder="筛选" @keydown.stop />
      </label>
      <div class="actions">
        <button type="button" class="ghost" @click.stop="menuOpen = !menuOpen">
          操作
          <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2 4l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" /></svg>
        </button>
        <div v-if="menuOpen" class="menu-back" @mousedown="menuOpen = false" />
        <div v-if="menuOpen" class="menu" @mousedown.stop>
          <button type="button" :disabled="!canOpen" @click="runMenu('open')">打开</button>
          <button type="button" :disabled="!selected.length" @click="runMenu('send')">传到对面</button>
          <button v-if="canRemove" type="button" class="danger" :disabled="!selected.length" @click="runMenu('remove')">删除</button>
          <div class="menu-div" />
          <button type="button" @click="runMenu('refresh')">刷新</button>
          <button type="button" @click="runMenu('hidden')">
            {{ showHidden ? "不显示隐藏文件" : "显示隐藏文件" }}
          </button>
          <button type="button" :disabled="!shown.length" @click="runMenu('all')">全选</button>
        </div>
      </div>
    </header>

    <div class="nav">
      <button type="button" class="icon-btn" :disabled="!canBack" title="后退" @click="emit('back')">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 6l-6 6 6 6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" /></svg>
      </button>
      <button type="button" class="icon-btn" :disabled="!canForward" title="前进" @click="emit('forward')">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" /></svg>
      </button>
      <button
        type="button"
        class="icon-btn"
        :disabled="!homePath"
        title="用户根目录"
        @click="go(homePath || '')"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 11.2 12 4.5l8 6.7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
          <path d="M6 10.5V19a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-8.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </button>
      <div v-if="editing" class="crumbs is-editing">
        <input
          ref="pathInput"
          v-model="draft"
          class="path-input"
          spellcheck="false"
          @click.stop
          @mousedown.stop
          @keydown.enter.prevent="commitPath"
          @keydown.esc.prevent="cancelEdit"
          @blur="commitPath"
        />
      </div>
      <div v-else class="crumbs" title="点击上级目录直接进入，点击空白处可输入路径" @mousedown="startEdit">
        <button type="button" class="crumb" @mousedown.stop.prevent="go(rootPath)">
          <svg class="crumb-icon" viewBox="0 0 24 24" aria-hidden="true">
            <path fill="#4C8DFF" d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z" />
          </svg>
          根目录
        </button>
        <template v-for="(seg, i) in segments" :key="seg.path">
          <span class="sep">›</span>
          <button
            type="button"
            class="crumb"
            :class="{ 'is-here': i === segments.length - 1 }"
            @mousedown.stop.prevent="onSeg(seg.path, i)"
          >
            <svg class="crumb-icon" viewBox="0 0 24 24" aria-hidden="true">
              <path fill="#4C8DFF" d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z" />
            </svg>
            {{ seg.name }}
          </button>
        </template>
      </div>
    </div>

    <p v-if="error" class="err">{{ error }}</p>

    <div
      class="list-wrap"
      v-bind="side === 'remote' ? { 'data-file-drop-target': '' } : {}"
      @dragenter="onDragEnter"
      @dragover="onDragOver"
      @dragleave="onDragLeave"
      @drop="onDrop($event, cwd)"
    >
      <div v-if="loading" class="loading-bar" />
      <div class="cols">
        <button type="button" class="col" @click="toggleSort('name')">
          名称 <i v-if="sortKey === 'name'">{{ sortAsc ? "↑" : "↓" }}</i>
        </button>
        <button type="button" class="col" @click="toggleSort('time')">
          修改时间 <i v-if="sortKey === 'time'">{{ sortAsc ? "↑" : "↓" }}</i>
        </button>
        <button type="button" class="col num" @click="toggleSort('size')">
          大小 <i v-if="sortKey === 'size'">{{ sortAsc ? "↑" : "↓" }}</i>
        </button>
        <button type="button" class="col" @click="toggleSort('kind')">
          类型 <i v-if="sortKey === 'kind'">{{ sortAsc ? "↑" : "↓" }}</i>
        </button>
        <span class="col fill" aria-hidden="true" />
      </div>
      <div ref="rowsEl" class="rows" @contextmenu.prevent="openCtx" @click="clearSel">
        <div v-if="!loading && shown.length === 0" class="empty">
          {{ emptyText }}
        </div>
        <div
          v-for="(e, index) in shown"
          :key="e.path"
          class="row"
          :data-path="e.path"
          :class="{
            'is-sel': selected.includes(e.path),
            'is-drop': hoverDir === e.path,
            'is-drag': dragging.includes(e.path),
            'is-dot': e.name.startsWith('.'),
          }"
          draggable="true"
          @click.stop="onRowClick(e, index, $event)"
          @dblclick="onOpen(e)"
          @contextmenu.prevent.stop="onContext($event, e, index)"
          @dragstart="onDragStart($event, e)"
          @dragend="onDragFinish"
          @dragover="onRowDragOver($event, e)"
          @drop.stop="onDrop($event, e.isDir ? e.path : cwd)"
        >
          <div class="name-cell">
            <svg v-if="e.isDir" class="ficon" viewBox="0 0 24 24" aria-hidden="true">
              <path fill="#4C8DFF" d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z" />
            </svg>
            <svg v-else class="ficon" viewBox="0 0 24 24" aria-hidden="true">
              <path fill="#F7F8FA" stroke="#C5CDD6" stroke-width="1.2" d="M14 2.6H6.2A1.8 1.8 0 0 0 4.4 4.4v15.2a1.8 1.8 0 0 0 1.8 1.8h11.6a1.8 1.8 0 0 0 1.8-1.8V8.2L14 2.6z" />
              <path fill="#E4E9EE" d="M14 2.6v5.6h5.6" />
            </svg>
            <div class="name-text">
              <span class="name">{{ e.name }}</span>
              <span v-if="e.mode" class="mode">{{ e.mode }}</span>
            </div>
          </div>
          <span class="cell time">{{ e.modTime || "—" }}</span>
          <span class="cell num">{{ e.isDir ? "—" : formatBytes(e.size) }}</span>
          <span class="cell kind">{{ kindOf(e) }}</span>
          <span class="cell fill" aria-hidden="true" />
        </div>
      </div>

      <div class="drop-veil" :class="{ 'is-on': hot }">
        <span class="brk tl" />
        <span class="brk tr" />
        <span class="brk bl" />
        <span class="brk br" />
        <div class="mark">
          <svg viewBox="0 0 48 48" aria-hidden="true">
            <path d="M24 6v16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" />
            <path d="M16 16l8 8 8-8" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" />
            <path d="M10 28h28v8a4 4 0 0 1-4 4H14a4 4 0 0 1-4-4v-8z" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round" />
          </svg>
          <p>{{ hint }}</p>
        </div>
      </div>
    </div>

    <Teleport to="body">
      <div v-if="ctx" class="ctx-back" @mousedown="ctx = null" @contextmenu.prevent="ctx = null" />
      <div v-if="ctx" ref="ctxEl" class="ctx" :style="{ left: ctx.x + 'px', top: ctx.y + 'px' }" @mousedown.stop>
        <button type="button" :disabled="!canOpen" @click="runMenu('open')">打开</button>
        <button type="button" :disabled="!selected.length" @click="runMenu('send')">传到对面</button>
        <button v-if="canRemove" type="button" class="danger" :disabled="!selected.length" @click="runMenu('remove')">删除</button>
        <div class="menu-div" />
        <button type="button" @click="runMenu('refresh')">刷新</button>
        <button type="button" @click="runMenu('hidden')">
          {{ showHidden ? "不显示隐藏文件" : "显示隐藏文件" }}
        </button>
        <button type="button" :disabled="!shown.length" @click="runMenu('all')">全选</button>
      </div>
    </Teleport>
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import type { monitor } from "@/api";
import { formatBytes } from "@/utils/format";

export interface SftpDeleteItem {
  path: string;
  name: string;
  isDir: boolean;
}

const props = defineProps<{
  side: "local" | "remote";
  title: string;
  cwd: string;
  rootPath: string;
  entries: monitor.FileEntry[];
  loading: boolean;
  error: string;
  canBack: boolean;
  canForward: boolean;
  /** 对面正在拖文件过来 */
  acceptDrop: boolean;
  dropHint: string;
  /** 删除确认或传输进行中时，不再响应拖拽和快捷键 */
  locked?: boolean;
  /** 是否允许删除；本机面板传 false，本地文件只用于传输 */
  canRemove?: boolean;
  /** 用户根目录；地址栏的小房子点击后跳转到这里 */
  homePath?: string;
}>();

const emit = defineEmits<{
  navigate: [path: string];
  back: [];
  forward: [];
  refresh: [];
  send: [paths: string[]];
  receive: [dir: string];
  dragBegin: [paths: string[]];
  dragEnd: [];
  remove: [items: SftpDeleteItem[]];
  hoverTarget: [dir: string];
}>();

const OURS = "application/x-1pannel-sftp";

const filter = ref("");
const showHidden = ref(false);
const selected = ref<string[]>([]);
const anchor = ref(-1);
const sortKey = ref<"name" | "time" | "size" | "kind">("name");
const sortAsc = ref(true);
const menuOpen = ref(false);
const editing = ref(false);
const draft = ref("");
const pathInput = ref<HTMLInputElement | null>(null);
const rowsEl = ref<HTMLElement | null>(null);
const hot = ref(false);
const hoverDir = ref("");
const dragging = ref<string[]>([]);

const ctx = ref<{ x: number; y: number } | null>(null);
const ctxEl = ref<HTMLElement | null>(null);

const segments = computed(() => {
  const raw = props.cwd || props.rootPath || "/";
  const parts = raw.split("/").filter(Boolean);
  const out: { name: string; path: string }[] = [];
  if (props.side === "local" && /^[A-Za-z]:/.test(parts[0] || "")) {
    let acc = parts[0];
    out.push({ name: parts[0], path: acc + "/" });
    for (let i = 1; i < parts.length; i++) {
      acc += "/" + parts[i];
      out.push({ name: parts[i], path: acc });
    }
    return out;
  }
  let acc = "";
  for (const p of parts) {
    acc += "/" + p;
    out.push({ name: p, path: acc });
  }
  return out;
});

const shown = computed(() => {
  const q = filter.value.trim().toLowerCase();
  const list = props.entries.filter((e) => {
    if (!showHidden.value && e.name.startsWith(".")) return false;
    if (q && !e.name.toLowerCase().includes(q)) return false;
    return true;
  });
  const dir = sortAsc.value ? 1 : -1;
  return list.slice().sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    if (sortKey.value === "size") return (a.size - b.size) * dir;
    if (sortKey.value === "time") return a.modTime.localeCompare(b.modTime) * dir;
    if (sortKey.value === "kind") return kindOf(a).localeCompare(kindOf(b)) * dir;
    return a.name.localeCompare(b.name, "zh") * dir;
  });
});

const canOpen = computed(() => {
  if (selected.value.length !== 1) return false;
  const one = props.entries.find((e) => e.path === selected.value[0]);
  return !!one?.isDir;
});

const hint = computed(() => {
  if (!hoverDir.value) return props.dropHint;
  const name = hoverDir.value.split("/").filter(Boolean).pop() || hoverDir.value;
  return `放到「${name}」`;
});

const emptyText = computed(() => {
  if (filter.value.trim()) return "没有匹配的文件";
  if (!showHidden.value && props.entries.some((e) => e.name.startsWith("."))) {
    return "隐藏文件已收起，可在「操作」里打开";
  }
  return "这个目录是空的";
});

watch(showHidden, (on) => {
  if (on) return;
  const hidden = new Set(props.entries.filter((e) => e.name.startsWith(".")).map((e) => e.path));
  selected.value = selected.value.filter((p) => !hidden.has(p));
});

watch(
  () => props.cwd,
  () => {
    selected.value = [];
    anchor.value = -1;
    filter.value = "";
    editing.value = false;
  }
);

watch(
  () => props.entries,
  (list) => {
    const have = new Set(list.map((e) => e.path));
    selected.value = selected.value.filter((p) => have.has(p));
  }
);

function kindOf(e: monitor.FileEntry): string {
  if (e.isDir) return "文件夹";
  const i = e.name.lastIndexOf(".");
  if (i <= 0 || i === e.name.length - 1) return "文件";
  return e.name.slice(i + 1).toLowerCase();
}

function toggleSort(key: "name" | "time" | "size" | "kind") {
  if (sortKey.value === key) {
    sortAsc.value = !sortAsc.value;
    return;
  }
  sortKey.value = key;
  sortAsc.value = true;
}

function onRowClick(e: monitor.FileEntry, index: number, ev: MouseEvent) {
  const list = shown.value;
  if (ev.shiftKey && anchor.value >= 0) {
    const a = Math.min(anchor.value, index);
    const b = Math.max(anchor.value, index);
    selected.value = list.slice(a, b + 1).map((x) => x.path);
    return;
  }
  if (ev.metaKey || ev.ctrlKey) {
    if (selected.value.includes(e.path)) {
      selected.value = selected.value.filter((p) => p !== e.path);
    } else {
      selected.value = [...selected.value, e.path];
    }
    anchor.value = index;
    return;
  }
  selected.value = [e.path];
  anchor.value = index;
}

function onOpen(e: monitor.FileEntry) {
  if (!e.isDir) {
    selected.value = [e.path];
    return;
  }
  emit("navigate", e.path);
}

function selectedItems(): SftpDeleteItem[] {
  const byPath = new Map(props.entries.map((e) => [e.path, e]));
  return selected.value
    .map((p) => byPath.get(p))
    .filter((e): e is monitor.FileEntry => !!e)
    .map((e) => ({ path: e.path, name: e.name, isDir: e.isDir }));
}

function emitRemove() {
  const items = selectedItems();
  if (!items.length) return;
  emit("remove", items);
}

function emitSend() {
  if (!selected.value.length) return;
  emit("send", selected.value.slice());
}

function runMenu(action: "open" | "send" | "remove" | "refresh" | "hidden" | "all") {
  menuOpen.value = false;
  ctx.value = null;
  if (action === "open") {
    const one = props.entries.find((e) => e.path === selected.value[0]);
    if (one?.isDir) emit("navigate", one.path);
    return;
  }
  if (action === "send") emitSend();
  if (action === "remove") emitRemove();
  if (action === "refresh") emit("refresh");
  if (action === "hidden") showHidden.value = !showHidden.value;
  if (action === "all") {
    selected.value = shown.value.map((e) => e.path);
    anchor.value = selected.value.length ? 0 : -1;
  }
}

function go(path: string) {
  if (!path || path === props.cwd) return;
  emit("navigate", path);
}

function onSeg(path: string, index: number) {
  if (index === segments.value.length - 1) {
    startEdit();
    return;
  }
  go(path);
}

let skipBlur = false;

function startEdit() {
  if (editing.value) return;
  draft.value = props.cwd || props.rootPath || "/";
  editing.value = true;
  skipBlur = true;
  void nextTick(() => {
    pathInput.value?.focus();
    pathInput.value?.select();
    window.setTimeout(() => {
      skipBlur = false;
    }, 80);
  });
}

function cancelEdit() {
  skipBlur = true;
  editing.value = false;
}

function commitPath() {
  if (skipBlur || !editing.value) return;
  editing.value = false;
  const next = draft.value.trim();
  if (!next || next === props.cwd) return;
  emit("navigate", next);
}

function onKey(ev: KeyboardEvent) {
  if (props.locked) return;
  const tag = (ev.target as HTMLElement).tagName;
  if (tag === "INPUT" || tag === "TEXTAREA") return;
  if (ev.key === "Backspace" || ev.key === "Delete") {
    ev.preventDefault();
    if (props.canRemove && selected.value.length) emitRemove();
    else if (ev.key === "Backspace") emit("back");
    return;
  }
  if (ev.key === "Enter") {
    const one = props.entries.find((e) => e.path === selected.value[0]);
    if (one?.isDir) emit("navigate", one.path);
    return;
  }
  if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
    ev.preventDefault();
    moveSel(ev.key === "ArrowDown" ? 1 : -1);
  }
}

function moveSel(delta: number) {
  const list = shown.value;
  if (!list.length) return;
  let i = list.findIndex((x) => x.path === selected.value[selected.value.length - 1]);
  if (i < 0) i = delta > 0 ? -1 : 0;
  i = Math.min(list.length - 1, Math.max(0, i + delta));
  selected.value = [list[i].path];
  anchor.value = i;
  const el = rowsEl.value?.querySelector(`[data-path="${CSS.escape(list[i].path)}"]`);
  el?.scrollIntoView({ block: "nearest" });
}

function openCtx(ev: MouseEvent) {
  ctx.value = { x: ev.clientX, y: ev.clientY };
  void nextTick(() => {
    const el = ctxEl.value;
    if (!el || !ctx.value) return;
    const rect = el.getBoundingClientRect();
    const margin = 4;
    // 快到视口底部时翻转到点击点上方，避免菜单下半截被裁掉
    if (ctx.value.y + rect.height > window.innerHeight - margin) {
      ctx.value.y = Math.max(margin, ev.clientY - rect.height);
    }
    if (ctx.value.x + rect.width > window.innerWidth - margin) {
      ctx.value.x = Math.max(margin, window.innerWidth - rect.width - margin);
    }
  });
}

// 点击列表空白处：清除选中
function clearSel() {
  selected.value = [];
  anchor.value = -1;
}

function onContext(ev: MouseEvent, entry: monitor.FileEntry, index: number) {
  if (!selected.value.includes(entry.path)) {
    selected.value = [entry.path];
    anchor.value = index;
  }
  openCtx(ev);
}

function isOurs(ev: DragEvent): boolean {
  return Array.from(ev.dataTransfer?.types || []).includes(OURS);
}

function isExternal(ev: DragEvent): boolean {
  const types = Array.from(ev.dataTransfer?.types || []);
  return types.includes("Files") && !isOurs(ev);
}

function canAccept(ev: DragEvent): boolean {
  if (props.acceptDrop && isOurs(ev)) return true;
  if (props.side === "remote" && isExternal(ev)) return true;
  return false;
}

function onDragStart(ev: DragEvent, entry: monitor.FileEntry) {
  if (props.locked) {
    ev.preventDefault();
    return;
  }
  let paths = selected.value.slice();
  if (!paths.includes(entry.path)) {
    paths = [entry.path];
    selected.value = paths;
  }
  dragging.value = paths;
  if (ev.dataTransfer) {
    ev.dataTransfer.effectAllowed = "copy";
    ev.dataTransfer.setData(OURS, props.side);
    ev.dataTransfer.setData("text/plain", paths.join("\n"));
  }
  emit("dragBegin", paths);
}

function onDragFinish() {
  dragging.value = [];
  hot.value = false;
  setHover("");
  emit("dragEnd");
}

function onDragEnter(ev: DragEvent) {
  if (!canAccept(ev)) return;
  const rel = ev.relatedTarget as Node | null;
  if (rel && (ev.currentTarget as Node).contains(rel)) return;
  hot.value = true;
}

function onDragOver(ev: DragEvent) {
  if (!canAccept(ev)) return;
  ev.preventDefault();
  if (ev.dataTransfer) ev.dataTransfer.dropEffect = "copy";
  hot.value = true;
  const el = ev.target instanceof Element ? ev.target : null;
  if (!el?.closest(".row")) setHover("");
}

function onRowDragOver(ev: DragEvent, entry: monitor.FileEntry) {
  if (!canAccept(ev)) return;
  ev.preventDefault();
  hot.value = true;
  if (entry.isDir) setHover(entry.path);
  else setHover("");
}

function onDragLeave(ev: DragEvent) {
  const rel = ev.relatedTarget as Node | null;
  if (rel && (ev.currentTarget as Node).contains(rel)) return;
  hot.value = false;
  setHover("");
}

function onDrop(ev: DragEvent, dir: string) {
  if (!canAccept(ev)) return;
  ev.preventDefault();
  hot.value = false;
  if (isExternal(ev)) return;
  setHover("");
  const target = dir || props.cwd;
  if (!target) return;
  emit("receive", target);
}

function setHover(dir: string) {
  if (hoverDir.value === dir) return;
  hoverDir.value = dir;
  emit("hoverTarget", dir);
}
</script>

<style scoped lang="scss">
.pane {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  background: var(--m3-card);
  outline: none;

  &:focus-visible {
    box-shadow: inset 0 0 0 2px color-mix(in srgb, var(--m3-primary) 55%, transparent);
  }
}

.bar {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 40px;
  padding: 0 12px;
  border-bottom: 1px solid var(--m3-outline-variant);
  box-sizing: border-box;
}

.title {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  margin-right: auto;
  font: var(--m3-title-small);
  font-weight: 650;
  color: var(--m3-on-surface);
}

.title-icon {
  width: 18px;
  height: 18px;
  flex-shrink: 0;
  color: #3a3a3c;
}

.title-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.filter {
  display: flex;
  align-items: center;
  gap: 4px;
  width: 132px;
  height: var(--m3-button-height);
  padding: 0 8px;
  border: 1px solid var(--m3-outline-variant);
  border-radius: var(--m3-shape-s);
  color: var(--m3-on-surface-variant);
  background: var(--m3-card);

  svg {
    width: 14px;
    height: 14px;
    flex-shrink: 0;
  }

  input {
    width: 100%;
    border: 0;
    outline: none;
    background: transparent;
    font: var(--m3-body-small);
    color: var(--m3-on-surface);
  }
}

.actions {
  position: relative;
}

.ghost,
.icon-btn,
.crumb,
.col {
  border: 0;
  background: transparent;
  font: inherit;
  color: inherit;
  cursor: pointer;
}

.ghost {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: var(--m3-button-height);
  padding: 0 8px;
  border-radius: var(--m3-shape-s);
  color: var(--m3-on-surface);
  font: var(--m3-label-large);

  svg {
    width: 12px;
    height: 12px;
  }

  &:hover {
    background: color-mix(in srgb, var(--m3-on-surface) 6%, transparent);
  }

  &:focus-visible {
    outline: 2px solid var(--m3-primary);
    outline-offset: 1px;
  }
}

.menu-back,
.ctx-back {
  position: fixed;
  inset: 0;
  z-index: 40;
}

.menu,
.ctx {
  position: absolute;
  z-index: 41;
  min-width: 176px;
  padding: 4px;
  border-radius: var(--m3-shape-s);
  background: var(--m3-card);
  box-shadow: var(--m3-elevation-3);

  button {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    text-align: left;
    border: 0;
    background: transparent;
    border-radius: 6px;
    padding: 7px 10px;
    font: var(--m3-body-medium);
    color: var(--m3-on-surface);
    cursor: pointer;

    &:hover:not(:disabled) {
      background: #f2f3f5;
    }
    &:disabled {
      opacity: 0.35;
      cursor: default;
    }
    &.danger {
      color: var(--m3-error);
    }
  }

  .menu-div {
    height: 1px;
    margin: 4px 6px;
    background: #ececee;
  }
}

.menu {
  top: calc(100% + 4px);
  right: 0;
}

.ctx {
  position: fixed;
}

.nav {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 2px 8px 8px;
  min-width: 0;
}

.icon-btn {
  width: var(--m3-button-height);
  height: var(--m3-button-height);
  border-radius: var(--m3-shape-s);
  color: var(--m3-on-surface);

  &:focus-visible {
    outline: 2px solid var(--m3-primary);
    outline-offset: 1px;
  }
  display: grid;
  place-items: center;
  flex-shrink: 0;

  svg {
    width: 16px;
    height: 16px;
  }

  &:hover:not(:disabled) {
    background: #f2f3f5;
  }
  &:disabled {
    opacity: 0.28;
    cursor: default;
  }
}

.crumbs {
  display: flex;
  align-items: center;
  flex: 1;
  min-width: 0;
  min-height: 28px;
  overflow: auto;
  gap: 2px;
  padding: 0 6px;
  border-radius: 6px;
  cursor: text;

  &:hover {
    background: #f4f5f7;
  }

  &.is-editing {
    background: #f4f5f7;
    cursor: text;
  }
}

.crumb {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  padding: 4px 6px;
  border-radius: 4px;
  color: #3a3a3c;
  font-size: 13px;
  cursor: pointer;

  &:hover {
    background: #e8eaed;
    color: var(--m3-primary);
  }

  &.is-here {
    font-weight: 650;
    cursor: text;
  }
}

.crumb-icon {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
}

.sep {
  color: #c7c7cc;
  flex-shrink: 0;
}

.path-input {
  flex: 1;
  width: 100%;
  min-width: 0;
  border: 0;
  outline: none;
  font: inherit;
  font-size: 13px;
  color: #1c1c1e;
  background: transparent;
  border-radius: 6px;
  padding: 4px 2px;
}

.err {
  margin: 0 12px 6px;
  color: #e5484d;
  font-size: 12px;
}

.list-wrap {
  position: relative;
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  border-top: 1px solid #ececee;
}

.loading-bar {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 2px;
  z-index: 3;
  background: linear-gradient(90deg, transparent, var(--m3-primary), transparent);
  background-size: 40% 100%;
  animation: load 0.9s linear infinite;
}

.cols,
.row {
  display: grid;
  grid-template-columns: minmax(120px, 240px) minmax(108px, 148px) 64px 56px minmax(0, 1fr);
  gap: 8px;
  align-items: center;
  padding: 0 12px;
}

.cols {
  flex-shrink: 0;
  height: var(--m3-button-height);
  background: var(--m3-surface-container-high);
  color: var(--m3-on-surface-variant);
  font: var(--m3-label-medium);
  border-bottom: 1px solid var(--m3-outline-variant);
}

.col {
  text-align: left;
  color: var(--m3-on-surface-variant);
  font: var(--m3-label-medium);
  padding: 0;

  &.num {
    text-align: right;
  }
}

.rows {
  flex: 1;
  min-height: 0;
  overflow: auto;
}

.empty {
  padding: 28px 16px;
  color: var(--m3-on-surface-variant);
  font: var(--m3-body-medium);
}

.row {
  min-height: 44px;
  cursor: grab;
  border-bottom: 1px solid var(--m3-outline-variant);
  font: var(--m3-body-medium);
  color: var(--m3-on-surface);

  &:hover:not(.is-sel) {
    background: color-mix(in srgb, var(--m3-primary) 8%, var(--m3-card));
  }
  &.is-sel {
    background: var(--m3-primary);
    color: #fff;

    .mode,
    .cell {
      color: rgba(255, 255, 255, 0.82);
    }
  }
  &.is-drop:not(.is-sel) {
    background: color-mix(in srgb, var(--m3-primary) 14%, white);
    box-shadow: inset 0 0 0 1px var(--m3-primary);
  }
  &.is-drag {
    opacity: 0.45;
  }
  &.is-dot:not(.is-sel) .name {
    color: #8e8e93;
  }
}

.name-cell {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.ficon {
  width: 20px;
  height: 20px;
  flex-shrink: 0;
}

.name-text {
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.name,
.mode,
.cell {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mode {
  font-size: 11px;
  color: #8e8e93;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}

.cell {
  color: #636366;
  font-size: 12px;
}

.num {
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.drop-veil {
  position: absolute;
  inset: 10px;
  z-index: 4;
  display: grid;
  place-items: center;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.78);
  opacity: 0;
  visibility: hidden;
  pointer-events: none;
}

.list-wrap.file-drop-target-active .drop-veil,
.drop-veil.is-on {
  opacity: 1;
  visibility: visible;

  .mark {
    animation: mark-in 0.18s ease-out;
  }
  .mark svg {
    animation: bob 1.15s ease-in-out 0.18s infinite;
  }
  .brk {
    animation: brk-in 0.2s ease-out;
  }
}

.brk {
  position: absolute;
  width: 22px;
  height: 22px;
  border: 2.5px solid #1c1c1e;

  &.tl { top: 8px; left: 8px; border-right: 0; border-bottom: 0; }
  &.tr { top: 8px; right: 8px; border-left: 0; border-bottom: 0; }
  &.bl { bottom: 8px; left: 8px; border-right: 0; border-top: 0; }
  &.br { bottom: 8px; right: 8px; border-left: 0; border-top: 0; }
}

.mark {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  color: #1c1c1e;

  svg {
    width: 52px;
    height: 52px;
  }

  p {
    margin: 0;
    font-size: 16px;
    font-weight: 650;
    letter-spacing: -0.01em;
  }
}

@keyframes mark-in {
  from { opacity: 0; transform: translateY(8px) scale(0.96); }
  to { opacity: 1; transform: none; }
}

@keyframes bob {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(7px); }
}

@keyframes brk-in {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes load {
  from { background-position: -40% 0; }
  to { background-position: 140% 0; }
}

@media (prefers-reduced-motion: reduce) {
  .loading-bar,
  .list-wrap.file-drop-target-active .drop-veil .mark,
  .drop-veil.is-on .mark,
  .list-wrap.file-drop-target-active .drop-veil .mark svg,
  .drop-veil.is-on .mark svg,
  .list-wrap.file-drop-target-active .drop-veil .brk,
  .drop-veil.is-on .brk {
    animation: none;
  }
}
</style>
