<template>
  <aside class="workspace-rail drag-region" aria-label="工作区">
    <!-- 顶留 40px：mac 红绿灯落在此处 -->
    <div class="rail-traffic" aria-hidden="true" />

    <div class="rail-nav no-drag">
      <button
        type="button"
        class="rail-btn"
        :class="{ active: !app.settingsOpen && app.workspace === 'remote' }"
        title="远程"
        @click="app.setWorkspace('remote')"
      >
        <el-icon><Monitor /></el-icon>
        <span class="rail-label">远程</span>
      </button>
      <button
        type="button"
        class="rail-btn"
        :class="{ active: !app.settingsOpen && app.workspace === 'local' }"
        title="本机"
        @click="app.setWorkspace('local')"
      >
        <el-icon><Cpu /></el-icon>
        <span class="rail-label">本机</span>
      </button>
    </div>

    <div class="rail-footer no-drag">
      <button
        type="button"
        class="rail-btn"
        :class="{ active: app.settingsOpen }"
        :title="isMac ? '设置 (⌘,)' : '设置 (Ctrl+,)'"
        @click="app.toggleSettings()"
      >
        <el-icon><Setting /></el-icon>
        <span class="rail-label">设置</span>
      </button>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { Cpu, Monitor, Setting } from "@element-plus/icons-vue";
import { useAppStore } from "@/stores/app";

const app = useAppStore();
const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
</script>

<style scoped lang="scss">
.workspace-rail {
  display: flex;
  flex-direction: column;
  align-items: center;
  box-sizing: border-box;
  width: 64px;
  min-width: 64px;
  height: 100%;
  min-height: 0;
  padding: 0 0 8px;
  background: var(--m3-shell);
  color: var(--m3-on-surface);
  user-select: none;
}

.rail-traffic {
  flex-shrink: 0;
  width: 100%;
  height: 40px;
}

.rail-nav {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding-top: 4px;
}

.rail-footer {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding-bottom: 4px;
}

.rail-btn {
  appearance: none;
  width: 52px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 8px 4px;
  border: none;
  border-radius: var(--m3-shape-m);
  background: transparent;
  color: var(--m3-on-surface-variant);
  cursor: pointer;
  transition: background-color var(--m3-motion-state),
    color var(--m3-motion-state);

  .el-icon {
    font-size: 22px;
    display: block;
    line-height: 1;
  }

  &:hover {
    background: color-mix(in srgb, var(--m3-on-surface) 8%, transparent);
    color: var(--m3-on-surface);
  }

  &.active {
    background: var(--m3-sidebar-active-bg);
    color: var(--m3-sidebar-active-fg);
  }
}

.rail-label {
  display: block;
  margin-top: 0;
  font: var(--m3-label-small);
  line-height: 1.2;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
