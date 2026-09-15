<template>
  <aside
    class="panel-sidebar panel-sidebar--local"
    :class="{ 'is-resizing': resizing }"
    :style="{ width: width + 'px' }"
  >
    <div class="menu-wrap">
      <el-menu :default-active="activeId">
        <el-menu-item
          v-for="item in menuItems"
          :key="item.id"
          :index="item.id"
          @click="app.setLocalSection(item.id)"
        >
          <span class="menu-title">{{ item.label }}</span>
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
 * 本机工作区二级栏：纯文字导航。
 */
import { computed } from "vue";
import {
  useAppStore,
  type LocalSection,
} from "@/stores/app";
import { useSidebarResize } from "@/composables/useSidebarResize";

const app = useAppStore();
const { width, resizing, onResizeStart, onResizeDblClick } = useSidebarResize();

const menuItems = computed(() => {
  return [
    { id: "overview" as LocalSection, label: "系统概览" },
    { id: "procs" as LocalSection, label: "应用进程" },
    { id: "packages" as LocalSection, label: "软件列表" },
    { id: "storage" as LocalSection, label: "磁盘空间" },
    { id: "network" as LocalSection, label: "网络信息" },
    { id: "nginx" as LocalSection, label: "Nginx" },
    { id: "hosts" as LocalSection, label: "Hosts" },
    { id: "sysinfo" as LocalSection, label: "关于本机" },
  ];
});

const activeId = computed(() => {
  if (app.settingsOpen) return "__settings__";
  return app.localSection;
});
</script>

<style scoped lang="scss">
.panel-sidebar {
  position: relative;
  min-width: 160px;
  max-width: 280px;
  flex-shrink: 0;

  &:not(.is-resizing) {
    transition: width var(--m3-motion-state);
  }

  &.is-resizing {
    transition: none;
    user-select: none;
  }
}

/* 本机侧栏：纯文字导航；选中高度与远程主机行一致（48px） */
.panel-sidebar--local :deep(.el-menu) {
  padding: 4px 8px;
}

.panel-sidebar--local :deep(.el-menu-item) {
  height: 40px !important;
  line-height: 40px;
  margin: 1px 0;
  padding: 0 14px !important;
}

.menu-title {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  font-weight: 500;
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
