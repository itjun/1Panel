<template>
  <div class="main-container">
    <template v-if="!app.activeTab && app.runningHosts.length === 0">
      <div class="empty-main">
        <LogoFull style="height: 48px; width: auto; opacity: 0.9" />
        <h3>选择一台主机或分组</h3>
        <p>从左侧侧栏选择主机；已打开的主机会后台保持，可随时切换</p>
      </div>
    </template>

    <!-- 分组视图：展示组内全部主机监控卡片 -->
    <template v-else-if="app.activeTab?.kind === 'group'">
      <div class="host-header">
        <div>
          <div class="name">{{ app.activeTab.title }}</div>
          <div class="sub">分组概览 · 组内全部主机</div>
        </div>
      </div>
      <div class="content-pad">
        <GroupOverviewView
          :group-id="app.activeTab.id"
          :group-name="app.activeTab.title"
        />
      </div>
    </template>

    <!-- 多主机会话：已打开的全部挂载，仅用 v-show 切换，避免销毁重载 -->
    <template v-for="hid in app.runningHosts" :key="hid">
      <div
        v-show="app.activeTab?.kind === 'host' && app.activeTab.id === hid"
        class="host-shell"
      >
        <div class="host-header">
          <div>
            <div class="name">
              {{ sessionOf(hid)?.title || hid }}
              <span class="run-badge" title="后台保持中">运行中</span>
            </div>
            <div class="sub">{{ sessionOf(hid)?.subtitle }}</div>
          </div>
          <el-button
            text
            type="danger"
            size="small"
            @click="app.stopHost(hid)"
          >
            停止会话
          </el-button>
        </div>

        <div class="router-tabs">
          <el-radio-group
            :model-value="sessionOf(hid)?.subTab || 'overview'"
            size="default"
            @change="(v: string | number | boolean | undefined) => onSubChange(hid, v)"
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

        <div
          class="content-pad"
          :class="{
            'content-pad--fill': isFillSub(sessionOf(hid)?.subTab),
          }"
        >
          <!-- 各子页按会话 subTab 挂载；非当前子页用 v-show 藏起也可保留状态。
               为控制内存：非 overview 的子页仅在选中该 subTab 时挂载；
               overview 始终挂载以便后台轮询。 -->
          <OverviewView
            v-show="(sessionOf(hid)?.subTab || 'overview') === 'overview'"
            :host="hid"
          />
          <ProcessesView
            v-if="sessionOf(hid)?.subTab === 'processes'"
            :host="hid"
          />
          <NetworkView
            v-if="sessionOf(hid)?.subTab === 'network'"
            :host="hid"
          />
          <DockerView
            v-if="sessionOf(hid)?.subTab === 'docker'"
            :host="hid"
          />
          <FilesView
            v-if="sessionOf(hid)?.subTab === 'files'"
            :host="hid"
          />
          <ServicesView
            v-if="sessionOf(hid)?.subTab === 'services'"
            :host="hid"
          />
          <CronView
            v-if="sessionOf(hid)?.subTab === 'cron'"
            :host="hid"
          />
          <PackagesView
            v-if="sessionOf(hid)?.subTab === 'packages'"
            :host="hid"
          />
          <TerminalView
            v-if="sessionOf(hid)?.subTab === 'terminal'"
            :host="hid"
          />
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { useAppStore, type SubTab } from "@/stores/app";
import OverviewView from "@/views/OverviewView.vue";
import GroupOverviewView from "@/views/GroupOverviewView.vue";
import ProcessesView from "@/views/ProcessesView.vue";
import NetworkView from "@/views/NetworkView.vue";
import DockerView from "@/views/DockerView.vue";
import FilesView from "@/views/FilesView.vue";
import ServicesView from "@/views/ServicesView.vue";
import CronView from "@/views/CronView.vue";
import PackagesView from "@/views/PackagesView.vue";
import TerminalView from "@/views/TerminalView.vue";
import LogoFull from "@/components/LogoFull.vue";

const app = useAppStore();

const subTabs: { value: SubTab; label: string }[] = [
  { value: "overview", label: "概览" },
  { value: "processes", label: "进程" },
  { value: "network", label: "网络" },
  { value: "docker", label: "Docker" },
  { value: "files", label: "文件" },
  { value: "services", label: "服务" },
  { value: "cron", label: "定时任务" },
  { value: "packages", label: "软件包" },
  { value: "terminal", label: "终端" },
];

const FILL_SUBS: SubTab[] = [
  "terminal",
  "files",
  "processes",
  "network",
  "docker",
  "services",
  "cron",
  "packages",
];

function sessionOf(hid: string) {
  return app.hostSessions[hid];
}

function isFillSub(sub?: SubTab) {
  return !!sub && FILL_SUBS.includes(sub);
}

function onSubChange(hid: string, v: string | number | boolean | undefined) {
  if (typeof v !== "string") return;
  // 确保当前激活的是这台主机（用户点的是可见 shell 的 tabs）
  if (app.activeTabId !== hid) app.openHostTab(hid);
  app.setSubTab(hid, v as SubTab);
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
.host-shell {
  flex: 1;
  min-height: 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.host-header {
  height: 48px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 20px;
  background: #fff;
  border-bottom: var(--panel-border, 1px solid #f2f2f2);
  .name {
    font-size: 14px;
    font-weight: 600;
    display: inline-flex;
    align-items: center;
    gap: 8px;
  }
  .sub {
    font-size: 11px;
    color: var(--el-text-color-secondary);
  }
}
.run-badge {
  font-size: 10px;
  font-weight: 500;
  color: #67c23a;
  background: rgba(103, 194, 58, 0.12);
  border: 1px solid rgba(103, 194, 58, 0.35);
  border-radius: 10px;
  padding: 0 6px;
  line-height: 16px;
}
html.dark .host-header {
  background: var(--panel-main-bg-color-9, #2e313d);
}
.router-tabs {
  flex-shrink: 0;
  padding: 10px 20px 10px;
  background: #fff;
  border-bottom: 1px solid var(--panel-border, #f2f2f2);
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
html.dark .router-tabs {
  background: var(--panel-main-bg-color-9, #2e313d);
}
.content-pad {
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
  padding: 10px 20px 16px;
  box-sizing: border-box;

  &--fill {
    display: flex;
    flex-direction: column;
    padding: 0;
    overflow: hidden;
    /* 终端等全高视图：子组件必须能吃掉剩余高度 */
    > * {
      flex: 1 1 auto;
      min-height: 0;
      min-width: 0;
    }
  }
}
</style>
