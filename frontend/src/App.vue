<template>
  <el-config-provider :locale="zhCn" size="default">
    <div class="app-shell">
    <div
      class="app-chrome"
      :class="{
        'sidebar-collapsed': !app.sidebarOpen,
        'is-mac': isMac,
        'is-fullscreen': fullscreen,
      }"
    >
      <WorkspaceRail />
      <SidebarSettings
        v-if="app.sidebarOpen && app.settingsOpen"
      />
      <SidebarHost
        v-else-if="app.sidebarOpen && app.workspace === 'remote'"
        ref="sidebarHostRef"
        @add-host="onAddHostRequest"
      />
      <SidebarLocal
        v-else-if="app.sidebarOpen && app.workspace === 'local'"
      />
      <SidebarNotify
        v-else-if="app.sidebarOpen && app.workspace === 'notify'"
      />
      <div class="main-column">
        <MainArea />
      </div>
    </div>

    <el-dialog
      v-model="addHostOpen"
      title="添加主机"
      width="560px"
      append-to-body
      destroy-on-close
      class="m3-form-dialog"
      :close-on-click-modal="!saving"
    >
      <p class="m3-form-dialog__hint">
        验证连通后会推送本机公钥并写入
        <code>~/.ssh/config</code>；密码会保存在本机，并随备份导出。
      </p>
      <el-form label-position="top" require-asterisk-position="right" @submit.prevent="onAddHost">
        <el-form-item label="别名" required>
          <el-input v-model="form.name" placeholder="如 prod-01" />
        </el-form-item>
        <el-form-item label="地址" required>
          <el-input v-model="form.hostName" placeholder="IP 或域名" />
        </el-form-item>
        <el-form-item label="分组">
          <!-- teleported=false：下拉挂在对话框内，避免被全局 .el-overlay(z=99998) 挡住 -->
          <el-select
            v-model="form.groupId"
            placeholder="未分组"
            clearable
            filterable
            :teleported="false"
            style="width: 100%"
          >
            <el-option
              v-for="n in app.flattenGroupNodes()"
              :key="n.group!.id"
              :label="`${'　'.repeat(Math.max(n.depth - 1, 0))}${n.group!.name}`"
              :value="n.group!.id"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="用户" required>
          <el-input v-model="form.user" placeholder="root" />
        </el-form-item>
        <el-form-item label="密码" required>
          <el-input
            v-model="form.password"
            type="password"
            show-password
            placeholder="用于验证、推送公钥，并保存在本机"
            @keyup.enter="onAddHost"
          />
        </el-form-item>
        <el-form-item label="备注">
          <el-input
            v-model="form.note"
            type="textarea"
            :rows="2"
            maxlength="200"
            show-word-limit
            placeholder="可选，仅保存在本机，不写入 SSH 配置"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button :disabled="saving" @click="addHostOpen = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="onAddHost">
          {{ saving ? "连接中..." : "保存" }}
        </el-button>
      </template>
    </el-dialog>

    <AgentInstallDialog />
    <AgentCheckDialog />

    <!-- 壳层右键：展开/收起侧栏 -->
    <Teleport to="body">
      <div
        v-if="chromeMenu"
        class="chrome-ctx-backdrop"
        @mousedown="closeChromeMenu"
        @contextmenu.prevent="closeChromeMenu"
      />
      <div
        v-if="chromeMenu"
        class="chrome-ctx-menu"
        :style="{ left: chromeMenu.x + 'px', top: chromeMenu.y + 'px' }"
        @mousedown.stop
      >
        <button type="button" class="ctx-item" @click="onToggleSidebarFromMenu">
          {{ app.sidebarOpen ? "收起侧栏" : "展开侧栏" }}
          <span class="ctx-kbd">{{ kbd("B") }}</span>
        </button>
      </div>
    </Teleport>
    </div>
  </el-config-provider>
