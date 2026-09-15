<template>
  <aside
    class="panel-sidebar panel-sidebar--notify"
    :class="{ 'is-resizing': resizing }"
    :style="{ width: width + 'px' }"
  >
    <div class="menu-wrap">
      <el-menu :default-active="activeId">
        <el-menu-item
          v-for="item in menuItems"
          :key="item.id"
          :index="item.id"
          @click="app.setNotifySection(item.id)"
        >
          <span class="menu-title">{{ item.label }}</span>
        </el-menu-item>
      </el-menu>
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
/**
 * 通知工作区二级栏：全部消息 / 指标订阅 / 应用订阅 / 通知频道 / 通知内容。
 */
import { computed } from "vue";
import { useAppStore, type NotifySection } from "@/stores/app";
import { useSidebarResize } from "@/composables/useSidebarResize";

const app = useAppStore();
const { width, resizing, onResizeStart, onResizeDblClick } = useSidebarResize();

const menuItems = computed(() => {
  return [
    { id: "messages" as NotifySection, label: "全部消息" },
    { id: "metricSubs" as NotifySection, label: "指标订阅" },
    { id: "appSubs" as NotifySection, label: "应用订阅" },
    { id: "channels" as NotifySection, label: "通知频道" },
    { id: "content" as NotifySection, label: "通知内容" },
  ];
});

const activeId = computed(() => {
  if (app.settingsOpen) return "__settings__";
  return app.notifySection;
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

.panel-sidebar--notify :deep(.el-menu) {
  padding: 4px 8px;
}

.panel-sidebar--notify :deep(.el-menu-item) {
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
