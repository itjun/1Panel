<template>
  <!--
    侧栏顶部置顶区：原网格布局（图标在上、短名在下）+ 哈希彩色首字母。
    v-tip 即时显示完整主机名；拖入置顶、区内重排。
  -->
  <div
    v-if="visible"
    class="pinned-strip"
    :class="{
      'is-drop-target': isDropTarget,
      'is-empty': hosts.length === 0,
      'is-dragging-host': draggingHost,
    }"
    :data-drop-group="PINNED_DROP_ID"
  >
    <div v-if="hosts.length === 0" class="pinned-strip__hint" :data-drop-group="PINNED_DROP_ID">
      拖到此处固定
    </div>
    <div v-else class="pinned-strip__grid" :data-drop-group="PINNED_DROP_ID">
      <button
        v-for="name in hosts"
        :key="name"
        type="button"
        class="pinned-item"
        :class="{
          'is-active': activeId === name,
          'is-running': isRunning(name),
          'is-drag-source': dragHostId === name,
          'is-insert-before': insertBefore === name && dragHostId !== name,
        }"
        :data-drop-group="PINNED_DROP_ID"
        :data-pin-host="name"
        v-tip="draggingHost ? undefined : name"
        @pointerdown="onItemPointerDown($event, name)"
        @click="onItemClick(name)"
        @contextmenu.prevent="$emit('context', $event, name)"
      >
        <span
          class="pinned-item__avatar"
          :style="avatarStyle(name)"
          :data-drop-group="PINNED_DROP_ID"
          :data-pin-host="name"
        >
          {{ initialOf(name) }}
          <span v-if="isRunning(name)" class="pinned-item__dot" />
        </span>
        <span class="pinned-item__name" :data-drop-group="PINNED_DROP_ID" :data-pin-host="name">
          {{ name }}
        </span>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { PINNED_DROP_ID } from "@/stores/app";

/** 固定色板：浅底 + 深字，同主机名永远同色 */
const AVATAR_PALETTE = [
  { bg: "#E3F2FD", fg: "#1565C0" },
  { bg: "#E8F5E9", fg: "#2E7D32" },
  { bg: "#FFF3E0", fg: "#E65100" },
  { bg: "#F3E5F5", fg: "#7B1FA2" },
  { bg: "#E0F7FA", fg: "#00838F" },
  { bg: "#FCE4EC", fg: "#C2185B" },
  { bg: "#E8EAF6", fg: "#3949AB" },
  { bg: "#F1F8E9", fg: "#558B2F" },
] as const;

const props = defineProps<{
  hosts: string[];
  activeId: string;
  dropTargetId: string | null;
  dragHostId: string | null;
  insertBefore: string | null;
  draggingHost: boolean;
  isRunning: (name: string) => boolean;
  osRelease: (name: string) => string;
  suppressClick: boolean;
}>();

const emit = defineEmits<{
  open: [name: string];
  context: [e: MouseEvent, name: string];
  "item-pointer-down": [e: PointerEvent, name: string];
}>();

const isDropTarget = computed(
  () => props.dropTargetId === PINNED_DROP_ID && props.draggingHost
);

const visible = computed(
  () => props.hosts.length > 0 || props.draggingHost
);

function initialOf(name: string): string {
  const m = name.trim().match(/[A-Za-z0-9]/);
  return m ? m[0].toUpperCase() : "#";
}

function colorOf(name: string): (typeof AVATAR_PALETTE)[number] {
  let h = 0;
  for (let i = 0; i < name.length; i++) {
    h = (h * 31 + name.charCodeAt(i)) >>> 0;
  }
  return AVATAR_PALETTE[h % AVATAR_PALETTE.length];
}

function avatarStyle(name: string) {
  const c = colorOf(name);
  return { backgroundColor: c.bg, color: c.fg };
}

function onItemClick(name: string) {
  if (props.suppressClick) return;
  emit("open", name);
}

function onItemPointerDown(e: PointerEvent, name: string) {
  emit("item-pointer-down", e, name);
}
</script>

<style scoped lang="scss">
.pinned-strip {
  position: sticky;
  top: 0;
  z-index: 2;
  margin: 6px 8px 4px;
  padding: 8px 6px;
  border-radius: var(--m3-shape-m);
  border: 1px dashed transparent;
  background: var(--m3-surface-container-low);
  box-shadow: 0 1px 0 color-mix(in srgb, var(--m3-on-surface) 6%, transparent);
  transition:
    background var(--m3-motion-state),
    border-color var(--m3-motion-state);

  &.is-empty {
    padding: 14px 8px;
    border-color: var(--m3-outline-variant);
    background: color-mix(in srgb, var(--m3-on-surface) 3%, var(--m3-surface-container-low));
    box-shadow: none;
  }

  &.is-drop-target {
    border-color: var(--m3-primary);
    background: color-mix(in srgb, var(--m3-primary) 10%, var(--m3-surface-container-low));
  }
}

.pinned-strip__hint {
  text-align: center;
  font: var(--m3-label-small);
  color: var(--m3-on-surface-variant);
  pointer-events: none;
}

.pinned-strip__grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(56px, 1fr));
  gap: 4px 2px;
}

.pinned-item {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  min-width: 0;
  padding: 6px 4px;
  border: 0;
  border-radius: var(--m3-shape-s);
  background: transparent;
  color: var(--m3-on-surface-variant);
  cursor: pointer;
  box-sizing: border-box;
  transition: background-color var(--m3-motion-state);

  &:hover {
    background: color-mix(in srgb, var(--m3-on-surface) 6%, transparent);
    color: var(--m3-on-surface);
  }

  &.is-active {
    background: color-mix(in srgb, var(--m3-primary) 12%, transparent);
    color: var(--m3-primary);
  }

  &.is-drag-source {
    opacity: 0.45;
  }

  &.is-insert-before::before {
    content: "";
    position: absolute;
    left: 0;
    top: 4px;
    bottom: 4px;
    width: 2px;
    border-radius: 1px;
    background: var(--m3-primary);
  }
}

.pinned-item__avatar {
  position: relative;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  font: var(--m3-label-small);
  font-size: 13px;
  font-weight: 700;
  line-height: 1;
}

.pinned-item__dot {
  position: absolute;
  right: -1px;
  bottom: -1px;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--el-color-success);
  border: 1.5px solid var(--m3-surface-container-low);
}

.pinned-item__name {
  max-width: 100%;
  font: var(--m3-label-small);
  font-size: 11px;
  line-height: 1.2;
  text-align: center;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
