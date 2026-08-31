<template>
  <div class="tab-root" v-loading="loading && !list.length">
    <EnlargableCard title="定时任务">
      <div class="view-toolbar cron-toolbar">
        <span class="panel-section-title">定时任务</span>
        <div class="view-toolbar__tools">
          <el-button :loading="loading" @click="refresh">刷新</el-button>
        </div>
      </div>

      <el-alert v-if="error && !list.length" type="error" :title="error" show-icon />

      <div class="table-wrap">
        <el-table
          :data="rows"
          height="100%"
          size="default"
          stripe
          class="cron-table data-table-unified copyable-table"
          empty-text="未发现定时任务"
        >
          <el-table-column label="来源" width="110">
            <template #default="{ row }">
              <el-tag size="small" type="primary" effect="light">{{ sourceLabel(row.source) }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="user" label="用户" width="100">
            <template #default="{ row }">{{ row.user || "—" }}</template>
          </el-table-column>
          <el-table-column prop="schedule" label="调度" width="160">
            <template #default="{ row }">
              <span class="mono copy-text">{{ row.schedule }}</span>
            </template>
          </el-table-column>
          <el-table-column prop="cmd" label="命令" min-width="280">
            <template #default="{ row }">
              <div class="cmd-cell">
                <span class="mono copy-text cmd-text" :title="row.cmd">{{ row.cmd }}</span>
                <el-button
                  link
                  type="primary"
                  class="copy-btn"
                  @click="copyCronLine(row)"
                >
                  复制
                </el-button>
              </div>
            </template>
          </el-table-column>
        </el-table>
      </div>
    </EnlargableCard>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { ElMessage } from "element-plus";
import { api } from "@/api";
import { usePolling } from "@/composables/usePolling";
import { useAppStore } from "@/stores/app";
import EnlargableCard from "@/components/EnlargableCard.vue";
import { copyText } from "@/utils/clipboard";

interface Cron {
  user: string;
  line: string;
  source: string;
}

interface CronRow extends Cron {
  schedule: string;
  cmd: string;
}

const SOURCE_LABEL: Record<string, string> = {
  user: "用户",
  "etc-crontab": "系统主表",
  "etc-cron.d": "扩展",
};

const props = defineProps<{ host: string }>();
const app = useAppStore();
const { data, error, loading, refresh } = usePolling<Cron[]>(
  () => api.collectCrons(props.host) as Promise<Cron[]>,
  0,
  () => props.host,
  () => app.isHostSubActive(props.host, "cron")
);

const list = computed(() => data.value || []);
const rows = computed(() =>
  list.value.map((c) => {
    const fields = (c.line || "").split(/\s+/).filter(Boolean);
    const isSystem = c.source !== "user";
    const schedule = fields.slice(0, 5).join(" ");
    const cmd = isSystem ? fields.slice(6).join(" ") : fields.slice(5).join(" ");
    return { ...c, schedule, cmd };
  })
);

function sourceLabel(s: string) {
  return SOURCE_LABEL[s] || s || "—";
}

async function copyCronLine(row: CronRow) {
  const text = [row.schedule, row.cmd].filter(Boolean).join(" ");
  if (!text) return;
  try {
    await copyText(text);
    ElMessage.success("已复制到剪贴板");
  } catch {
    ElMessage.error("复制失败");
  }
}
</script>

<style scoped lang="scss">
.tab-root {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  gap: 8px;
}

:deep(.enl-body) {
  gap: 12px;
}

.cron-toolbar {
  margin: 0;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--m3-outline-variant);
}

.table-wrap {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.mono {
  font-family: var(--m3-font-mono);
  font-size: 12px;
}

.cmd-cell {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  min-width: 0;
}

.cmd-text {
  flex: 1;
  min-width: 0;
  white-space: pre-wrap;
  word-break: break-all;
  line-height: 1.5;
}

.copy-btn {
  flex-shrink: 0;
  padding: 0 4px;
  height: auto;
  font: var(--m3-label-medium);
}

/* Wails/WebKit：全局 user-select:none 时，必须打到 td/.cell 并带 -webkit 前缀 */
:deep(.copyable-table .el-table__body .el-table__cell),
:deep(.copyable-table .el-table__body .cell),
:deep(.copyable-table .copy-text) {
  user-select: text !important;
  -webkit-user-select: text !important;
  cursor: text;
}

:deep(.cron-table) {
  flex: 1;
}
</style>
