<template>
  <el-config-provider :locale="zhCn" size="default">
    <div class="app-shell" @dragover="onTerminalWindowDragOver" @drop="onTerminalWindowDrop">
    <div
      class="app-chrome"
      :class="{
        'sidebar-collapsed': !app.sidebarOpen,
        'is-mac': isMac,
        'is-fullscreen': fullscreen,
        'is-term': app.workspace === 'terminal' && !app.settingsOpen,
      }"
    >
      <WorkspaceRail />
      <div class="main-column">
        <div class="main-column-body">
          <MainArea ref="mainAreaRef" @add-host="onAddHostRequest" />
        </div>
      </div>
      <!-- Windows/Linux 无边框窗口的全局窗口按钮：多数工作区顶栏已不固定
           MainChromeBar，右上角常驻一份（全屏隐藏）。挂在 app-chrome 内以
           继承 is-term 暗色令牌；贴顶条栏用 .win-ctl-pad 让位。 -->
      <div v-if="!isMac && !fullscreen" class="global-win-controls">
        <WinWindowControls />
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
        密码只用于首次连通并推送本机公钥，不作为日常登录。之后以
        <code>~/.ssh/config</code> 为准。
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
            placeholder="仅首次推公钥，不作为日常登录"
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
    <HostQuickSwitcher ref="hostSwitcherRef" />

    <!-- 主机/分组拖拽幽灵：侧栏与看板共用 -->
    <Teleport to="body">
      <div
        v-if="dragState?.active"
        :class="dragState.kind === 'group' ? 'group-drag-ghost' : 'host-drag-ghost'"
        :style="{
          left: dragState.x + 12 + 'px',
          top: dragState.y + 12 + 'px',
        }"
      >
        <el-icon>
          <Folder v-if="dragState.kind === 'group'" />
          <Monitor v-else />
        </el-icon>
        {{ dragState.label }}
      </div>
    </Teleport>

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
import { computed, nextTick, onBeforeUnmount, onMounted, provide, reactive, ref, watch } from "vue";
import { ElMessage } from "element-plus";
import zhCn from "element-plus/es/locale/lang/zh-cn";
import { api } from "@/api";
import type { main } from "@/api";
import { Events, Window } from "@wailsio/runtime";
import { useAppStore, UNGROUPED_ID, type SubTab } from "@/stores/app";
import { useAlertHistoryStore } from "@/stores/alertHistory";
import { useSettingsStore } from "@/stores/settings";
import { formatErr } from "@/utils/format";
import WorkspaceRail from "@/layout/WorkspaceRail.vue";
import WinWindowControls from "@/components/WinWindowControls.vue";
import MainArea from "@/layout/MainArea.vue";
import AgentInstallDialog from "@/components/AgentInstallDialog.vue";
import AgentCheckDialog from "@/components/AgentCheckDialog.vue";
import HostQuickSwitcher from "@/components/HostQuickSwitcher.vue";
import { chromeDragKey, type ChromeDragApi } from "@/composables/useChromeDrag";
import { hostDragKey, useHostDrag } from "@/composables/useHostDrag";
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
import {
  startCertAlertPoll,
  stopCertAlertPoll,
  tickCertAlertPoll,
} from "@/utils/certAlerts";
import { useLocalMetricsStore } from "@/stores/localMetrics";
import { clampContextMenuPos } from "@/utils/contextMenuPos";
import { isTermAppShortcut, isTermNewShortcut } from "@/utils/termKeys";
import { parseAppAlertKind } from "@/utils/watchServices";
import { Folder, Monitor } from "@element-plus/icons-vue";

const app = useAppStore();
const mainAreaRef = ref<{ openCreateGroup?: () => void } | null>(null);
const hostDrag = useHostDrag();
const { dragState } = hostDrag;
provide(hostDragKey, hostDrag);
const alertHistory = useAlertHistoryStore();
// 确保设置 store 初始化并应用主题/字体
const settings = useSettingsStore();
const localMetrics = useLocalMetricsStore();
void app.refresh();
const addHostOpen = ref(false);
const saving = ref(false);
const preferredAddGroupId = ref<string | null>(null);
const hostSwitcherRef = ref<{ show: () => void } | null>(null);
const form = reactive({
  name: "",
  hostName: "",
  groupId: "",
  user: "root",
  password: "",
  note: "",
});

