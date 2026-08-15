<template>
  <div class="app-shell" :class="{ 'sidebar-collapsed': !app.sidebarOpen }">
    <SidebarHost
      v-show="app.sidebarOpen"
      @collapse="app.setSidebarOpen(false)"
      @add-host="addHostOpen = true"
    />

    <div class="main-column">
      <MainArea />
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
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, reactive, ref } from "vue";
import { ElMessage } from "element-plus";
import { api } from "@/api";
import { EventsOff, EventsOn } from "@wailsjs/runtime/runtime";
import { useAppStore } from "@/stores/app";
import { useSettingsStore } from "@/stores/settings";
import SidebarHost from "@/layout/SidebarHost.vue";
import MainArea from "@/layout/MainArea.vue";
import SettingsDialog from "@/components/SettingsDialog.vue";

const app = useAppStore();
// 确保设置 store 初始化并应用主题/字体
useSettingsStore();
const addHostOpen = ref(false);
const settingsOpen = ref(false);
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

/** macOS 传统：⌘, 打开设置 */
function onGlobalKeydown(e: KeyboardEvent) {
  // Meta=, 或 Meta+,（不同键盘布局）
  const isComma =
    e.key === "," || e.code === "Comma" || e.key === "，";
  if ((e.metaKey || e.ctrlKey) && isComma && !e.shiftKey && !e.altKey) {
    // 输入框内也允许（系统偏好设置行为）
    e.preventDefault();
    openSettings();
  }
}

function formatErr(e: unknown): string {
  if (e == null) return "未知错误";
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message || String(e);
  // Wails 部分环境 reject 的是带 message 的普通对象
  const any = e as { message?: string };
  if (any.message) return any.message;
  return String(e);
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

onMounted(async () => {
  window.addEventListener("keydown", onGlobalKeydown, true);
  // macOS 应用菜单「设置…」点击事件 → 打开设置弹窗
  EventsOn("open-settings", () => openSettings());
  // 系统菜单「主机」子菜单：添加主机 / 新建分组
  EventsOn("open-add-host", () => (addHostOpen.value = true));
  EventsOn("open-create-group", () => (app.pendingCreateGroup = true));
  // 系统菜单「1Pannel」子菜单：刷新 / 检查并更新全部图标（原侧栏齿轮菜单）
  EventsOn("app-refresh", () => void app.refresh());
  EventsOn("app-refresh-icons", () => void onRefreshAllIcons());
  EventsOn("host-icon-updated", (it: { host?: string; osRelease?: string }) => {
    if (it?.host && it?.osRelease) {
      app.rememberOsRelease(it.host, it.osRelease);
    }
  });
  await app.refresh();
});

onBeforeUnmount(() => {
  window.removeEventListener("keydown", onGlobalKeydown, true);
  EventsOff("open-settings");
  EventsOff("open-add-host");
  EventsOff("open-create-group");
  EventsOff("app-refresh");
  EventsOff("app-refresh-icons");
  EventsOff("host-icon-updated");
});
</script>

<style scoped>
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
