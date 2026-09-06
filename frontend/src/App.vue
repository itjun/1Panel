<template>
  <el-config-provider :locale="zhCn" size="default">
    <div class="app-shell">
    <!-- 两列通栏：左列 mac 红绿灯 + 侧栏开关；右列标题（非 mac 再加窗口按钮） -->
    <div
      class="app-chrome"
      :class="{
        'sidebar-collapsed': !app.sidebarOpen,
        'is-mac': isMac,
        'is-fullscreen': fullscreen,
      }"
    >
      <div
        class="titlebar-left drag-region"
        @dblclick="toggleMaximise"
        @contextmenu.prevent="openTitlebarMenu"
      >
        <div class="titlebar-tools no-drag" @dblclick.stop @contextmenu.stop>
          <el-button
            text
            class="titlebar-btn"
            :title="app.sidebarOpen ? `收起侧栏 (${kbd('B')})` : `展开侧栏 (${kbd('B')})`"
            @click="app.toggleSidebar()"
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
        </div>
      </div>
      <div
        class="titlebar-right drag-region"
        @dblclick="toggleMaximise"
        @contextmenu.prevent="openTitlebarMenu"
      >
        <span class="titlebar-title">{{ titlebarTitle }}</span>
        <div v-if="!isMac" class="win-controls no-drag" @dblclick.stop @contextmenu.stop>
          <button
            type="button"
            class="win-btn"
            title="最小化"
            @click="minimiseWin"
          >
            <svg viewBox="0 0 12 12">
              <path d="M2 6h8" />
            </svg>
          </button>
          <button
            type="button"
            class="win-btn"
            :title="maximised ? '还原' : '最大化'"
            @click="toggleMaximise"
          >
            <svg v-if="!maximised" viewBox="0 0 12 12">
              <rect x="2.5" y="2.5" width="7" height="7" rx="0.5" />
            </svg>
            <svg v-else viewBox="0 0 12 12">
              <path d="M4 3.5h4.5V8" />
              <rect x="2.5" y="4.5" width="5.5" height="4.5" rx="0.4" />
            </svg>
          </button>
          <button
            type="button"
            class="win-btn win-btn-close"
            :title="`关闭 (${kbd('Q')})`"
            @click="quitApp"
          >
            <svg viewBox="0 0 12 12">
              <path d="M3 3l6 6M9 3l-6 6" />
            </svg>
          </button>
        </div>
      </div>
      <SidebarHost
        v-show="app.sidebarOpen"
        @add-host="addHostOpen = true"
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
        <code>~/.ssh/config</code>，密码仅本次使用、不落盘。
      </p>
      <el-form label-position="top" require-asterisk-position="right" @submit.prevent="onAddHost">
        <el-form-item label="别名" required>
          <el-input v-model="form.name" placeholder="如 prod-01" />
        </el-form-item>
        <el-form-item label="地址" required>
          <el-input v-model="form.hostName" placeholder="IP 或域名" />
        </el-form-item>
        <el-form-item label="用户" required>
          <el-input v-model="form.user" placeholder="root" />
        </el-form-item>
        <el-form-item label="密码" required>
          <el-input
            v-model="form.password"
            type="password"
            show-password
            placeholder="仅用于本次验证与推送公钥"
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

    <!-- 标题栏右键：展开/收起侧栏 -->
    <Teleport to="body">
      <div
        v-if="titlebarMenu"
        class="titlebar-ctx-backdrop"
        @mousedown="closeTitlebarMenu"
        @contextmenu.prevent="closeTitlebarMenu"
      />
      <div
        v-if="titlebarMenu"
        class="titlebar-ctx-menu"
        :style="{ left: titlebarMenu.x + 'px', top: titlebarMenu.y + 'px' }"
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
import { computed, onBeforeUnmount, onMounted, reactive, ref } from "vue";
import { ElMessage } from "element-plus";
import zhCn from "element-plus/es/locale/lang/zh-cn";
import { api } from "@/api";
import { Application, Events, Window } from "@wailsio/runtime";
import { useAppStore } from "@/stores/app";
import { useSettingsStore } from "@/stores/settings";
import { formatErr } from "@/utils/format";
import SidebarHost from "@/layout/SidebarHost.vue";
import MainArea from "@/layout/MainArea.vue";
import AgentInstallDialog from "@/components/AgentInstallDialog.vue";

const app = useAppStore();
// 确保设置 store 初始化并应用主题/字体
useSettingsStore();
void app.refresh();
const addHostOpen = ref(false);
const saving = ref(false);
const form = reactive({
  name: "",
  hostName: "",
  user: "root",
  password: "",
  note: "",
});

const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
function kbd(key: string): string {
  return isMac ? `⌘${key}` : `Ctrl+${key}`;
}

