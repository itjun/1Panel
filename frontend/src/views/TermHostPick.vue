<template>
  <div
    class="term-pick"
    :class="{ 'is-overlay': props.overlay }"
    @mousedown.self="cancel"
  >
    <div class="term-pick__card" @mousedown.stop>
      <div class="term-pick__search">
        <el-icon class="term-pick__ico"><Search /></el-icon>
        <input
          ref="inputRef"
          v-model="query"
          class="term-pick__input"
          type="search"
          placeholder="搜索主机 / 地址 / 用户 / 分组"
          autocomplete="off"
          spellcheck="false"
          @keydown.down.prevent="move(1)"
          @keydown.up.prevent="move(-1)"
          @keydown.enter.prevent="confirm"
          @keydown.esc.prevent="cancel"
        />
        <span class="term-pick__hint">{{ isMac ? "⌘T" : "Ctrl+T" }} 新建</span>
      </div>
      <ul v-if="rows.length" class="term-pick__list" role="listbox">
        <li
          v-for="(row, i) in rows"
          :key="row.name"
          class="term-pick__item"
          :class="{ 'is-active': i === active }"
          role="option"
          :aria-selected="i === active"
          @mousedown.prevent="pick(row.name)"
          @mouseenter="active = i"
        >
          <span class="term-pick__name">{{ row.name }}</span>
          <span class="term-pick__meta">{{ row.meta }}</span>
          <span v-if="row.open" class="term-pick__tag">已打开</span>
        </li>
      </ul>
      <p v-else class="term-pick__empty">没有匹配的主机</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from "vue";
import { Search } from "@element-plus/icons-vue";
import { useAppStore } from "@/stores/app";

const props = withDefaults(defineProps<{ overlay?: boolean }>(), { overlay: false });
const app = useAppStore();
const emit = defineEmits<{ cancel: [] }>();
const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
const query = ref("");
const active = ref(0);
const inputRef = ref<HTMLInputElement | null>(null);

const rows = computed(() => {
  const q = query.value.trim().toLowerCase();
  const opened = new Set(app.terminalDesks.filter((d) => d.host).map((d) => d.host));
  const list: { name: string; meta: string; open: boolean }[] = [];
  for (const h of app.hosts) {
    const name = h.name || "";
    if (!name) continue;
    const group = app.groupNameOfHost(name);
    const user = h.user || "";
    const addr = h.hostName || "";
    const hay = `${name} ${addr} ${user} ${group}`.toLowerCase();
    if (q && !hay.includes(q)) continue;
    list.push({
      name,
      meta: [user && addr ? `${user}@${addr}` : addr || user, group].filter(Boolean).join(" · "),
      open: opened.has(name),
    });
  }
  list.sort((a, b) => {
    if (a.open !== b.open) return a.open ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return list;
});

watch(rows, () => {
  if (active.value >= rows.value.length) {
    active.value = Math.max(0, rows.value.length - 1);
  }
});

function move(dir: 1 | -1) {
  const n = rows.value.length;
  if (n === 0) return;
  active.value = (active.value + dir + n) % n;
}

function pick(name: string) {
  app.openAnotherTerminal(name);
}

function confirm() {
  const row = rows.value[active.value];
  if (row) pick(row.name);
}

function cancel() {
  emit("cancel");
}

onMounted(() => {
  void nextTick(() => inputRef.value?.focus());
});
</script>

<style scoped lang="scss">
.term-pick {
  position: relative;
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  justify-content: center;
  align-items: flex-start;
  padding: 12vh 24px 24px;
  background: #0e0e0e;
}

.term-pick.is-overlay {
  position: absolute;
  inset: 0;
  z-index: 20;
  background: rgba(14, 14, 14, 0.88);
  backdrop-filter: blur(3px);
}

.term-pick__card {
  width: min(640px, 100%);
  max-height: min(68vh, 560px);
  display: flex;
  flex-direction: column;
  border: 1px solid #2c2c2c;
  border-radius: 12px;
  background: #1c1c1c;
  overflow: hidden;
}

.term-pick__search {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 14px;
  border-bottom: 1px solid #2c2c2c;
}

.term-pick__ico {
  color: #a3a3a3;
  font-size: 16px;
}

.term-pick__input {
  flex: 1;
  min-width: 0;
  border: 0;
  outline: none;
  background: transparent;
  color: #ececec;
  font: var(--m3-body-large);
}

.term-pick__hint {
  flex-shrink: 0;
  color: #7a7a7a;
  font: var(--m3-label-small);
}

.term-pick__list {
  margin: 0;
  padding: 6px;
  list-style: none;
  overflow: auto;
}

.term-pick__item {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 40px;
  padding: 6px 10px;
  border-radius: 8px;
  cursor: pointer;
}

.term-pick__item.is-active {
  background: #1e3328;
  color: #8fdbb0;
}

.term-pick__name {
  flex-shrink: 0;
  font: var(--m3-title-small);
}

.term-pick__meta {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: #8a8a8a;
  font: var(--m3-body-small);
}

.term-pick__item.is-active .term-pick__meta {
  color: #8fdbb0;
  opacity: 0.8;
}

.term-pick__tag {
  flex-shrink: 0;
  color: #8fdbb0;
  font: var(--m3-label-small);
}

.term-pick__empty {
  margin: 0;
  padding: 28px 16px;
  text-align: center;
  color: #8a8a8a;
  font: var(--m3-body-small);
}
</style>
