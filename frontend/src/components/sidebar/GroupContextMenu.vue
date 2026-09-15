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
      <button type="button" class="ctx-item" @click="onOpen">打开</button>
      <template v-if="!isUngrouped">
        <div class="ctx-divider" />
        <button type="button" class="ctx-item" @click="onSettings">
          分组设置…
        </button>
        <button
          v-if="canCreateChild"
          type="button"
          class="ctx-item"
          @click="onCreateChild"
        >
          新建子分组…
        </button>
        <button
          v-if="canMoveToRoot"
          type="button"
          class="ctx-item"
          @click="onMoveToRoot"
        >
          移到顶层
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
 * 分组标题右键：打开 / 设置 / 新建子分组 / 移到顶层 / 添加主机 / 删除。
 * 「未分组」仅打开与添加主机。depth>=3 时隐藏新建子分组。
 */
import { computed, nextTick, reactive, ref, watch } from "vue";
import { MAX_GROUP_DEPTH, UNGROUPED_ID, useAppStore } from "@/stores/app";
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
  (e: "settings", id: string, name: string): void;
  (e: "create-child", id: string, name: string): void;
  (e: "move-to-root", id: string): void;
  (e: "add-host", groupId: string): void;
  (e: "delete", id: string, name: string): void;
}>();

const app = useAppStore();
const menuEl = ref<HTMLElement | null>(null);
const pos = reactive({ x: 0, y: 0 });

const isUngrouped = computed(
  () => !props.menu || props.menu.id === UNGROUPED_ID
);

const canCreateChild = computed(() => {
  if (!props.menu || isUngrouped.value) return false;
  return app.groupDepthOf(props.menu.id) < MAX_GROUP_DEPTH;
});

const canMoveToRoot = computed(() => {
  if (!props.menu || isUngrouped.value) return false;
  const g = app.groupList.find((x) => x.id === props.menu!.id);
  return !!(g?.parentId || "").trim();
});

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

function onSettings() {
  const m = props.menu;
  emit("close");
  if (m && m.id !== UNGROUPED_ID) emit("settings", m.id, m.name);
}

function onCreateChild() {
  const m = props.menu;
  emit("close");
  if (m && m.id !== UNGROUPED_ID) emit("create-child", m.id, m.name);
}

function onMoveToRoot() {
  const m = props.menu;
  emit("close");
  if (m && m.id !== UNGROUPED_ID) emit("move-to-root", m.id);
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
