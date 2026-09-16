<template>
  <aside
    class="workspace-rail drag-region"
    aria-label="工作区"
    @dblclick="chrome.toggleMaximise()"
    @contextmenu.prevent="chrome.openMenu($event)"
  >
    <!-- 整条功能条右键：展开/收起侧栏（⌘B）；按钮区也要打开，不能 stop 掉 -->
    <!-- 顶留 40px：mac 红绿灯落在此处 -->
    <div class="rail-traffic" aria-hidden="true" />

    <div class="rail-nav no-drag" @dblclick.stop @contextmenu.prevent.stop="chrome.openMenu($event)">
      <button
        type="button"
        class="rail-btn"
        :class="{ active: !app.settingsOpen && app.workspace === 'remote' }"
        v-tip="'远程'"
        @click="onRemoteClick"
      >
        <el-icon><Monitor /></el-icon>
        <span class="rail-label">远程</span>
      </button>
      <button
        type="button"
        class="rail-btn"
        :class="{ active: !app.settingsOpen && app.workspace === 'local' }"
        v-tip="'本机'"
        @click="app.setWorkspace('local')"
      >
        <el-icon><Cpu /></el-icon>
        <span class="rail-label">本机</span>
      </button>
    </div>

    <div class="rail-footer no-drag" @dblclick.stop @contextmenu.prevent.stop="chrome.openMenu($event)">
      <button
        type="button"
        class="rail-btn"
        :class="{ active: !app.settingsOpen && app.workspace === 'notify' }"
        v-tip="'通知'"
        @click="app.setWorkspace('notify')"
      >
        <span class="rail-icon-slot">
          <span
            v-if="alertHistory.unread > 0"
            class="rail-count"
            :aria-label="'未读 ' + alertHistory.unread"
          >
            {{ alertHistory.unread > 99 ? "99+" : alertHistory.unread }}
          </span>
          <el-icon v-else><Bell /></el-icon>
        </span>
        <span class="rail-label">通知</span>
      </button>
      <button
        type="button"
        class="rail-btn"
        :class="{ active: app.settingsOpen }"
        v-tip="isMac ? '设置 (⌘,)' : '设置 (Ctrl+,)'"
        @click="app.toggleSettings()"
      >
        <el-icon><Setting /></el-icon>
        <span class="rail-label">设置</span>
      </button>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { Bell, Cpu, Monitor, Setting } from "@element-plus/icons-vue";
import { useAppStore } from "@/stores/app";
import { useAlertHistoryStore } from "@/stores/alertHistory";
import { useChromeDrag } from "@/composables/useChromeDrag";

const app = useAppStore();
const alertHistory = useAlertHistoryStore();
const chrome = useChromeDrag();
const isMac = /Mac|iPhone|iPad/.test(navigator.platform);

function onRemoteClick() {
  if (
    !app.settingsOpen &&
    app.workspace === "remote" &&
    app.activeTab?.kind === "host"
  ) {
    app.goHome();
    return;
  }
  app.setWorkspace("remote");
}
</script>

<style scoped lang="scss">
.workspace-rail {
  display: flex;
  flex-direction: column;
  align-items: center;
  box-sizing: border-box;
  width: var(--m3-rail-width, 80px);
  min-width: var(--m3-rail-width, 80px);
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
  gap: 4px;
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

/* 图标槽：铃铛或未读数字都占同一居中位置 */
.rail-icon-slot {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  line-height: 1;
}

.rail-count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 22px;
  height: 22px;
  padding: 0 5px;
  border-radius: 11px;
  box-sizing: border-box;
  background: var(--el-color-danger, #f56c6c);
  color: #fff;
  font-size: 12px;
  font-weight: 700;
  line-height: 1;
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