</template>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, provide, reactive, ref, watch } from "vue";
import { ElMessage } from "element-plus";
import zhCn from "element-plus/es/locale/lang/zh-cn";
import { api } from "@/api";
import { Events, Window } from "@wailsio/runtime";
import { useAppStore, UNGROUPED_ID } from "@/stores/app";
import { useAlertHistoryStore } from "@/stores/alertHistory";
import { useSettingsStore } from "@/stores/settings";
import { formatErr } from "@/utils/format";
import SidebarHost from "@/layout/SidebarHost.vue";
import SidebarLocal from "@/layout/SidebarLocal.vue";
import SidebarNotify from "@/layout/SidebarNotify.vue";
import SidebarSettings from "@/layout/SidebarSettings.vue";
import WorkspaceRail from "@/layout/WorkspaceRail.vue";
import MainArea from "@/layout/MainArea.vue";
import AgentInstallDialog from "@/components/AgentInstallDialog.vue";
import AgentCheckDialog from "@/components/AgentCheckDialog.vue";
import { chromeDragKey, type ChromeDragApi } from "@/composables/useChromeDrag";
import {
  startAppWatchAlertPoll,
  stopAppWatchAlertPoll,
  tickAppWatchAlertPoll,
} from "@/utils/appWatchAlerts";
import {
  startHostResourceAlertPoll,
  stopHostResourceAlertPoll,
  tickHostResourceAlertPoll,
} from "@/utils/hostResourceAlerts";
import { useLocalMetricsStore } from "@/stores/localMetrics";
import { clampContextMenuPos } from "@/utils/contextMenuPos";

const app = useAppStore();
const alertHistory = useAlertHistoryStore();
// 确保设置 store 初始化并应用主题/字体
const settings = useSettingsStore();
const localMetrics = useLocalMetricsStore();
void app.refresh();
const addHostOpen = ref(false);
const saving = ref(false);
const preferredAddGroupId = ref<string | null>(null);
const sidebarHostRef = ref<{ openCreateGroup?: () => void } | null>(null);
const form = reactive({
  name: "",
  hostName: "",
  groupId: "",
  user: "root",
  password: "",
  note: "",
});

/** 打开添加弹窗：优先用右键传入的分组，否则按当前分组 tab 预选 */
watch(addHostOpen, (open) => {
  if (!open) {
    preferredAddGroupId.value = null;
    return;
  }
  const preferred = (preferredAddGroupId.value || "").trim();
  if (preferred && preferred !== UNGROUPED_ID) {
    form.groupId = preferred;
    return;
  }
  const tab = app.activeTab;
  if (tab?.kind === "group" && tab.id && tab.id !== UNGROUPED_ID) {
    form.groupId = tab.id;
  } else {
    form.groupId = "";
  }
});

function onAddHostRequest(groupId?: string) {
  preferredAddGroupId.value = groupId?.trim() || null;
  addHostOpen.value = true;
}

const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
function kbd(key: string): string {
  return isMac ? `⌘${key}` : `Ctrl+${key}`;
}

const maximised = ref(false);
const fullscreen = ref(false);
const chromeMenu = ref<{ x: number; y: number } | null>(null);

function openChromeMenu(e: MouseEvent) {
  e.preventDefault();
  chromeMenu.value = clampContextMenuPos(e.clientX, e.clientY, 200, 56);
}

function closeChromeMenu() {
  chromeMenu.value = null;
}

function onToggleSidebarFromMenu() {
  app.toggleSidebar();
  closeChromeMenu();
}

async function toggleMaximise() {
  await Window.ToggleMaximise();
  maximised.value = await Window.IsMaximised();
}

function minimiseWin() {
  void Window.Minimise();
}

function hideToBackground() {
  void Events.Emit("app-hide-to-background");
}

const chromeDragApi: ChromeDragApi = {
  openMenu: openChromeMenu,
  toggleMaximise,
  minimiseWin,
  hideToBackground,
  maximised,
  isMac,
  kbd,
};
provide(chromeDragKey, chromeDragApi);

/** 可见的 Element Plus 遮罩（关闭态的 dialog 会留下 display:none 的 overlay） */
function hasVisibleOverlay(): boolean {
  for (const el of document.querySelectorAll(".el-overlay")) {
    const s = getComputedStyle(el);
    if (s.display === "none" || s.visibility === "hidden") continue;
    return true;
  }
  return false;
}

