<template>
  <Teleport to="body">
    <div
      v-if="menu"
      class="host-ctx-backdrop"
      @mousedown="emit('close')"
      @contextmenu.prevent="emit('close')"
    />
    <div
      v-if="menu"
      ref="menuEl"
      class="host-ctx-menu"
      :style="{ left: pos.x + 'px', top: pos.y + 'px' }"
      @mousedown.stop
    >
      <button type="button" class="ctx-item" @click="onOpen">打开列表</button>
      <button type="button" class="ctx-item" @click="onOpenBoard">打开看板</button>
      <template v-if="!isUngrouped">
        <div class="ctx-divider" />
        <button type="button" class="ctx-item" @click="onSettings">
          分组设置…
        </button>
      </template>
      <div class="ctx-divider" />
      <button type="button" class="ctx-item" @click="onAddHost">
        添加主机…
      </button>
      <template v-if="!isUngrouped">
        <div class="ctx-divider" />
        <button type="button" class="ctx-item is-danger" @click="onDelete">
          删除分组…
        </button>
      </template>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
/**
 * 分组标题右键：打开 / 打开看板 / 设置 / 添加主机 / 删除。
 * 「未分组」仅打开与添加主机。不支持嵌套子分组。
 */
import { computed, nextTick, reactive, ref, watch } from "vue";
import { UNGROUPED_ID } from "@/stores/app";
import { clampContextMenuPos } from "@/utils/contextMenuPos";

export interface GroupCtxMenuState {
  id: string;
  name: string;
  x: number;
  y: number;
}

const props = defineProps<{ menu: GroupCtxMenuState | null }>();

const emit = defineEmits<{
  (e: "close"): void;
  (e: "open", id: string, name: string): void;
  (e: "open-board", id: string): void;
  (e: "settings", id: string, name: string): void;
  (e: "add-host", groupId: string): void;
  (e: "delete", id: string, name: string): void;
}>();

const menuEl = ref<HTMLElement | null>(null);
const pos = reactive({ x: 0, y: 0 });

const isUngrouped = computed(
  () => !props.menu || props.menu.id === UNGROUPED_ID
);

watch(
  () => props.menu,
  async (m) => {
    if (!m) return;
    pos.x = m.x;
    pos.y = m.y;
    await nextTick();
    const el = menuEl.value;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const next = clampContextMenuPos(m.x, m.y, r.width, r.height);
    pos.x = next.x;
    pos.y = next.y;
  }
);

function onOpen() {
  const m = props.menu;
  emit("close");
  if (m) emit("open", m.id, m.name);
}

function onOpenBoard() {
  const m = props.menu;
  emit("close");
  if (m && m.id !== UNGROUPED_ID) emit("open-board", m.id);
}

function onSettings() {
  const m = props.menu;
  emit("close");
  if (m && m.id !== UNGROUPED_ID) emit("settings", m.id, m.name);
}

function onAddHost() {
  const m = props.menu;
  emit("close");
  if (m) emit("add-host", m.id === UNGROUPED_ID ? "" : m.id);
}

function onDelete() {
  const m = props.menu;
  emit("close");
  if (m && m.id !== UNGROUPED_ID) emit("delete", m.id, m.name);
}
</script>