type TerminalDeskDrag = { sourceWindowId?: string; sourceDeskId?: string };

function readTerminalDeskDrag(e: DragEvent): TerminalDeskDrag | null {
  const raw = e.dataTransfer?.getData("application/x-terminal-desk") || "";
  if (!raw) return null;
  try {
    const payload = JSON.parse(raw) as TerminalDeskDrag;
    return payload.sourceDeskId ? payload : null;
  } catch {
    return null;
  }
}

function onTerminalWindowDragOver(e: DragEvent) {
  if (!Array.from(e.dataTransfer?.types || []).includes("application/x-terminal-desk")) return;
  e.preventDefault();
  if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
}

function onTerminalWindowDrop(e: DragEvent) {
  const payload = readTerminalDeskDrag(e);
  if (!payload || payload.sourceWindowId === app.windowId) return;
  e.preventDefault();
  void Events.Emit("terminal-window-drop", {
    sourceWindowId: payload.sourceWindowId || "",
    sourceDeskId: payload.sourceDeskId || "",
    targetWindowId: app.windowId,
  });
}

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
  const gid = (app.homeSelectedGroupId || "").trim();
  if (gid && gid !== UNGROUPED_ID) {
    form.groupId = gid;
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

/** Esc：关闭设置整页 */
function onSettingsEsc(e: KeyboardEvent) {
  if (e.key !== "Escape") return;
  if (hasVisibleOverlay()) return;
  if (app.settingsOpen) {
    e.preventDefault();
    app.closeSettings();
  }
}

/** 终端聚焦时不抢快捷键（xterm 把焦点放在 helper textarea） */
function isTerminalFocused(): boolean {
  const el = document.activeElement as HTMLElement | null;
  if (!el) return false;
  if (el.classList?.contains("xterm-helper-textarea")) return true;
  if (el.closest?.(".xterm, .term-body, .term-page")) return true;
  return false;
}

function isTypingAside(e: KeyboardEvent): boolean {
  const t = e.target;
  if (!(t instanceof HTMLElement)) return false;
  if (t.closest(".xterm, .term-page")) return false;
  return t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable;
}

/** 主机是固定第一项；正向从主机进第一个会话，反向从第一个会话回主机 */
function cycleMainTab(dir: 1 | -1) {
  const list = app.workspaceSessions;
  const cur = app.activeSessionId;
  const idx = list.findIndex((s) => s.id === cur);
  if (idx < 0) {
    if (list.length === 0) return;
    const next = dir === 1 ? list[0] : list[list.length - 1];
    if (next) app.activateWorkspaceSession(next.id);
    return;
  }
  const nextIdx = idx + dir;
  if (nextIdx < 0 || nextIdx >= list.length) {
    app.goHome();
    return;
  }
  app.activateWorkspaceSession(list[nextIdx].id);
}

/** 关闭当前工作区会话；在分组列表时 noop */
function closeActiveMainTab() {
  const id = app.activeSessionId;
  if (!id) return;
  app.closeWorkspaceSession(id);
}

/** 设置 / 侧栏 / 添加主机 / 新建分组 / 搜索 / 刷新 / 退出 / 回首页 / 切标签 / 关标签 */
function onGlobalKeydown(e: KeyboardEvent) {
  if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
  if (e.key === "Escape") return;

  if (
    app.workspace === "terminal" &&
    !app.settingsOpen &&
    !isTypingAside(e) &&
    isTermNewShortcut(e, isMac)
  ) {
    e.preventDefault();
    app.runTermAction("new");
    return;
  }

  if (
    app.workspace === "terminal" &&
    !app.settingsOpen &&
    !isTypingAside(e) &&
    isTermAppShortcut(e, isMac)
  ) {
    if (e.shiftKey && e.code === "KeyL") {
      e.preventDefault();
      app.runTermAction("sessions");
      return;
    }
    if (e.shiftKey && e.code === "KeyM") {
      e.preventDefault();
      app.runTermAction("detach");
      return;
    }
    if (e.shiftKey && e.code === "KeyW") {
      e.preventDefault();
      app.runTermAction("close-session");
      return;
    }
    if (e.shiftKey && e.code === "KeyD") {
      e.preventDefault();
      app.runTermAction("split-down");
      return;
    }
    if (!e.shiftKey && e.code === "KeyD") {
      e.preventDefault();
      app.runTermAction("split-right");
      return;
    }
    if (!e.shiftKey && e.code === "KeyW") {
      e.preventDefault();
      app.runTermAction("close-pane");
      return;
    }
  }

  // ⌘⇧N / Ctrl+Shift+N：新建分组（须在无 Shift 的 ⌘N 之前处理）
  if (e.shiftKey && e.code === "KeyN") {
    if (app.workspace !== "remote") return;
    e.preventDefault();
    if (!app.sidebarOpen) app.setSidebarOpen(true);
    // 侧栏可能刚挂载，多等一帧再调 expose
    void nextTick(() => {
      void nextTick(() => mainAreaRef.value?.openCreateGroup?.());
    });
    return;
  }

  // ⌘⇧[ / ⌘⇧]：工作区标签。窗格切换是不带 Shift 的 ⌘[ / ⌘]
  if (e.shiftKey && (e.code === "BracketLeft" || e.code === "BracketRight")) {
    if (app.workspace !== "remote") return;
    e.preventDefault();
    cycleMainTab(e.code === "BracketRight" ? 1 : -1);
    return;
  }

  // ⌘⇧H：回当前分组主机列表（终端聚焦时不拦截）
  if (e.shiftKey && e.code === "KeyH") {
    if (app.workspace === "terminal") {
      e.preventDefault();
      app.runTermAction("return-host");
      return;
    }
    if (isTerminalFocused()) return;
    if (app.workspace !== "remote") return;
    e.preventDefault();
    app.goHome();
    return;
  }

  if (e.shiftKey) return;

  // ⌘W：关闭当前标签（终端聚焦时不拦截）
  if (e.code === "KeyW") {
    if (isTerminalFocused()) return;
    if (app.workspace !== "remote") return;
    e.preventDefault();
    closeActiveMainTab();
    return;
  }

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
    app.openHomeHostSearch();
    return;
  }
  if (e.code === "KeyK") {
    if (isTerminalFocused()) return;
    e.preventDefault();
    hostSwitcherRef.value?.show();
    return;
  }
  if (e.code === "KeyR") {
    e.preventDefault();
    void app.refresh();
    return;
  }
  if (e.code === "KeyQ") {
    // 只认平台原生组合：mac ⌘Q、Win/Linux Ctrl+Q。mac 上 Ctrl+Q 不触发退出（终端里是 XON，留给 PTY）
    const isQuitKey = isMac ? e.metaKey && !e.ctrlKey : e.ctrlKey;
    if (!isQuitKey) return;
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
  // 原生菜单快捷键只操作主窗口内嵌终端，不自动创建独立终端窗。
  eventOffs.push(
    Events.On("main-terminal-action", (ev: { data?: unknown }) => {
      const action = typeof ev?.data === "string" ? ev.data.trim() : "";
      if (!action) return;
      app.setWorkspace("terminal");
      app.runTermAction(action);
    }) as unknown as () => void
  );
  eventOffs.push(
    Events.On("terminal-window-command", async (ev: { data?: main.TerminalWindowCommand }) => {
      const command = ev?.data;
      if (!command || command.windowId !== app.windowId) return;
      if (command.action !== "move-transfer" || !command.transferId) return;
      try {
        const transfer = await api.takeTerminalTransfer(command.transferId);
        app.setWorkspace("terminal");
        const deskId = app.openTransferredTerminal(transfer);
        if (deskId && command.targetDeskId) {
          app.reorderTerminalDesk(deskId, command.targetDeskId, command.insertBefore === true);
        }
      } catch (err) {
        console.error("主窗口领取终端会话失败", err);
      }
    }) as unknown as () => void
  );
  // 终端独立窗返回主机工具：由主窗承接主机页面，再把主窗聚焦到前台。
  eventOffs.push(
    Events.On("terminal-return-host", (ev: { data?: { host?: string; sub?: string } }) => {
      const name = (ev?.data?.host || "").trim();
      const sub = (ev?.data?.sub || "").trim() as SubTab;
      const allowed: SubTab[] = [
        "overview",
        "file-manager",
        "monitor",
        "files",
        "apps",
        "nginx",
        "processes",
        "network",
        "hosts",
        "apt",
        "services",
        "certs",
        "cron",
        "packages",
        "logs",
      ];
      if (!name || !allowed.includes(sub)) return;
      app.openHostTab(name, sub);
      void api.focusMainWindow();
    })
  );
  eventOffs.push(
    Events.On(
      "terminal-window-drop",
      (ev: {
        data?: {
          sourceWindowId?: string;
          sourceDeskId?: string;
          targetWindowId?: string;
          targetDeskId?: string;
          insertBefore?: boolean;
        };
      }) => {
        const data = ev?.data;
        if (!data || data.sourceWindowId !== app.windowId || !data.sourceDeskId) return;
        app.activateTerminalDesk(data.sourceDeskId);
        app.runTermAction("move-to-window", {
          targetWindowId: data.targetWindowId || "",
          targetDeskId: data.targetDeskId || "",
          insertBefore: data.insertBefore ? "1" : "0",
        });
      }
    ) as unknown as () => void
  );
  // 分组页空状态「添加主机」：打开添加弹窗并预选当前分组
  eventOffs.push(
    Events.On("app-add-host", (ev: { data?: { groupId?: string } }) => {
      const gid = (ev?.data?.groupId || "").trim();
      preferredAddGroupId.value = gid || null;
      addHostOpen.value = true;
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

      /** 按告警类型落到「指标消息」或「应用消息」 */
      const sectionOfEvent = (id: string): "metricMessages" | "appMessages" => {
        const ev = alertHistory.events.find((e) => e.id === id);
        if (!ev) return "metricMessages";
        const isApp = !!parseAppAlertKind(ev.kind) || (ev.kind || "").startsWith("app:");
        return isApp ? "appMessages" : "metricMessages";
      };

      const focusId = resolveFocusId();
      if (focusId) {
        app.setFocusAlertId(focusId);
      }
      app.setWorkspace("notify");
      app.setNotifySection(sectionOfEvent(focusId));
      void api.focusMainWindow();
      void alertHistory.refresh().then(() => {
        if (app.focusAlertId) return;
        const again = resolveFocusId();
        if (again) {
          app.setFocusAlertId(again);
          app.setNotifySection(sectionOfEvent(again));
        }
      });
    })
  );
  eventOffs.push(
    Events.On("alert-poll-tick", () => {
      tickAppWatchAlertPoll();
      tickHostResourceAlertPoll();
      tickCertAlertPoll();
    })
  );
  eventOffs.push(
    Events.On("alert-history-updated", () => {
      void alertHistory.refresh();
    })
  );
  // 等订阅hydrate后再开轮询；tick 只打已订阅名单，空订阅不扫全集
  void settings.hydrateNotifySubs().then(() => {
    startAppWatchAlertPoll();
    startHostResourceAlertPoll();
    startCertAlertPoll();
  });
  // 本机指标：客户端运行即静默采集（与当前页无关）
  localMetrics.start();
});
onBeforeUnmount(() => {
  localMetrics.stop();
  stopAppWatchAlertPoll();
  stopHostResourceAlertPoll();
  stopCertAlertPoll();
  window.removeEventListener("keydown", onGlobalKeydown, true);
  window.removeEventListener("keydown", onSettingsEsc);
  eventOffs.forEach((off) => off());
  eventOffs.length = 0;
});
</script>

<style lang="scss">
/* 右上角常驻窗口按钮：层级压过工作区与侧栏（z 80）、低于 Element 弹层（2000+）。
   高度对齐通栏 chrome 高度，hover 底色与各顶栏严丝合缝。 */
.global-win-controls {
  position: fixed;
  top: 0;
  right: 0;
  z-index: 90;
  display: flex;
}
.global-win-controls .win-controls {
  height: var(--m3-chrome-height);
  margin-right: 0;
}
.app-chrome .global-win-controls .win-btn {
  height: 100%;
}

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

/* 拖拽幽灵挂 body（侧栏与看板共用） */
.host-drag-ghost,
.group-drag-ghost {
  position: fixed;
  z-index: 99999;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  border-radius: var(--m3-shape-m);
  background: var(--m3-surface-container-high);
  color: var(--m3-on-surface);
  font: var(--m3-label-large);
  box-shadow: var(--m3-elevation-3);
  border: 1px solid var(--m3-outline-variant);
  pointer-events: none;
  max-width: 240px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