/** Esc：先让弹窗 / 侧栏搜索自己关掉；都没有再退出设置整页 */
function onSettingsEsc(e: KeyboardEvent) {
  if (e.key !== "Escape") return;
  if (!app.settingsOpen) return;
  if (app.sidebarSearchOpen) return;
  if (hasVisibleOverlay()) return;
  e.preventDefault();
  app.closeSettings();
}

/** 设置 / 侧栏 / 添加主机 / 新建分组 / 搜索 / 刷新 / 退出 */
function onGlobalKeydown(e: KeyboardEvent) {
  if (!(e.metaKey || e.ctrlKey) || e.altKey) return;

  // ⌘⇧N / Ctrl+Shift+N：新建分组（须在无 Shift 的 ⌘N 之前处理）
  if (e.shiftKey && e.code === "KeyN") {
    if (app.workspace !== "remote") return;
    e.preventDefault();
    if (!app.sidebarOpen) app.setSidebarOpen(true);
    // 侧栏可能刚挂载，多等一帧再调 expose
    void nextTick(() => {
      void nextTick(() => sidebarHostRef.value?.openCreateGroup?.());
    });
    return;
  }

  if (e.shiftKey) return;

  const isComma = e.key === "," || e.code === "Comma" || e.key === "，";
  if (isComma) {
    e.preventDefault();
    app.toggleSettings();
    return;
  }
  if (e.code === "KeyB") {
    e.preventDefault();
    app.toggleSidebar();
    return;
  }
  if (e.code === "KeyN") {
    if (app.workspace !== "remote") return;
    e.preventDefault();
    preferredAddGroupId.value = null;
    addHostOpen.value = true;
    return;
  }
  if (e.code === "KeyF") {
    if (app.workspace !== "remote") return;
    e.preventDefault();
    app.setSidebarSearchOpen(true);
    return;
  }
  if (e.code === "KeyR") {
    e.preventDefault();
    void app.refresh();
    return;
  }
  if (e.code === "KeyQ") {
    e.preventDefault();
    void Events.Emit("app-request-quit");
  }
}

async function onAddHost() {
  const name = form.name.trim();
  const hostName = form.hostName.trim();
  const user = form.user.trim();
  if (!name || !hostName || !user || !form.password) {
    ElMessage.warning("别名、地址、用户、密码均不能为空");
    return;
  }
  saving.value = true;
  try {
    await api.addHost({
      name,
      hostName,
      user,
      password: form.password, // 密码不 trim
      note: form.note.trim(),
    });
    const groupId = (form.groupId || "").trim();
    if (groupId) {
      await app.assignHost(name, groupId);
    }
    ElMessage.success("已添加（公钥已推送）");
    addHostOpen.value = false;
    form.name = "";
    form.hostName = "";
    form.groupId = "";
    form.password = "";
    form.note = "";
    await app.refresh();
  } catch (e) {
    ElMessage.error(formatErr(e));
  } finally {
    saving.value = false;
  }
}

/** v3 事件订阅：Events.On 返回退订函数，逐个保存后统一释放 */
const eventOffs: (() => void)[] = [];

