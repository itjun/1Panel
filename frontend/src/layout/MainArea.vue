<template>
  <div class="main-container">
    <!-- 设置整页：离开即卸载；底下主机/分组/首页仍 v-show 常驻 -->
    <div v-if="app.settingsOpen" class="workspace-shell">
      <ChromeScope>
        <MainChromeBar title="设置" />
        <div class="content-pad content-pad--fill">
          <SettingsView />
        </div>
      </ChromeScope>
    </div>

    <!-- 本机工作区 -->
    <div
      v-if="!app.settingsOpen && app.workspace === 'local'"
      class="workspace-shell"
    >
      <ChromeScope>
        <MainChromeBar :title="localTitle" />
        <div
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
      </ChromeScope>
    </div>

    <!-- 通知工作区 -->
    <div
      v-if="!app.settingsOpen && app.workspace === 'notify'"
      class="workspace-shell"
    >
      <ChromeScope>
        <MainChromeBar :title="notifyTitle" />
        <div class="content-pad content-pad--fill">
          <NotifyMessagesView v-if="app.notifySection === 'messages'" />
          <NotifyHostSubsView
            v-else-if="
              app.notifySection === 'metricSubs' || app.notifySection === 'appSubs'
            "
          />
          <NotifyChannelsView v-else-if="app.notifySection === 'channels'" />
          <NotifyContentView v-else-if="app.notifySection === 'content'" />
        </div>
      </ChromeScope>
    </div>

    <!-- 全部主机首页：常驻（v-show 切换，零销毁零重载） -->
    <div
      v-show="!app.settingsOpen && app.workspace === 'remote' && !app.activeTab"
      class="workspace-shell"
    >
      <ChromeScope>
        <MainChromeBar title="全部主机" />
        <div class="content-pad">
          <AllHostsOverviewView />
        </div>
      </ChromeScope>
    </div>

    <!-- 分组视图：访问过的分组全部常驻，仅 v-show 切换 -->
    <div
      v-for="gid in app.visitedGroupIds"
      :key="gid"
      v-show="
        !app.settingsOpen &&
        app.workspace === 'remote' &&
        app.activeTab?.kind === 'group' &&
        app.activeTab.id === gid
      "
      class="workspace-shell"
    >
      <ChromeScope>
        <MainChromeBar :title="app.groupNameOf(gid)" />
        <div class="content-pad content-pad--fill">
          <GroupOverviewView :group-id="gid" :group-name="app.groupNameOf(gid)" />
        </div>
      </ChromeScope>
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
        <ChromeScope>
        <MainChromeBar v-if="!isMac" />
        <div
          class="content-pad"
          :class="{
            'content-pad--fill': isFillSub(sessionOf(hid)?.subTab),
          }"
        >
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
          <AptView
            v-if="visitedSub(hid, 'apt')"
            v-show="sessionOf(hid)?.subTab === 'apt'"
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
          <KeepAlive>
            <TerminalView
              v-if="sessionOf(hid)?.subTab === 'terminal'"
              :host="hid"
            />
          </KeepAlive>
        </div>
        </ChromeScope>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useAppStore, type SubTab } from "@/stores/app";
import ChromeScope from "@/components/ChromeScope.vue";
import MainChromeBar from "@/components/MainChromeBar.vue";
import OverviewView from "@/views/OverviewView.vue";
import MonitorView from "@/views/MonitorView.vue";
import AppsView from "@/views/AppsView.vue";
import NginxView from "@/views/NginxView.vue";
import GroupOverviewView from "@/views/GroupOverviewView.vue";
import ProcessesView from "@/views/ProcessesView.vue";
import NetworkView from "@/views/NetworkView.vue";
import HostsView from "@/views/HostsView.vue";
import AptView from "@/views/AptView.vue";
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
const isMac = /Mac|iPhone|iPad/.test(navigator.platform);

const localTitle = computed(() => {
  const map: Record<string, string> = {
    overview: "系统概览",
    procs: "应用进程",
    packages: "软件列表",
    storage: "磁盘空间",
    network: "网络信息",
    nginx: "Nginx",
    hosts: "Hosts",
    sysinfo: "关于本机",
  };
  return map[app.localSection] || "本机";
});

const notifyTitle = computed(() => {
  const map: Record<string, string> = {
    messages: "全部消息",
    metricSubs: "指标订阅",
    appSubs: "应用订阅",
    channels: "频道设置",
    content: "内容设置",
  };
  return map[app.notifySection] || "通知";
});

const FILL_SUBS: SubTab[] = [
  "overview",
  "terminal",
  "files",
  "processes",
  "apps",
  "nginx",
  "hosts",
  "apt",
  "monitor",
  "network",
  "services",
  "certs",
  "cron",
  "packages",
  "logs",
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
</script>

<style scoped lang="scss">
.workspace-shell,
.host-shell {
  flex: 1;
  min-height: 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
}

.host-shell,
.workspace-shell {
  padding: 0;
}

.content-pad {
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
  padding: 12px 16px 16px;
  box-sizing: border-box;
  background: transparent;

  &--fill {
    display: flex;
    flex-direction: column;
    padding: 0;
    overflow: hidden;
    > * {
      flex: 1 1 auto;
      min-height: 0;
      min-width: 0;
    }
  }

  &--local:not(.content-pad--fill) {
    display: flex;
    flex-direction: column;

    > * {
      flex: 1 0 auto;
      min-width: 0;
      width: 100%;
    }
  }
}
</style>
