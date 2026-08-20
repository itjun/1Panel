<template>
  <div class="main-container">
    <!-- 全部主机首页：常驻（v-show 切换，零销毁零重载） -->
    <div v-show="!app.activeTab" class="content-pad">
      <AllHostsOverviewView />
    </div>

    <!-- 分组视图：访问过的分组全部常驻，仅 v-show 切换；
         组内主机监控由 GroupOverviewView 自带 5s 轮询保持常热 -->
    <div
      v-for="gid in app.visitedGroupIds"
      :key="gid"
      v-show="app.activeTab?.kind === 'group' && app.activeTab.id === gid"
      class="content-pad"
    >
      <GroupOverviewView :group-id="gid" :group-name="app.groupNameOf(gid)" />
    </div>

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
          <!-- 顶部一级标签：1Panel RouterButton 组件（照搬） -->
          <RouterButton
            :model-value="sessionOf(hid)?.subTab || 'overview'"
            :buttons="subTabs"
            @update:model-value="(v: string) => onSubChange(hid, v)"
          />
        </div>

        <div
          class="content-pad"
          :class="{
            'content-pad--fill': isFillSub(sessionOf(hid)?.subTab),
          }"
        >
          <!-- 各子页按会话 subTab 切换；访问过的子页常驻挂载（v-if 首挂 + v-show 切换），
               切回零加载零销毁——资源换速度。终端例外：KeepAlive 缓存已够快且
               PTY/拖放钩子依赖 activate/deactivate 生命周期，不并入常驻。 -->
          <OverviewView
            v-show="(sessionOf(hid)?.subTab || 'overview') === 'overview'"
            :host="hid"
          />
          <ProcessesView
            v-if="visitedSub(hid, 'processes')"
            v-show="sessionOf(hid)?.subTab === 'processes'"
            :host="hid"
          />
          <NetworkView
            v-if="visitedSub(hid, 'network')"
            v-show="sessionOf(hid)?.subTab === 'network'"
            :host="hid"
          />
          <DockerView
            v-if="visitedSub(hid, 'docker')"
            v-show="sessionOf(hid)?.subTab === 'docker'"
            :host="hid"
          />
          <FilesView
            v-if="visitedSub(hid, 'files')"
            v-show="sessionOf(hid)?.subTab === 'files'"
            :host="hid"
          />
          <ServicesView
            v-if="visitedSub(hid, 'services')"
            v-show="sessionOf(hid)?.subTab === 'services'"
            :host="hid"
          />
          <CertsView
            v-if="visitedSub(hid, 'certs')"
            v-show="sessionOf(hid)?.subTab === 'certs'"
            :host="hid"
          />
          <CronView
            v-if="visitedSub(hid, 'cron')"
            v-show="sessionOf(hid)?.subTab === 'cron'"
            :host="hid"
          />
          <PackagesView
            v-if="visitedSub(hid, 'packages')"
            v-show="sessionOf(hid)?.subTab === 'packages'"
            :host="hid"
          />
          <LogsView
            v-if="visitedSub(hid, 'logs')"
            v-show="sessionOf(hid)?.subTab === 'logs'"
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
import { Window } from "@wailsio/runtime";
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
import RouterButton from "@/components/RouterButton.vue";

const app = useAppStore();

/** 双击顶部拖拽区：最大化 / 还原 */
function toggleMaximise() {
  Window.ToggleMaximise();
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

/** 该子页是否访问过（首挂条件；访问后常驻，v-show 切换） */
function visitedSub(hid: string, sub: SubTab) {
  return (sessionOf(hid)?.visited || []).includes(sub);
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
/* 顶部一级标签容器：间距与 1Panel 一致（组件本体在 components/RouterButton.vue） */
.router-tabs {
  flex-shrink: 0;
  margin: 0 20px 7px;
}
.content-pad {
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
  padding: 12px 20px 16px;
  box-sizing: border-box;

  &--fill {
    display: flex;
    flex-direction: column;
    padding: 12px 20px 16px;
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
