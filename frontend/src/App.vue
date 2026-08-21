<template>
  <div class="app-shell">
    <!-- 两列：竖线贯穿通栏。左列红绿灯+开关/搜索+侧栏，右列标题+主区 -->
    <div class="app-chrome" :class="{ 'sidebar-collapsed': !app.sidebarOpen }">
      <div class="titlebar-left drag-region" @dblclick="toggleMaximise">
        <div class="titlebar-tools no-drag">
          <el-button
            text
            class="titlebar-btn"
            :title="app.sidebarOpen ? '收起侧栏 (⌘B)' : '展开侧栏 (⌘B)'"
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
          <el-button
            text
            class="titlebar-btn"
            :class="{ 'is-active': app.sidebarSearchOpen }"
            title="搜索主机"
            @click="app.toggleSidebarSearch()"
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
                <circle cx="11" cy="11" r="8" />
                <path d="m21 21-4.35-4.35" />
              </svg>
            </el-icon>
          </el-button>
        </div>
      </div>
      <div class="titlebar-right drag-region" @dblclick="toggleMaximise">
        <span class="titlebar-title no-drag">{{ titlebarTitle }}</span>
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
      width="440px"
      append-to-body
      destroy-on-close
      :close-on-click-modal="!saving"
    >
      <p class="add-host-hint">
        验证连通后会推送本机公钥并写入
        <code>~/.ssh/config</code>，密码仅本次使用、不落盘。
      </p>
      <el-form label-width="80px" @submit.prevent="onAddHost">
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
      </el-form>
      <template #footer>
        <el-button :disabled="saving" @click="addHostOpen = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="onAddHost">
          {{ saving ? "连接中..." : "保存" }}
        </el-button>
      </template>
    </el-dialog>

    <SettingsDialog v-model="settingsOpen" />
    <AgentInstallDialog />
    <BackupImportDialog ref="backupImportRef" />
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from "vue";
import { ElMessage } from "element-plus";
import { api } from "@/api";
import { Dialogs, Events, Window } from "@wailsio/runtime";
import { useAppStore } from "@/stores/app";
import { useSettingsStore } from "@/stores/settings";
import { formatErr } from "@/utils/format";
import SidebarHost from "@/layout/SidebarHost.vue";
import MainArea from "@/layout/MainArea.vue";
import SettingsDialog from "@/components/SettingsDialog.vue";
import AgentInstallDialog from "@/components/AgentInstallDialog.vue";
import BackupImportDialog from "@/components/BackupImportDialog.vue";

const app = useAppStore();
// 确保设置 store 初始化并应用主题/字体
useSettingsStore();
const addHostOpen = ref(false);
const settingsOpen = ref(false);
const backupImportRef = ref<InstanceType<typeof BackupImportDialog>>();
const saving = ref(false);
const form = reactive({
  name: "",
  hostName: "",
  user: "root",
  password: "",
});

function openSettings() {
  settingsOpen.value = true;
}

function toggleMaximise() {
  Window.ToggleMaximise();
}

const titlebarTitle = computed(() => {
  const tab = app.activeTab;
  if (!tab) return "全部主机";
  if (tab.kind === "group") return app.groupNameOf(tab.id);
  return app.hostSessions[tab.id]?.title || tab.title || tab.id;
});

/** ⌘, 打开设置；⌘B 切换侧栏 */
function onGlobalKeydown(e: KeyboardEvent) {
  if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey) return;
  const isComma = e.key === "," || e.code === "Comma" || e.key === "，";
  if (isComma) {
    e.preventDefault();
    openSettings();
    return;
  }
  if (e.code === "KeyB") {
    e.preventDefault();
    app.toggleSidebar();
  }
}

