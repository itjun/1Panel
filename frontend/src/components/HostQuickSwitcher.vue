<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="qs-backdrop"
      @mousedown.self="close"
    >
      <div
        class="qs-panel"
        role="dialog"
        aria-label="切换主机"
        @keydown="onPanelKey"
      >
        <div class="qs-search">
          <el-icon class="qs-search__ico"><Search /></el-icon>
          <input
            ref="inputRef"
            v-model="query"
            class="qs-search__input"
            type="text"
            placeholder="搜索别名 / 地址 / 用户 / 分组"
            autocomplete="off"
            spellcheck="false"
            @keydown.down.prevent="move(1)"
            @keydown.up.prevent="move(-1)"
            @keydown.enter.prevent="confirm"
            @keydown.esc.prevent="close"
          />
          <span class="qs-search__hint">{{ isMac ? "⌘K" : "Ctrl+K" }}</span>
        </div>
        <ul v-if="results.length" class="qs-list" role="listbox">
          <li
            v-for="(row, i) in results"
            :key="row.name"
            class="qs-item"
            :class="{ 'is-active': i === active }"
            role="option"
            :aria-selected="i === active"
            @mousedown.prevent="openHost(row.name)"
            @mouseenter="active = i"
          >
            <span class="qs-item__name">{{ row.name }}</span>
            <span class="qs-item__meta">{{ row.meta }}</span>
            <span v-if="row.running" class="qs-item__tag">已打开</span>
          </li>
        </ul>
        <div v-else class="qs-empty">没有匹配的主机</div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { Search } from "@element-plus/icons-vue";
import { useAppStore } from "@/stores/app";

const app = useAppStore();
const isMac = /Mac|iPhone|iPad/.test(navigator.platform);

const open = ref(false);
const query = ref("");
const active = ref(0);
const inputRef = ref<HTMLInputElement | null>(null);

interface Row {
  name: string;
  meta: string;
  running: boolean;
}

const results = computed<Row[]>(() => {
  const q = query.value.trim().toLowerCase();
  const running = new Set(app.runningHosts);
  const rows: Row[] = [];
  for (const h of app.hosts) {
    const name = h.name || "";
    if (!name) continue;
    const group = app.groupNameOfHost(name);
    const user = h.user || "";
    const addr = h.hostName || "";
    const hay = `${name} ${addr} ${user} ${group}`.toLowerCase();
    if (q && !hay.includes(q)) continue;
    rows.push({
      name,
      meta: `${user}@${addr} · ${group}`,
      running: running.has(name),
    });
  }
  rows.sort((a, b) => {
    if (a.running !== b.running) return a.running ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return rows;
});

watch(results, () => {
  if (active.value >= results.value.length) {
    active.value = Math.max(0, results.value.length - 1);
  }
});

function show() {
  query.value = "";
  active.value = 0;
  open.value = true;
  void nextTick(() => inputRef.value?.focus());
}

function close() {
  open.value = false;
}

function move(dir: 1 | -1) {
  const n = results.value.length;
  if (n === 0) return;
  active.value = (active.value + dir + n) % n;
}

function openHost(name: string) {
  close();
  app.setWorkspace("remote");
  app.focusHost(name);
}

function confirm() {
  const row = results.value[active.value];
  if (row) openHost(row.name);
}

function onPanelKey(e: KeyboardEvent) {
  if (e.key === "Escape") {
    e.preventDefault();
    close();
  }
}

defineExpose({ show, close, isOpen: open });
</script>

<style scoped lang="scss">
.qs-backdrop {
  position: fixed;
  inset: 0;
  z-index: 5000;
  display: flex;
  justify-content: center;
  padding-top: 12vh;
  background: color-mix(in srgb, var(--m3-scrim) 28%, transparent);
}

.qs-panel {
  width: min(560px, calc(100vw - 48px));
  max-height: min(64vh, 520px);
  display: flex;
  flex-direction: column;
  border-radius: var(--m3-shape-m);
  background: var(--m3-card);
  border: 1px solid var(--m3-outline-variant);
  box-shadow: var(--m3-elevation-3);
  overflow: hidden;
}

.qs-search {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 14px;
  border-bottom: 1px solid var(--m3-outline-variant);
}

.qs-search__ico {
  color: var(--m3-on-surface-variant);
  font-size: 16px;
}

.qs-search__input {
  flex: 1;
  min-width: 0;
  border: none;
  outline: none;
  background: transparent;
  font: var(--m3-body-large);
  color: var(--m3-on-surface);
}

.qs-search__hint {
  flex-shrink: 0;
  font: var(--m3-label-small);
  color: var(--m3-on-surface-variant);
}

.qs-list {
  margin: 0;
  padding: 6px;
  list-style: none;
  overflow: auto;
}

.qs-item {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 40px;
  padding: 6px 10px;
  border-radius: var(--m3-shape-s);
  cursor: pointer;
}

.qs-item.is-active {
  background: var(--m3-nav-active-bg);
  color: var(--m3-nav-active-fg);
}

.qs-item__name {
  flex-shrink: 0;
  font: var(--m3-title-small);
}

.qs-item__meta {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font: var(--m3-body-small);
  color: var(--m3-on-surface-variant);
}

.qs-item.is-active .qs-item__meta {
  color: var(--m3-nav-active-fg);
  opacity: 0.8;
}

.qs-item__tag {
  flex-shrink: 0;
  font: var(--m3-label-small);
  color: var(--m3-nav-active-fg);
}

.qs-empty {
  padding: 28px 16px;
  text-align: center;
  font: var(--m3-body-small);
  color: var(--m3-on-surface-variant);
}
</style>