const maximised = ref(false);
const fullscreen = ref(false);
const titlebarMenu = ref<{ x: number; y: number } | null>(null);

function openTitlebarMenu(e: MouseEvent) {
  titlebarMenu.value = { x: e.clientX, y: e.clientY };
}

function closeTitlebarMenu() {
  titlebarMenu.value = null;
}

function onToggleSidebarFromMenu() {
  app.toggleSidebar();
  closeTitlebarMenu();
}

async function toggleMaximise() {
  await Window.ToggleMaximise();
  maximised.value = await Window.IsMaximised();
}

function minimiseWin() {
  void Window.Minimise();
}

function quitApp() {
  void Application.Quit();
}

const titlebarTitle = computed(() => {
  if (app.settingsOpen) return "设置";
  const tab = app.activeTab;
  if (!tab) return "全部主机";
  if (tab.kind === "group") return app.groupNameOf(tab.id);
  return app.hostSessions[tab.id]?.title || tab.title || tab.id;
});

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

/** 设置 / 侧栏 / 添加主机 / 搜索 / 刷新 / 退出（tooltip 按平台写 ⌘ 或 Ctrl） */
function onGlobalKeydown(e: KeyboardEvent) {
  if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey) return;
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
    e.preventDefault();
    addHostOpen.value = true;
    return;
  }
  if (e.code === "KeyF") {
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
    quitApp();
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
    ElMessage.success("已添加（公钥已推送）");
    addHostOpen.value = false;
    form.name = "";
    form.hostName = "";
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
});

onBeforeUnmount(() => {
  window.removeEventListener("keydown", onGlobalKeydown, true);
  window.removeEventListener("keydown", onSettingsEsc);
  eventOffs.forEach((off) => off());
  eventOffs.length = 0;
});
</script>

<style scoped>
.titlebar-left,
.titlebar-right {
  display: flex;
  align-items: center;
  box-sizing: border-box;
  height: 100%;
  min-height: 0;
}
.titlebar-left {
  padding-left: 8px;
  padding-right: 8px;
}
.is-mac .titlebar-left {
  /* 给系统红绿灯留位；与红绿灯共用通栏垂直中线 */
  padding-left: 78px;
  min-width: 78px;
}
/* 全屏时红绿灯进系统悬停条，不必再留 78px，否则收缩按钮会偏右 */
.is-mac.is-fullscreen .titlebar-left {
  padding-left: 12px;
  min-width: 0;
}
.titlebar-right {
  min-width: 0;
  padding: 0 8px 0 20px;
  gap: 8px;
}
.is-mac .titlebar-right {
  padding-right: 20px;
}
.sidebar-collapsed .titlebar-right {
  padding-left: 8px;
}
.titlebar-tools {
  display: flex;
  align-items: center;
  gap: 4px;
  height: 32px;
  flex-shrink: 0;
}
.titlebar-btn {
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
.titlebar-btn :deep(span) {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  line-height: 1;
}
.titlebar-btn :deep(.el-icon) {
  font-size: 18px;
  width: 18px;
  height: 18px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.titlebar-btn :deep(.el-icon svg) {
  width: 18px;
  height: 18px;
}
/* M3 紧凑标题栏：title-small（14/20，字重 500） */
.titlebar-title {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  font: var(--m3-title-small);
  font-weight: 500;
  color: var(--m3-on-surface);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  line-height: 20px;
  height: 32px;
  user-select: none;
}
.win-controls {
  display: flex;
  align-items: stretch;
  height: 40px;
  margin-right: -8px;
}
.win-btn {
  width: 46px;
  height: 40px;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--m3-on-surface-variant);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}
.win-btn svg {
  width: 12px;
  height: 12px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.25;
  stroke-linecap: round;
}
.win-btn:hover {
  background: color-mix(in srgb, var(--m3-on-surface) 8%, transparent);
  color: var(--m3-on-surface);
}
.win-btn-close:hover {
  background: var(--m3-error);
  color: var(--m3-on-error);
}
</style>

<style lang="scss">
.titlebar-ctx-backdrop {
  position: fixed;
  inset: 0;
  z-index: 4000;
}
.titlebar-ctx-menu {
  position: fixed;
  z-index: 4001;
  min-width: 168px;
  padding: 8px;
  border-radius: var(--m3-shape-s);
  border: 1px solid var(--m3-outline-variant);
  background: var(--m3-surface-container-lowest);
  box-shadow: var(--m3-elevation-3);
}
.titlebar-ctx-menu .ctx-item {
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
.titlebar-ctx-menu .ctx-item:hover {
  background: color-mix(in srgb, var(--m3-primary) 8%, transparent);
}
.titlebar-ctx-menu .ctx-kbd {
  font: var(--m3-body-small);
  color: var(--m3-on-surface-variant);
}
</style>