async function onRefreshAllIcons() {
  try {
    const r = await app.refreshAllHostIcons();
    if (r.failed.length > 0) {
      ElMessage.warning(`已更新 ${r.ok} 台，失败 ${r.failed.length} 台`);
    } else {
      ElMessage.success(`已检查并更新 ${r.ok} 台主机图标`);
    }
  } catch (e) {
    ElMessage.error(`检查图标失败: ${formatErr(e)}`);
  }
}

/** 系统菜单「导出主机配置…」：选父目录 → 导出到其中的日期文件夹（同日覆盖） */
async function onExportBackup() {
  const dir = await Dialogs.OpenFile({
    Title: "选择备份位置",
    CanChooseDirectories: true,
    CanChooseFiles: false,
    CanCreateDirectories: true,
  });
  if (!dir) return;
  try {
    const msg = await api.exportBackup(dir);
    ElMessage.success(msg);
  } catch (e) {
    ElMessage.error(formatErr(e));
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
    });
    ElMessage.success("已添加（公钥已推送）");
    addHostOpen.value = false;
    form.name = "";
    form.hostName = "";
    form.password = "";
    await app.refresh();
  } catch (e) {
    ElMessage.error(formatErr(e));
  } finally {
    saving.value = false;
  }
}

/** v3 事件订阅：Events.On 返回退订函数，逐个保存后统一释放 */
const eventOffs: (() => void)[] = [];

onMounted(async () => {
  window.addEventListener("keydown", onGlobalKeydown, true);
  // macOS 应用菜单「设置…」点击事件 → 打开设置弹窗
  eventOffs.push(Events.On("open-settings", () => openSettings()));
  // 系统菜单「主机」子菜单：添加主机 / 新建分组 / 导出 / 导入主机配置
  eventOffs.push(Events.On("open-add-host", () => (addHostOpen.value = true)));
  eventOffs.push(Events.On("open-create-group", () => (app.pendingCreateGroup = true)));
  eventOffs.push(Events.On("open-export", () => void onExportBackup()));
  eventOffs.push(Events.On("open-import", () => backupImportRef.value?.openFor()));
  // 系统菜单「1Pannel」子菜单：刷新 / 检查并更新全部图标（原侧栏齿轮菜单）
  eventOffs.push(Events.On("app-refresh", () => void app.refresh()));
  eventOffs.push(Events.On("app-refresh-icons", () => void onRefreshAllIcons()));
  eventOffs.push(
    Events.On("host-icon-updated", (ev: { data?: { host?: string; osRelease?: string } }) => {
      const it = ev?.data;
      if (it?.host && it?.osRelease) {
        app.rememberOsRelease(it.host, it.osRelease);
      }
    })
  );
  await app.refresh();
});

onBeforeUnmount(() => {
  window.removeEventListener("keydown", onGlobalKeydown, true);
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
}
.titlebar-left {
  padding-left: 78px;
  padding-right: 8px;
}
.titlebar-right {
  min-width: 0;
  padding: 0 20px;
}
.sidebar-collapsed .titlebar-right {
  padding-left: 8px;
}
.titlebar-tools {
  display: flex;
  align-items: center;
  gap: 4px;
  height: 24px;
}
.titlebar-btn {
  width: 24px;
  height: 24px;
  min-height: 24px;
  padding: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--el-text-color-regular);
  --el-button-hover-text-color: var(--el-text-color-primary);
  --el-button-hover-bg-color: color-mix(
    in srgb,
    var(--el-color-primary) 10%,
    transparent
  );
}
.titlebar-btn :deep(.el-icon) {
  font-size: 18px;
}
.titlebar-btn.is-active {
  color: var(--el-color-primary);
}
.titlebar-title {
  flex: 1;
  min-width: 0;
  font-size: 14px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  line-height: 28px;
}
.add-host-hint {
  margin: 0 0 12px;
  font-size: 12px;
  line-height: 1.5;
  color: var(--el-text-color-secondary);
}
.add-host-hint code {
  padding: 0 4px;
  border-radius: 3px;
  background: var(--el-fill-color);
  font-size: 11px;
}
</style>
