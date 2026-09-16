<template>
  <el-button
    text
    class="sidebar-toggle-btn no-drag"
    v-tip="app.sidebarOpen ? `收起侧栏 (${kbd('B')})` : `展开侧栏 (${kbd('B')})`"
    @click="app.toggleSidebar()"
    @dblclick.stop
    @contextmenu.stop
  >
    <el-icon>
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.75"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <path d="M9 3v18" />
      </svg>
    </el-icon>
  </el-button>
</template>

<script setup lang="ts">
import { useAppStore } from "@/stores/app";

const app = useAppStore();
const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
function kbd(key: string): string {
  return isMac ? `⌘${key}` : `Ctrl+${key}`;
}
</script>

<style scoped>
.sidebar-toggle-btn {
  width: 32px;
  height: 32px;
  min-height: 32px !important;
  padding: 0 !important;
  margin: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  line-height: 1;
  border-radius: var(--m3-shape-full);
  color: var(--m3-on-surface-variant);
  --el-button-size: 32px;
  --el-button-hover-text-color: var(--m3-on-surface);
  --el-button-hover-bg-color: color-mix(
    in srgb,
    var(--m3-on-surface) 8%,
    transparent
  );
}
.sidebar-toggle-btn :deep(span) {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  line-height: 1;
}
.sidebar-toggle-btn :deep(.el-icon) {
  font-size: 18px;
  width: 18px;
  height: 18px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.sidebar-toggle-btn :deep(.el-icon svg) {
  width: 18px;
  height: 18px;
}
</style>
