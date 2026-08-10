<template>
  <!-- 未解锁：本机密码登录页 -->
  <LoginView v-if="!unlocked" @success="onLoginSuccess" />

  <div v-else class="app-shell">
    <header class="top-bar drag-region">
      <div class="left no-drag">
        <el-button
          text
          :icon="sidebarOpen ? Fold : Expand"
          @click="sidebarOpen = !sidebarOpen"
        />
        <LogoFull style="height: 22px; width: auto" />
      </div>
      <div class="right no-drag">
        <el-button text :icon="Brush" @click="settings.cycleTheme()">
          主题
        </el-button>
        <el-button
          text
          :icon="Refresh"
          :loading="app.loading"
          @click="app.refresh()"
        >
          刷新
        </el-button>
        <el-button type="primary" :icon="Plus" @click="addHostOpen = true">
          添加主机
        </el-button>
        <el-button text :icon="Lock" @click="onLogout">锁定</el-button>
      </div>
    </header>

    <div class="app-body">
      <SidebarHost v-show="sidebarOpen" />
      <MainArea />
    </div>

    <el-dialog
      v-model="addHostOpen"
      title="添加主机"
      width="440px"
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
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from "vue";
import {
  Brush,
  Expand,
  Fold,
  Lock,
  Plus,
  Refresh,
} from "@element-plus/icons-vue";
import { ElMessage } from "element-plus";
import { api } from "@/api";
import { useAppStore } from "@/stores/app";
import { useSettingsStore } from "@/stores/settings";
import SidebarHost from "@/layout/SidebarHost.vue";
import MainArea from "@/layout/MainArea.vue";
import LogoFull from "@/components/LogoFull.vue";
import LoginView from "@/views/LoginView.vue";

const app = useAppStore();
const settings = useSettingsStore();
const unlocked = ref(false);
const authChecking = ref(true);
const sidebarOpen = ref(true);
const addHostOpen = ref(false);
const saving = ref(false);
const form = reactive({
  name: "",
  hostName: "",
  user: "root",
  password: "",
});

function formatErr(e: unknown): string {
  if (e == null) return "未知错误";
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message || String(e);
  // Wails 部分环境 reject 的是带 message 的普通对象
  const any = e as { message?: string };
  if (any.message) return any.message;
  return String(e);
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

async function onLoginSuccess(_username: string) {
  unlocked.value = true;
  await app.refresh();
}

async function onLogout() {
  try {
    await api.logoutMacUser();
  } catch {
    /* ignore */
  }
  unlocked.value = false;
}

onMounted(async () => {
  try {
    const st = await api.authStatus();
    unlocked.value = !!st.authenticated;
    if (unlocked.value) {
      await app.refresh();
    }
  } catch {
    // 浏览器预览无 Wails 绑定时保持登录页
    unlocked.value = false;
  } finally {
    authChecking.value = false;
  }
});
</script>

<style scoped>
.left {
  display: flex;
  align-items: center;
  gap: 8px;
}
.right {
  display: flex;
  align-items: center;
  gap: 4px;
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
