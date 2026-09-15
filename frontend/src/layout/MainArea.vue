<template>
  <div class="main-container">
    <!-- 设置整页：离开即卸载；底下主机/分组/首页仍 v-show 常驻 -->
    <div v-if="app.settingsOpen" class="content-pad content-pad--fill">
      <SettingsView />
    </div>

    <!-- 本机工作区：顶边与侧栏菜单对齐（统一 4px 顶距） -->
    <div
      v-if="!app.settingsOpen && app.workspace === 'local'"
      class="content-pad content-pad--local"
      :class="{
        'content-pad--fill':
          app.localSection === 'sysinfo' ||
          app.localSection === 'procs' ||
          app.localSection === 'packages' ||
          app.localSection === 'storage' ||
          app.localSection === 'nginx' ||
          app.localSection === 'hosts',
      }"
    >
      <LocalOverviewView v-if="app.localSection === 'overview'" />
      <LocalSysInfoView v-else-if="app.localSection === 'sysinfo'" />
      <LocalAppsView v-else-if="app.localSection === 'procs'" />
      <LocalPackagesView v-else-if="app.localSection === 'packages'" />
      <LocalStorageView v-else-if="app.localSection === 'storage'" />
      <LocalNetworkView v-else-if="app.localSection === 'network'" />
      <LocalNginxView v-else-if="app.localSection === 'nginx'" />
      <LocalHostsView v-else-if="app.localSection === 'hosts'" />
    </div>

    <!-- 通知工作区：顶边与侧栏菜单对齐 -->
    <div
      v-if="!app.settingsOpen && app.workspace === 'notify'"
      class="content-pad content-pad--local"
    >
      <NotifyMessagesView v-if="app.notifySection === 'messages'" />
      <NotifyHostSubsView
        v-else-if="
          app.notifySection === 'metricSubs' || app.notifySection === 'appSubs'
        "
      />
      <NotifyChannelsView v-else-if="app.notifySection === 'channels'" />
      <NotifyContentView v-else-if="app.notifySection === 'content'" />
    </div>

    <!-- 全部主机首页：常驻（v-show 切换，零销毁零重载） -->
    <div
      v-show="!app.settingsOpen && app.workspace === 'remote' && !app.activeTab"
      class="content-pad"
    >
      <AllHostsOverviewView />
    </div>

    <!-- 分组视图：访问过的分组全部常驻，仅 v-show 切换；
         组内主机监控由 GroupOverviewView 自带 3s 轮询保持常热 -->
    <div
      v-for="gid in app.visitedGroupIds"
      :key="gid"
      v-show="
        !app.settingsOpen &&
        app.workspace === 'remote' &&
        app.activeTab?.kind === 'group' &&
        app.activeTab.id === gid
      "
      class="content-pad"
    >
      <GroupOverviewView :group-id="gid" :group-name="app.groupNameOf(gid)" />
    </div>

    <!-- 多主机会话：已打开的全部挂载，仅用 v-show 切换，避免销毁重载 -->
    <template v-for="hid in app.runningHosts" :key="hid">
      <div
        v-show="
          !app.settingsOpen &&
          app.workspace === 'remote' &&
          app.activeTab?.kind === 'host' &&
          app.activeTab.id === hid
        "
        class="host-shell"
      >
        <div class="router-tabs">
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
               切回零加载——资源换速度。子页按 LRU 上限常驻（MAX_RESIDENT_SUBS，
               超出挤掉最旧的），避免多会话全量常驻把内存顶高。终端例外：
               KeepAlive 缓存已够快且 PTY/拖放钩子依赖 activate/deactivate
               生命周期，不并入常驻。 -->
          <OverviewView
            v-show="(sessionOf(hid)?.subTab || 'overview') === 'overview'"
            :host="hid"
          />
          <MonitorView
            v-if="visitedSub(hid, 'monitor')"
            v-show="sessionOf(hid)?.subTab === 'monitor'"
            :host="hid"
          />
          <AppsView
            v-if="visitedSub(hid, 'apps')"
            v-show="sessionOf(hid)?.subTab === 'apps'"
            :host="hid"
          />
          <NginxView
            v-if="visitedSub(hid, 'nginx')"
            v-show="sessionOf(hid)?.subTab === 'nginx'"
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
          <HostsView
            v-if="visitedSub(hid, 'hosts')"
            v-show="sessionOf(hid)?.subTab === 'hosts'"
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
          <LogsView
            v-if="visitedSub(hid, 'logs')"
            v-show="sessionOf(hid)?.subTab === 'logs'"
            :host="hid"
          />
          <PackagesView
            v-if="visitedSub(hid, 'packages')"
            v-show="sessionOf(hid)?.subTab === 'packages'"
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
import { useAppStore, type SubTab } from "@/stores/app";
import RouterButton from "@/components/RouterButton.vue";
import OverviewView from "@/views/OverviewView.vue";
import MonitorView from "@/views/MonitorView.vue";
import AppsView from "@/views/AppsView.vue";
import NginxView from "@/views/NginxView.vue";
import GroupOverviewView from "@/views/GroupOverviewView.vue";
import ProcessesView from "@/views/ProcessesView.vue";
import NetworkView from "@/views/NetworkView.vue";
import HostsView from "@/views/HostsView.vue";
import FilesView from "@/views/FilesView.vue";
import ServicesView from "@/views/ServicesView.vue";
import CertsView from "@/views/CertsView.vue";
import CronView from "@/views/CronView.vue";
import PackagesView from "@/views/PackagesView.vue";
import LogsView from "@/views/LogsView.vue";
import TerminalView from "@/views/TerminalView.vue";
import AllHostsOverviewView from "@/views/AllHostsOverviewView.vue";
import LocalAppsView from "@/views/LocalAppsView.vue";
import LocalOverviewView from "@/views/LocalOverviewView.vue";
import LocalSysInfoView from "@/views/LocalSysInfoView.vue";
import LocalPackagesView from "@/views/LocalPackagesView.vue";
import LocalStorageView from "@/views/LocalStorageView.vue";
import LocalNetworkView from "@/views/LocalNetworkView.vue";
import LocalNginxView from "@/views/LocalNginxView.vue";
import LocalHostsView from "@/views/LocalHostsView.vue";
import NotifyMessagesView from "@/views/NotifyMessagesView.vue";
import NotifyHostSubsView from "@/views/NotifyHostSubsView.vue";
import NotifyChannelsView from "@/views/NotifyChannelsView.vue";
import NotifyContentView from "@/views/NotifyContentView.vue";
import SettingsView from "@/views/SettingsView.vue";

