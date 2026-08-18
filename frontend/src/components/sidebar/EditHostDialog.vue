<template>
  <!-- 编辑主机：改 IP/用户，须密码验连后保存 -->
  <el-dialog
    v-model="open"
    title="编辑主机"
    width="440px"
    append-to-body
    destroy-on-close
    :close-on-click-modal="!saving"
    @closed="resetForm"
  >
    <p class="edit-host-hint">
      保存前会用密码测试 SSH 连通性，通过后更新
      <code>~/.ssh/config</code> 并推送本机公钥。别名请用「重命名」。
    </p>
    <el-form label-width="80px" @submit.prevent="onSave">
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
          placeholder="用于测试连接，不落盘"
          :disabled="saving"
          @keyup.enter="onSave"
        />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button :disabled="saving" @click="open = false">
        取消
      </el-button>
      <el-button type="primary" :loading="saving" @click="onSave">
        {{ saving ? "验证并保存…" : "测试并保存" }}
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
/**
 * 编辑主机弹窗：密码仅用于验连（不落盘），验证通过后回写 ~/.ssh/config。
 * 父组件通过 openFor(hostName) 打开。
 */
import { reactive, ref } from "vue";
import { ElMessage } from "element-plus";
import { useAppStore } from "@/stores/app";
import { formatErr } from "@/utils/format";

const app = useAppStore();

const open = ref(false);
const saving = ref(false);
const form = reactive({
  name: "",
  hostName: "",
  user: "root",
  password: "",
});

function resetForm() {
  form.name = "";
  form.hostName = "";
  form.user = "root";
  form.password = "";
  saving.value = false;
}

function openFor(hostName: string) {
  const h = app.hosts.find((x) => x.name === hostName);
  form.name = hostName;
  form.hostName = h?.hostName || "";
  form.user = h?.user || "root";
  form.password = "";
  open.value = true;
}

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
    });
    ElMessage.success("已验证并保存");
    open.value = false;
  } catch (e) {
    ElMessage.error(formatErr(e));
  } finally {
    saving.value = false;
  }
}

defineExpose({ openFor });
</script>

<style scoped lang="scss">
.edit-host-hint {
  margin: 0 0 12px;
  font-size: 12px;
  line-height: 1.5;
  color: var(--el-text-color-secondary);
}
.edit-host-hint code {
  padding: 0 4px;
  border-radius: 3px;
  background: var(--el-fill-color);
  font-size: 11px;
}
</style>
