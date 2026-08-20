<template>
  <!-- 导入主机配置：选备份文件 → 预览 + 冲突策略 → 导入结果 -->
  <el-dialog
    v-model="open"
    title="导入主机配置"
    width="480px"
    append-to-body
    destroy-on-close
    :close-on-click-modal="!importing"
    :show-close="!importing"
  >
    <!-- 预览阶段 -->
    <template v-if="preview">
      <el-descriptions :column="1" border size="small" class="backup-desc">
        <el-descriptions-item label="备份时间">
          {{ formatTime(preview.exportedAt) }}
        </el-descriptions-item>
        <el-descriptions-item label="主机">
          {{ hostCount }} 台
        </el-descriptions-item>
        <el-descriptions-item label="分组">
          {{ groupCount }} 个
        </el-descriptions-item>
        <el-descriptions-item label="与当前重名">
          {{ conflictCount }} 台
        </el-descriptions-item>
      </el-descriptions>

      <div class="strategy">
        <p class="strategy-title">重名主机处理方式</p>
        <el-radio-group v-model="overwrite" :disabled="importing">
          <el-radio :value="false">跳过（保留本地配置）</el-radio>
          <el-radio :value="true">覆盖（以备份为准）</el-radio>
        </el-radio-group>
      </div>

      <p class="hint">
        备份不含 SSH 私钥：换机恢复需另行保管
        <code>~/.ssh/id_ed25519</code>，否则恢复后无法连接主机。
      </p>
    </template>

    <!-- 结果阶段 -->
    <template v-else-if="result">
      <el-descriptions :column="1" border size="small" class="backup-desc">
        <el-descriptions-item label="新增主机">
          {{ result.added?.length ?? 0 }} 台
        </el-descriptions-item>
        <el-descriptions-item label="覆盖主机">
          {{ result.overwritten?.length ?? 0 }} 台
        </el-descriptions-item>
        <el-descriptions-item label="跳过主机">
          {{ result.skipped?.length ?? 0 }} 台
        </el-descriptions-item>
        <el-descriptions-item label="分组 / 图标">
          {{ result.groups }} 个 / {{ result.icons }} 条
        </el-descriptions-item>
      </el-descriptions>
      <p v-if="nameDetail" class="hint name-detail" :title="nameDetail">
        {{ nameDetail }}
      </p>
    </template>

    <!-- 选文件 / 读取中 -->
    <div v-else class="hint">{{ loadingText }}</div>

    <template #footer>
      <template v-if="result">
        <el-button type="primary" @click="open = false">完成</el-button>
      </template>
      <template v-else>
        <el-button :disabled="importing" @click="open = false">取消</el-button>
        <el-button
          type="primary"
          :loading="importing"
          :disabled="!preview"
          @click="onImport"
        >
          {{ importing ? "导入中…" : "开始导入" }}
        </el-button>
      </template>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
/**
 * 导入主机配置弹窗：系统菜单「导入主机配置…」触发。
 * 打开后先弹原生文件对话框选备份文件（取消则关闭），读取预览后选择重名策略再导入。
 */
import { computed, ref } from "vue";
import { ElMessage } from "element-plus";
import { Dialogs } from "@wailsio/runtime";
import { api } from "@/api";
import { useAppStore } from "@/stores/app";
import { formatErr } from "@/utils/format";
import type { main } from "@/api";

const app = useAppStore();

const open = ref(false);
const importing = ref(false);
const backupPath = ref("");
const preview = ref<main.BackupData | null>(null);
const result = ref<main.ImportResult | null>(null);
const overwrite = ref(false);
const loadingText = ref("");
// 全量本地主机名（含 Git 条目），与后端 ImportBackup 的判重口径一致
const allLocalNames = ref<Set<string>>(new Set());

const hostCount = computed(() => preview.value?.hosts?.length ?? 0);
const groupCount = computed(() => preview.value?.groups?.length ?? 0);
const conflictCount = computed(() => {
  return (preview.value?.hosts ?? []).filter((h) =>
    allLocalNames.value.has(h.name)
  ).length;
});

const nameDetail = computed(() => {
  const r = result.value;
  if (!r) return "";
  const parts: string[] = [];
  if (r.added?.length) parts.push(`新增: ${r.added.join("、")}`);
  if (r.overwritten?.length) parts.push(`覆盖: ${r.overwritten.join("、")}`);
  if (r.skipped?.length) parts.push(`跳过: ${r.skipped.join("、")}`);
  return parts.join("　");
});

function formatTime(unix: number): string {
  const d = new Date(unix * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

async function openFor() {
  open.value = true;
  preview.value = null;
  result.value = null;
  overwrite.value = false;
  importing.value = false;
  loadingText.value = "请在弹出的文件对话框中选择备份文件…";

  const path = await Dialogs.OpenFile({
    Title: "选择备份文件",
    Filters: [{ DisplayName: "JSON 备份", Pattern: "*.json" }],
  });
  if (!path) {
    // 用户取消选文件，直接关闭弹窗
    open.value = false;
    return;
  }
  backupPath.value = path;
  loadingText.value = "正在读取备份文件…";
  try {
    const [data, allHosts] = await Promise.all([
      api.readBackup(path),
      api.listHostsAll(),
    ]);
    preview.value = data;
    allLocalNames.value = new Set(allHosts.map((h) => h.name));
  } catch (e) {
    ElMessage.error(formatErr(e));
    open.value = false;
  }
}

async function onImport() {
  importing.value = true;
  try {
    result.value = await api.importBackup(backupPath.value, overwrite.value);
    await app.refresh();
  } catch (e) {
    ElMessage.error(formatErr(e));
    // 后端逐台写入、无回滚：失败时磁盘可能已被部分修改，
    // 刷新并关闭弹窗，避免界面与实际配置脱节
    await app.refresh();
    open.value = false;
  } finally {
    importing.value = false;
  }
}

defineExpose({ openFor });
</script>

<style scoped lang="scss">
.backup-desc {
  margin-bottom: 12px;
}

.strategy {
  margin-bottom: 12px;
}

.strategy-title {
  margin: 0 0 8px;
  font-size: 12px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.hint {
  margin: 0;
  font-size: 12px;
  line-height: 1.5;
  color: var(--el-text-color-secondary);
}
.hint code {
  padding: 0 4px;
  border-radius: 3px;
  background: var(--el-fill-color);
  font-size: 11px;
}

.name-detail {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
