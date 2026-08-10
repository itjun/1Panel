<template>
  <div class="main-container">
    <template v-if="!app.activeTab">
      <div class="empty-main">
        <LogoFull style="height: 48px; width: auto; opacity: 0.9" />
        <h3>选择一台主机或分组</h3>
        <p>从左侧侧栏选择主机</p>
      </div>
    </template>

    <template v-else-if="app.activeTab.kind === 'group'">
      <div class="host-header">
        <div>
          <div class="name">{{ app.activeTab.title }}</div>
          <div class="sub">分组概览</div>
        </div>
      </div>
      <div class="content-pad">
        <el-empty description="分组概览请在后续迭代完善；请直接打开主机查看监控" />
      </div>
    </template>

    <template v-else>
      <div class="host-header">
        <div>
          <div class="name">{{ app.activeTab.title }}</div>
          <div class="sub">{{ app.activeTab.subtitle }}</div>
        </div>
      </div>

      <div class="router-tabs">
        <el-radio-group
          :model-value="app.activeTab.subTab"
          size="default"
          @change="onSubChange"
        >
          <el-radio-button
            v-for="t in subTabs"
            :key="t.value"
            :value="t.value"
          >
            {{ t.label }}
          </el-radio-button>
        </el-radio-group>
      </div>

      <div class="content-pad">
        <OverviewView
          v-if="app.activeTab.subTab === 'overview'"
          :host="app.activeTab.id"
        />
        <PlaceholderView
          v-else
          :title="currentSubLabel"
          :host="app.activeTab.id"
        />
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useAppStore, type SubTab } from "@/stores/app";
import OverviewView from "@/views/OverviewView.vue";
import PlaceholderView from "@/views/PlaceholderView.vue";
import LogoFull from "@/components/LogoFull.vue";

const app = useAppStore();

const subTabs: { value: SubTab; label: string }[] = [
  { value: "overview", label: "概览" },
  { value: "processes", label: "进程" },
  { value: "docker", label: "Docker" },
  { value: "files", label: "文件" },
  { value: "services", label: "服务" },
  { value: "cron", label: "定时任务" },
  { value: "packages", label: "软件包" },
  { value: "terminal", label: "终端" },
];

const currentSubLabel = computed(
  () =>
    subTabs.find((t) => t.value === app.activeTab?.subTab)?.label || ""
);

function onSubChange(v: string | number | boolean | undefined) {
  if (!app.activeTabId || typeof v !== "string") return;
  app.setSubTab(app.activeTabId, v as SubTab);
}
</script>

<style scoped lang="scss">
.empty-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: var(--el-text-color-secondary);
  h3 {
    margin: 12px 0 0;
    color: var(--panel-text-color);
    font-size: 16px;
  }
  p {
    margin: 0;
    font-size: 12px;
  }
}
.host-header {
  height: 48px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  padding: 0 20px;
  background: #fff;
  border-bottom: var(--panel-border, 1px solid #f2f2f2);
  .name {
    font-size: 14px;
    font-weight: 600;
  }
  .sub {
    font-size: 11px;
    color: var(--el-text-color-secondary);
  }
}
html.dark .host-header {
  background: var(--panel-main-bg-color-9, #2e313d);
}
.router-tabs {
  flex-shrink: 0;
  padding: 10px 20px 0;
  background: transparent;
  :deep(.el-radio-button__inner) {
    padding: 10px 16px;
  }
  :deep(.el-radio-button.is-active .el-radio-button__inner) {
    background: #fff;
    color: var(--el-color-primary);
    border-color: var(--el-color-primary);
    box-shadow: none;
  }
}
.content-pad {
  flex: 1;
  min-width: 0; /* flex 子项默认可被内容撑宽，导致整页横向滚动 */
  min-height: 0;
  /* 只保留一层纵向滚动；横向溢出裁掉，避免底+右双滚动条 */
  overflow-x: hidden;
  overflow-y: auto;
  padding: 10px 20px 16px;
  box-sizing: border-box;
}
</style>
