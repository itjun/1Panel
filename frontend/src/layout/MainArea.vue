<template>
  <div class="main-container">
    <div v-if="app.settingsOpen" class="workspace-shell">
      <ChromeScope>
        <MainChromeBar title="设置" />
        <div class="content-pad content-pad--fill">
          <SettingsView />
        </div>
      </ChromeScope>
    </div>

    <div
      v-if="!app.settingsOpen && app.workspace === 'notify'"
      class="workspace-shell"
    >
      <div class="workspace-stage">
        <div
          v-if="app.visitedNotifySections.includes('metricMessages')"
          v-show="app.notifySection === 'metricMessages'"
          class="session-fill"
        >
          <NotifyMessagesView kind="metric" />
        </div>
        <div
          v-if="app.visitedNotifySections.includes('appMessages')"
          v-show="app.notifySection === 'appMessages'"
          class="session-fill"
        >
          <NotifyMessagesView kind="app" />
        </div>
        <div
          v-if="app.visitedNotifySections.includes('metricSubs')"
          v-show="app.notifySection === 'metricSubs'"
          class="session-fill"
        >
          <NotifySubsView kind="metric" />
        </div>
        <div
          v-if="app.visitedNotifySections.includes('appSubs')"
          v-show="app.notifySection === 'appSubs'"
          class="session-fill"
        >
          <NotifySubsView kind="app" />
        </div>
        <div
          v-if="app.visitedNotifySections.includes('setup')"
          v-show="app.notifySection === 'setup'"
          class="session-fill"
        >
          <NotifySetupView />
        </div>
      </div>
    </div>

    <div
      v-if="
        !app.settingsOpen &&
        app.workspace === 'remote' &&
        !app.activeSessionId &&
        app.activeView?.kind !== 'group'
      "
      class="workspace-shell"
    >
      <div class="home-board">
        <SidebarHost
          ref="sidebarHostRef"
          @add-host="emit('add-host', $event)"
        />
      </div>
    </div>

    <div
      v-if="
        !app.settingsOpen &&
        app.workspace === 'remote' &&
        !app.activeSessionId &&
        app.activeView?.kind === 'group'
      "
      class="workspace-shell"
    >
      <ChromeScope>
        <MainChromeBar :title="app.activeView.title" />
        <div class="content-pad content-pad--fill">
          <GroupOverviewView
            :group-id="app.activeView.id"
            :group-name="app.activeView.title"
          />
        </div>
      </ChromeScope>
    </div>

    <div
      v-if="!app.settingsOpen && app.workspace === 'remote' && !!app.activeSessionId"
      class="host-shell"
    >
      <HostWorkspaceBar
        v-if="activeHost"
        :session="activeHost"
      />
      <div class="workspace-stage">
        <div
          v-for="sess in hostWorkspaces"
          :key="sess.id"
          v-show="app.activeSessionId === sess.id"
          class="session-fill"
        >
          <SessionBody :session="sess" />
        </div>
      </div>
    </div>

    <TerminalModule v-show="!app.settingsOpen && app.workspace === 'terminal'" />

  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { useAppStore } from "@/stores/app";
import ChromeScope from "@/components/ChromeScope.vue";
import MainChromeBar from "@/components/MainChromeBar.vue";
import SidebarHost from "@/layout/SidebarHost.vue";
import HostWorkspaceBar from "@/layout/HostWorkspaceBar.vue";
import TerminalModule from "@/layout/TerminalModule.vue";
import SettingsView from "@/views/SettingsView.vue";
import SessionBody from "@/layout/SessionBody.vue";
import NotifyMessagesView from "@/views/NotifyMessagesView.vue";
import NotifySubsView from "@/views/NotifySubsView.vue";
import NotifySetupView from "@/views/NotifySetupView.vue";
import GroupOverviewView from "@/views/GroupOverviewView.vue";

const app = useAppStore();

const emit = defineEmits<{
  "add-host": [groupId?: string];
}>();

const sidebarHostRef = ref<{ openCreateGroup?: (parentId?: string) => void } | null>(null);

function openCreateGroup() {
  sidebarHostRef.value?.openCreateGroup?.();
}

defineExpose({ openCreateGroup });

const activeHost = computed(() => {
  const s = app.activeSession;
  if (!s || s.role !== "host") return null;
  return s;
});

const hostWorkspaces = computed(() => app.workspaceSessions);
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
}

.session-fill {
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  background: #fff;
}

.workspace-stage {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.host-shell {
  background: var(--m3-content);
}

.home-board {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  background: #fff;
}
</style>
