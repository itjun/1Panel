<template>
  <div class="main-container">
    <template v-if="!app.activeTab">
      <div class="host-header drag-region" @dblclick="toggleMaximise">
        <div class="header-left no-drag">
          <SidebarExpandBtn v-if="!app.sidebarOpen" @expand="app.setSidebarOpen(true)" />
          <div>
            <div class="name">全部主机</div>
            <div class="sub">全部主机概览</div>
          </div>
        </div>
      </div>
      <div class="content-pad">
        <AllHostsOverviewView />
      </div>
    </template>

    <!-- 分组视图：展示组内全部主机监控卡片 -->
    <template v-else-if="app.activeTab?.kind === 'group'">
      <div class="host-header drag-region" @dblclick="toggleMaximise">
        <div class="header-left no-drag">
          <SidebarExpandBtn v-if="!app.sidebarOpen" @expand="app.setSidebarOpen(true)" />
          <div>
            <div class="name">{{ app.activeTab.title }}</div>
            <div class="sub">分组概览 · 组内全部主机</div>
          </div>
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
        <!-- 顶部仅保留拖拽条；侧栏收起时增高，容纳红绿灯让位与展开按钮 -->
        <div class="top-drag-strip drag-region" @dblclick="toggleMaximise">
          <SidebarExpandBtn
            v-if="!app.sidebarOpen"
            class="no-drag"
            @expand="app.setSidebarOpen(true)"
          />
        </div>

        <div class="router-tabs">
          <el-radio-group
            :model-value="sessionOf(hid)?.subTab || 'overview'"
            size="large"
            @change="(v: string | number | boolean | undefined) => onSubChange(hid, v)"
          >
            <el-radio-button
              v-for="t in subTabs"
              :key="t.value"
              class="router-tab-btn"
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
          <CertsView
            v-if="sessionOf(hid)?.subTab === 'certs'"
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
          <LogsView
            v-if="sessionOf(hid)?.subTab === 'logs'"
            :host="hid"
          />
          <!-- KeepAlive：切到其他子页签时终端只停用不卸载，
               避免卸载钩子关闭全部 PTY 会话（切回来就断线） -->
          <KeepAlive>
            <TerminalView
              v-if="sessionOf(hid)?.subTab === 'terminal'"
              :host="hid"
            />
          </KeepAlive>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { WindowToggleMaximise } from "@wailsjs/runtime/runtime";
import { useAppStore, type SubTab } from "@/stores/app";
import OverviewView from "@/views/OverviewView.vue";
import GroupOverviewView from "@/views/GroupOverviewView.vue";
import ProcessesView from "@/views/ProcessesView.vue";
import NetworkView from "@/views/NetworkView.vue";
import DockerView from "@/views/DockerView.vue";
import FilesView from "@/views/FilesView.vue";
import ServicesView from "@/views/ServicesView.vue";
import CertsView from "@/views/CertsView.vue";
import CronView from "@/views/CronView.vue";
import PackagesView from "@/views/PackagesView.vue";
import LogsView from "@/views/LogsView.vue";
import TerminalView from "@/views/TerminalView.vue";
import AllHostsOverviewView from "@/views/AllHostsOverviewView.vue";
import SidebarExpandBtn from "@/components/SidebarExpandBtn.vue";

const app = useAppStore();

/** 双击顶部拖拽区：最大化 / 还原 */
function toggleMaximise() {
  WindowToggleMaximise();
}

const subTabs: { value: SubTab; label: string }[] = [
  { value: "overview", label: "概览" },
  { value: "processes", label: "进程" },
  { value: "network", label: "网络" },
  { value: "docker", label: "Docker" },
  { value: "files", label: "文件" },
  { value: "services", label: "服务" },
  { value: "certs", label: "证书" },
  { value: "cron", label: "定时任务" },
  { value: "packages", label: "软件包" },
  { value: "logs", label: "日志" },
  { value: "terminal", label: "终端" },
];

const FILL_SUBS: SubTab[] = [
  "terminal",
  "files",
  "processes",
  "network",
  "docker",
  "services",
  "certs",
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
  background: transparent;
  border-bottom: none;
  .header-left {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }
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
/* 像素级对齐 1Panel RouterButton：按钮紧贴排列（无缝），容器零内边距，
   整条高度 = 按钮高度 40px；按钮间距由各自 19px 横向内边距撑出 */
.router-tabs {
  flex-shrink: 0;
  margin: 0 20px;
  padding: 0;
  background: var(--panel-button-active, #fff);
  border-radius: 4px;
  box-shadow: var(--el-box-shadow-light, 0 0 12px rgba(0, 0, 0, 0.12));

  :deep(.el-radio-group) {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    /* 单行时与 1Panel 完全一致；标签多到换行时留出行距，避免两行贴死 */
    row-gap: 8px;
    padding: 0;
  }

  :deep(.router-tab-btn) {
    flex: none;
    margin: 0 !important;
  }

  :deep(.router-tab-btn .el-radio-button__inner) {
    min-width: 100px;
    height: 40px;
    padding: 0 19px;
    font-size: 14px;
    /* EP 原生 inner 是 line-height:1 的 inline-block，清掉垂直 padding 后文字会顶在上方，
       改用 flex 保证水平垂直居中；border-box 避免 2px 边框撑大选中按钮 */
    display: inline-flex;
    align-items: center;
    justify-content: center;
    box-sizing: border-box;
    background-color: var(--panel-button-active, #fff) !important;
    box-shadow: none !important;
    border: 2px solid transparent !important;
    border-radius: 4px !important;
    color: var(--el-text-color-regular) !important;
    font-weight: 400;
  }

  :deep(.router-tab-btn .el-radio-button__original-radio:checked + .el-radio-button__inner),
  :deep(.router-tab-btn.is-active .el-radio-button__inner) {
    color: var(--panel-button-text-color, var(--el-color-primary)) !important;
    background-color: var(--panel-button-bg-color, #fff) !important;
    border-color: var(--panel-color-primary, var(--el-color-primary)) !important;
    border-radius: 4px !important;
    box-shadow: none !important;
  }
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
    padding: 10px 20px 16px;
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
