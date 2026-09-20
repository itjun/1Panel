<template>
  <aside
    class="panel-sidebar"
    :class="{ 'is-resizing': resizing }"
    :style="{ width: width + 'px' }"
  >
    <SidebarDragCap />
    <div v-if="title" class="sidebar-menu__head">
      <span class="sidebar-menu__title">{{ title }}</span>
    </div>
    <div class="menu-wrap">
      <nav class="sidebar-menu__list" :aria-label="title || '导航'">
        <button
          v-for="item in items"
          :key="item.id"
          type="button"
          class="sidebar-menu__item"
          :class="{ 'is-active': item.id === activeId }"
          @click="emit('select', item.id)"
        >
          <span class="sidebar-menu__label">{{ item.label }}</span>
          <span v-if="item.badge != null && item.badge !== ''" class="sidebar-menu__badge">
            {{ item.badge }}
          </span>
        </button>
      </nav>
    </div>
    <div
      class="sidebar-resize-handle"
      v-tip="'拖动调整宽度；双击自适应'"
      @pointerdown="onResizeStart"
      @dblclick="onResizeDblClick"
    />
  </aside>
</template>

<script setup lang="ts">
import SidebarDragCap from "@/components/SidebarDragCap.vue";
import { useSidebarResize } from "@/composables/useSidebarResize";

export interface SidebarMenuItem {
  id: string;
  label: string;
  badge?: string | number;
}

defineProps<{
  title?: string;
  items: SidebarMenuItem[];
  activeId: string;
}>();

const emit = defineEmits<{
  select: [id: string];
}>();

const { width, resizing, onResizeStart, onResizeDblClick } = useSidebarResize();
</script>

<style scoped lang="scss">
.panel-sidebar {
  position: relative;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  min-height: 0;

  &:not(.is-resizing) {
    transition: width var(--m3-motion-state);
  }

  &.is-resizing {
    transition: none;
    user-select: none;
  }
}

.sidebar-menu__head {
  display: flex;
  align-items: center;
  padding: 8px 14px 4px;
}

.sidebar-menu__title {
  font: var(--m3-label-small);
  font-weight: 600;
  color: var(--m3-on-surface-variant);
}

.sidebar-menu__list {
  padding: 4px 8px 12px;
}

.sidebar-menu__item {
  appearance: none;
  width: 100%;
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 40px;
  padding: 0 14px;
  margin: 1px 0;
  border: none;
  border-radius: var(--m3-shape-s);
  background: transparent;
  color: var(--m3-on-surface-variant);
  font: var(--m3-label-large);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  text-align: left;
  box-sizing: border-box;

  &:hover:not(.is-active) {
    background: color-mix(in srgb, var(--m3-on-surface) 6%, transparent);
    color: var(--m3-on-surface);
  }

  &.is-active {
    background: var(--m3-nav-active-bg);
    color: var(--m3-nav-active-fg);
  }
}

.sidebar-menu__label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sidebar-menu__badge {
  flex-shrink: 0;
  font: var(--m3-label-small);
  font-variant-numeric: tabular-nums;
}

.sidebar-resize-handle {
  position: absolute;
  top: 0;
  right: 0;
  z-index: 20;
  width: 5px;
  height: 100%;
  cursor: col-resize;
  touch-action: none;

  &::after {
    content: "";
    position: absolute;
    top: 0;
    right: 1px;
    width: 2px;
    height: 100%;
    border-radius: 1px;
    background: transparent;
    transition: background var(--m3-motion-state);
  }

  &:hover::after,
  .is-resizing &::after {
    background: var(--el-color-primary);
    opacity: 0.45;
  }
}
</style>