const app = useAppStore();

const subTabs: { value: SubTab; label: string }[] = [
  { value: "overview", label: "概览" },
  { value: "monitor", label: "监控" },
  { value: "apps", label: "应用" },
  { value: "nginx", label: "Nginx" },
  { value: "processes", label: "进程" },
  { value: "network", label: "网络" },
  { value: "hosts", label: "Hosts" },
  { value: "files", label: "文件" },
  { value: "services", label: "服务" },
  { value: "certs", label: "证书" },
  { value: "cron", label: "定时任务" },
  { value: "logs", label: "日志" },
  { value: "packages", label: "软件包" },
  { value: "terminal", label: "终端" },
];

const FILL_SUBS: SubTab[] = [
  "terminal",
  "files",
  "processes",
  "apps",
  "nginx",
  "network",
  "hosts",
  "monitor",
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

function onSubChange(hid: string, v: string) {
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
  padding: 12px 20px 20px;
  box-sizing: border-box;
}

/* 子页标签：Segmented 直接浮在灰画布，无白卡外框 */
.router-tabs {
  flex-shrink: 0;
  margin-bottom: 12px;
  padding: 0;
  background: transparent;
  border: none;
  box-sizing: border-box;
}

.content-pad {
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
  padding: 12px 20px 20px;
  box-sizing: border-box;
  background: transparent;

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

  /* 本机：与侧栏纯文字菜单顶边对齐 */
  &--local {
    padding: 4px 16px 16px;
  }

  /* 本机非 fill 页（概览等）：子页至少撑满可视高度，空态 loading 才能居中 */
  &--local:not(.content-pad--fill) {
    display: flex;
    flex-direction: column;

    > * {
      flex: 1 0 auto;
      min-width: 0;
      width: 100%;
    }
  }

  /* 本机表格类 fill 页：工具栏/表格与主内容卡描边留出呼吸，避免贴边 */
  &--local.content-pad--fill {
    padding: 12px 16px 16px;
  }
}

.host-shell .content-pad:not(.content-pad--fill) {
  padding: 4px 0 12px;
}
</style>
