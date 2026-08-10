<template>
  <div class="login-page drag-region">
    <div class="login-card no-drag">
      <!-- 左侧装饰（对齐 1Panel 登录视觉） -->
      <div class="login-art">
        <div class="art-brand">
          <LogoFull class="art-logo" />
        </div>
        <div class="art-hero">
          <div class="hero-orb">
            <LogoIcon class="hero-icon" />
          </div>
        </div>
        <div class="art-grid" />
      </div>

      <!-- 右侧：系统认证入口 -->
      <div class="login-form-wrap">
        <div class="form-head">
          <h1>登录</h1>
          <span class="form-hint">使用 macOS 系统认证解锁</span>
        </div>

        <div class="user-card">
          <div class="user-avatar">
            <el-icon :size="28"><UserFilled /></el-icon>
          </div>
          <div class="user-meta">
            <div class="user-name">{{ displayName || "—" }}</div>
            <div class="user-id">{{ username || "读取用户中…" }}</div>
          </div>
        </div>

        <el-button
          type="primary"
          class="login-btn"
          :loading="loading"
          :icon="Lock"
          @click="onUnlock"
        >
          使用 Mac 密码 / Touch ID 解锁
        </el-button>

        <p v-if="error" class="err-msg">{{ error }}</p>

        <p class="tip">
          将调用 Apple
          <strong>LocalAuthentication</strong>
          弹出系统认证面板（设备密码或 Touch ID），密码由系统处理，不会进入本应用。
        </p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { Lock, UserFilled } from "@element-plus/icons-vue";
import { api } from "@/api";
import LogoFull from "@/components/LogoFull.vue";
import LogoIcon from "@/components/LogoIcon.vue";

const emit = defineEmits<{
  success: [username: string];
}>();

const loading = ref(false);
const error = ref("");
const username = ref("");
const fullName = ref("");

const displayName = computed(() => fullName.value || username.value);

onMounted(async () => {
  try {
    const u = await api.getCurrentMacUser();
    username.value = u.username || "";
    fullName.value = u.fullName || "";
  } catch {
    username.value = "";
  }
});

async function onUnlock() {
  error.value = "";
  loading.value = true;
  try {
    // 后端调用 macOS LocalAuthentication 系统面板
    const st = await api.authenticateWithSystem();
    emit("success", st.username);
  } catch (e) {
    error.value = String(e).replace(/^Error:\s*/, "");
  } finally {
    loading.value = false;
  }
}
</script>

<style scoped lang="scss">
.login-page {
  height: 100%;
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(160deg, #e8f0ff 0%, #f0f4ff 40%, #e6eeff 100%);
  padding: 24px;
  box-sizing: border-box;
}

.login-card {
  display: flex;
  width: min(920px, 100%);
  min-height: 480px;
  border-radius: 12px;
  overflow: hidden;
  background: #fff;
  box-shadow: 0 20px 60px rgba(0, 94, 235, 0.12),
    0 4px 16px rgba(15, 23, 42, 0.06);
}

.login-art {
  position: relative;
  flex: 1.05;
  min-width: 0;
  background: linear-gradient(145deg, #005eeb 0%, #3d8eff 55%, #7faef5 100%);
  overflow: hidden;
  display: none;
  @media (min-width: 720px) {
    display: flex;
    flex-direction: column;
    padding: 28px 24px;
  }
}

.art-brand {
  position: relative;
  z-index: 2;
  color: #fff;
  :deep(svg) {
    height: 30px;
    width: auto;
    color: #fff;
  }
}

.art-hero {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  z-index: 2;
}

.hero-orb {
  width: 160px;
  height: 160px;
  border-radius: 36px;
  background: rgba(255, 255, 255, 0.18);
  backdrop-filter: blur(8px);
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 16px 40px rgba(0, 40, 120, 0.25);
  transform: rotate(-8deg);
}

.hero-icon {
  width: 88px;
  height: 88px;
  color: #fff;
}

.art-grid {
  position: absolute;
  inset: 0;
  opacity: 0.25;
  background-image: linear-gradient(
      rgba(255, 255, 255, 0.2) 1px,
      transparent 1px
    ),
    linear-gradient(90deg, rgba(255, 255, 255, 0.2) 1px, transparent 1px);
  background-size: 28px 28px;
  mask-image: radial-gradient(circle at 40% 50%, #000 20%, transparent 75%);
}

.login-form-wrap {
  flex: 1;
  min-width: 280px;
  padding: 48px 40px;
  display: flex;
  flex-direction: column;
  justify-content: center;
}

.form-head {
  margin-bottom: 28px;
  h1 {
    margin: 0;
    font-size: 28px;
    font-weight: 700;
    color: #1f2329;
    letter-spacing: -0.02em;
  }
  .form-hint {
    display: block;
    margin-top: 8px;
    font-size: 13px;
    color: #646a73;
  }
}

.user-card {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 16px;
  margin-bottom: 24px;
  border-radius: 10px;
  background: #f5f8ff;
  border: 1px solid #e4e7ed;
}

.user-avatar {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  background: #e5eefd;
  color: #005eeb;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.user-name {
  font-size: 16px;
  font-weight: 600;
  color: #1f2329;
}

.user-id {
  margin-top: 2px;
  font-size: 13px;
  color: #646a73;
}

.login-btn {
  width: 100%;
  height: 48px;
  font-size: 15px;
  font-weight: 600;
  border-radius: 8px;
  background: #005eeb;
  border-color: #005eeb;
  &:hover {
    background: #196eed;
    border-color: #196eed;
  }
}

.err-msg {
  margin: 14px 0 0;
  color: #e2324f;
  font-size: 13px;
}

.tip {
  margin: 22px 0 0;
  font-size: 12px;
  color: #909399;
  line-height: 1.65;
  strong {
    color: #646a73;
    font-weight: 600;
  }
}
</style>
