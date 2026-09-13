<template>
  <aside
    class="panel-sidebar"
    :class="{ 'is-resizing': resizing }"
    :style="{ width: width + 'px' }"
  >
    <div class="menu-wrap">
      <el-menu :default-active="settings.lastNavGroup">
        <el-menu-item
          v-for="g in SETTINGS_NAV_GROUPS"
          :key="g.id"
          :index="g.id"
          @click="settings.setLastNavGroup(g.id)"
        >
          <span class="menu-title">{{ g.label }}</span>
        </el-menu-item>
      </el-menu>
    </div>

    <div
      class="sidebar-resize-handle"
      title="拖动调整宽度；双击自适应"
      @pointerdown="onResizeStart"
      @dblclick="onResizeDblClick"
    />
  </aside>
</template>

<script setup lang="ts">
/**
 * 设置工作区二级栏：外观 / 界面 / 终端 / 会话 / 通知 / 应用。
 * 打开设置时替换远程/本机二级栏；宽度共用 useSidebarResize。
 */
import {
  SETTINGS_NAV_GROUPS,
  useSettingsStore,
} from "@/stores/settings";
import { useSidebarResize } from "@/composables/useSidebarResize";

const settings = useSettingsStore();
const { width, resizing, onResizeStart, onResizeDblClick } = useSidebarResize();
</script>

<style scoped lang="scss">
.panel-sidebar {
  position: relative;
  min-width: 180px;
  max-width: 320px;
  flex-shrink: 0;

  &:not(.is-resizing) {
    transition: width var(--m3-motion-state);
  }

  &.is-resizing {
    transition: none;
    user-select: none;
  }
}

.menu-title {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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
