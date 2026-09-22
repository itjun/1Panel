<template>
  <section class="host-edit-panel" aria-label="编辑主机">
    <header class="host-edit-panel__head">
      <DistroLogo :os-release="osRelease" :size="28" />
      <div class="host-edit-panel__title">
        <strong>编辑主机</strong>
        <span>{{ host.name }}</span>
      </div>
      <button
        type="button"
        class="host-edit-panel__close"
        aria-label="关闭编辑"
        @click="emit('close')"
      >
        ×
      </button>
    </header>

    <p class="host-edit-panel__hint">
      保存前会用密码测试 SSH 连通性，通过后更新 Panel JSON、推送本机公钥，
      再生成 <code>~/.ssh/config</code>。
    </p>

    <el-form
      class="host-edit-panel__form"
      label-position="top"
      require-asterisk-position="right"
      @submit.prevent="onSave"
    >
      <el-form-item label="别名">
        <el-input :model-value="form.name" disabled />
      </el-form-item>
      <el-form-item label="地址" required>
        <el-input
          v-model="form.hostName"
          placeholder="IP 或域名"
          :disabled="saving"
        />
      </el-form-item>
      <el-form-item label="用户" required>
        <el-input
          v-model="form.user"
          placeholder="root"
          :disabled="saving"
        />
      </el-form-item>
      <el-form-item label="密码" required>
        <el-input
          v-model="form.password"
          type="password"
          show-password
          placeholder="用于测试连接，并保存在本机"
          :disabled="saving"
          @keyup.enter="onSave"
        />
      </el-form-item>
      <el-form-item label="备注">
        <el-input
          v-model="form.note"
          type="textarea"
          :rows="3"
          maxlength="200"
          show-word-limit
          placeholder="可选，仅保存在本机"
          :disabled="saving"
        />
      </el-form-item>
    </el-form>

    <div class="host-edit-panel__actions">
      <el-button :disabled="saving" @click="emit('close')">取消</el-button>
      <el-button type="primary" :loading="saving" @click="onSave">
        {{ saving ? "验证并保存…" : "测试并保存" }}
      </el-button>
    </div>
  </section>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from "vue";
import { ElMessage } from "element-plus";
import { api, type sshconfig } from "@/api";
import DistroLogo from "@/components/DistroLogo.vue";
import { useAppStore } from "@/stores/app";
import { formatErr } from "@/utils/format";

const props = defineProps<{
  host: sshconfig.HostConfig;
  osRelease: string;
}>();

const emit = defineEmits<{
  (e: "close"): void;
  (e: "saved"): void;
}>();

const app = useAppStore();
const saving = ref(false);
const form = reactive({
  name: props.host.name,
  hostName: props.host.hostName || "",
  user: props.host.user || "root",
  password: "",
  note: props.host.note || "",
});

onMounted(async () => {
  try {
    form.password = (await api.getHostPassword(props.host.name)) || "";
  } catch {
    // 预填失败不影响编辑；用户可手动输入
  }
});

async function onSave() {
  const name = form.name.trim();
  const hostName = form.hostName.trim();
  const user = form.user.trim();
  if (!name || !hostName || !user || !form.password) {
    ElMessage.warning("地址、用户、密码均不能为空");
    return;
  }
  saving.value = true;
  try {
    await app.updateHost({
      name,
      hostName,
      user,
      password: form.password,
      note: form.note.trim(),
    });
    ElMessage.success("已验证并保存");
    emit("saved");
  } catch (e) {
    ElMessage.error(formatErr(e));
  } finally {
    saving.value = false;
  }
}
</script>

<style scoped lang="scss">
.host-edit-panel {
  display: flex;
  flex-direction: column;
  min-height: 100%;
  box-sizing: border-box;
  color: var(--m3-on-surface);
}

.host-edit-panel__head {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}

.host-edit-panel__title {
  display: flex;
  flex: 1;
  min-width: 0;
  flex-direction: column;
  gap: 2px;

  strong {
    font: var(--m3-title-medium);
    font-weight: 650;
  }

  span {
    overflow: hidden;
    color: var(--m3-on-surface-variant);
    font: var(--m3-body-small);
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}

.host-edit-panel__close {
  appearance: none;
  flex: 0 0 auto;
  width: 32px;
  height: 32px;
  border: 0;
  border-radius: var(--m3-shape-s);
  background: transparent;
  color: var(--m3-on-surface-variant);
  font-size: 22px;
  line-height: 1;
  cursor: pointer;

  &:hover {
    background: color-mix(in srgb, var(--m3-on-surface) 7%, transparent);
    color: var(--m3-on-surface);
  }

  &:focus-visible {
    outline: var(--m3-focus-ring);
    outline-offset: 1px;
  }
}

.host-edit-panel__hint {
  margin: 18px 0 20px;
  color: var(--m3-on-surface-variant);
  font: var(--m3-body-small);
  line-height: 1.55;

  code {
    padding: 1px 5px;
    border-radius: var(--m3-shape-xs);
    background: var(--m3-surface-container);
    color: var(--m3-on-surface);
    font-family: var(--m3-font-mono);
    font-size: 11px;
  }
}

.host-edit-panel__form {
  :deep(.el-form-item) {
    margin-bottom: 16px;
  }

  :deep(.el-form-item__label) {
    margin-bottom: 6px;
    padding: 0;
    color: var(--m3-on-surface-variant);
    font: var(--m3-label-large);
    line-height: 20px;
  }
}

.host-edit-panel__actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: auto;
  padding-top: 20px;
}
</style>