onMounted(() => {
  window.addEventListener("keydown", onGlobalKeydown, true);
  window.addEventListener("keydown", onSettingsEsc);
  void Window.IsMaximised().then((v) => {
    maximised.value = v;
  });
  void Window.IsFullscreen().then((v) => {
    fullscreen.value = v;
  });
  eventOffs.push(
    Events.On(Events.Types.Common.WindowFullscreen, () => {
      fullscreen.value = true;
    })
  );
  eventOffs.push(
    Events.On(Events.Types.Common.WindowUnFullscreen, () => {
      fullscreen.value = false;
    })
  );
  eventOffs.push(
    Events.On(Events.Types.Mac.WindowDidEnterFullScreen, () => {
      fullscreen.value = true;
    })
  );
  eventOffs.push(
    Events.On(Events.Types.Mac.WindowDidExitFullScreen, () => {
      fullscreen.value = false;
    })
  );
  eventOffs.push(
    Events.On(Events.Types.Common.WindowMaximise, () => {
      maximised.value = true;
    })
  );
  eventOffs.push(
    Events.On(Events.Types.Common.WindowUnMaximise, () => {
      maximised.value = false;
    })
  );
  eventOffs.push(
    Events.On(Events.Types.Common.WindowRestore, () => {
      maximised.value = false;
    })
  );
  eventOffs.push(
    Events.On("host-icon-updated", (ev: { data?: { host?: string; osRelease?: string } }) => {
      const it = ev?.data;
      if (it?.host && it?.osRelease) {
        app.rememberOsRelease(it.host, it.osRelease);
      }
    })
  );
  // 看板独立窗双击主机：主窗打开监控会话并聚焦（不关看板）
  eventOffs.push(
    Events.On("board-open-host", (ev: { data?: { name?: string } }) => {
      const name = (ev?.data?.name || "").trim();
      if (!name) return;
      app.openHostTab(name, "monitor");
      void api.focusMainWindow();
    })
  );
  // 系统通知点击：进入通知工作区「消息」并定位对应告警
  eventOffs.push(
    Events.On("alert-open-host", (ev: { data?: { host?: string; eventId?: string } }) => {
      const host = (ev?.data?.host || "").trim();
      const payloadEventId = (ev?.data?.eventId || "").trim();

      const resolveFocusId = (): string => {
        if (payloadEventId) return payloadEventId;
        if (!host) return "";
        const list = alertHistory.events.filter(
          (e) => (e.host || "").trim() === host
        );
        const unread = list.find((e) => !e.read);
        if (unread?.id) return unread.id;
        if (list[0]?.id) return list[0].id;
        return "";
      };

      const focusId = resolveFocusId();
      if (focusId) {
        app.setFocusAlertId(focusId);
      }
      app.setWorkspace("notify");
      app.setNotifySection("messages");
      void api.focusMainWindow();
      void alertHistory.refresh().then(() => {
        if (app.focusAlertId) return;
        const again = resolveFocusId();
        if (again) app.setFocusAlertId(again);
      });
    })
  );
  eventOffs.push(
    Events.On("alert-poll-tick", () => {
      tickAppWatchAlertPoll();
      tickHostResourceAlertPoll();
    })
  );
  eventOffs.push(
    Events.On("alert-history-updated", () => {
      void alertHistory.refresh();
    })
  );
  void settings.hydrateNotifySubs().then(() => {
    startAppWatchAlertPoll();
    startHostResourceAlertPoll();
  });
  // 本机指标：客户端运行即静默采集（与当前页无关）
  localMetrics.start();
});
onBeforeUnmount(() => {
  localMetrics.stop();
  stopAppWatchAlertPoll();
  stopHostResourceAlertPoll();
  window.removeEventListener("keydown", onGlobalKeydown, true);
  window.removeEventListener("keydown", onSettingsEsc);
  eventOffs.forEach((off) => off());
  eventOffs.length = 0;
});
</script>

<style lang="scss">
.chrome-ctx-backdrop {
  position: fixed;
  inset: 0;
  z-index: 4000;
}
.chrome-ctx-menu {
  position: fixed;
  z-index: 4001;
  min-width: 168px;
  padding: 8px;
  border-radius: var(--m3-shape-s);
  border: 1px solid var(--m3-outline-variant);
  background: var(--m3-surface-container-lowest);
  box-shadow: var(--m3-elevation-3);
}
.chrome-ctx-menu .ctx-item {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  min-height: 40px;
  padding: 8px 12px;
  border: 0;
  border-radius: var(--m3-shape-xs);
  background: transparent;
  font: var(--m3-label-large);
  color: var(--m3-on-surface);
  text-align: left;
  cursor: pointer;
}
.chrome-ctx-menu .ctx-item:hover {
  background: color-mix(in srgb, var(--m3-primary) 8%, transparent);
}
.chrome-ctx-menu .ctx-kbd {
  font: var(--m3-body-small);
  color: var(--m3-on-surface-variant);
}
</style>
