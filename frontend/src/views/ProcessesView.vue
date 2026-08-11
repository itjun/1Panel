<template>
  <div class="tab-root" v-loading="loading && !rows.length">
    <div class="toolbar">
      <el-radio-group v-model="view" size="small">
        <el-radio-button value="all">全部进程</el-radio-button>
        <el-radio-button value="java">Java 进程</el-radio-button>
      </el-radio-group>
      <el-input
        v-model="filter"
        size="small"
        clearable
        class="filter"
        placeholder="按命令/用户/PID 过滤..."
      />
      <el-button size="small" @click="refresh">刷新</el-button>
      <span class="count">{{ filtered.length }} 条</span>
    </div>
    <el-alert v-if="error && !rows.length" type="error" :title="error" show-icon />
    <el-table :data="filtered" height="100%" size="small" stripe>
      <el-table-column prop="pid" label="PID" width="80" />
      <el-table-column prop="user" label="用户" width="90" />
      <el-table-column label="CPU%" width="80" sortable :sort-method="sortCpu">
        <template #default="{ row }">
          <span :class="cpuClass(row.cpu)">{{ Number(row.cpu || 0).toFixed(1) }}</span>
        </template>
      </el-table-column>
      <el-table-column label="MEM%" width="80">
        <template #default="{ row }">
          <span :class="row.mem > 50 ? 'warn' : ''">{{
            Number(row.mem || 0).toFixed(1)
          }}</span>
        </template>
      </el-table-column>
      <el-table-column label="RSS" width="90">
        <template #default="{ row }">{{ formatBytes(row.rss || 0) }}</template>
      </el-table-column>
      <el-table-column label="运行时长" width="90">
        <template #default="{ row }">{{ formatDuration(row.elapsed || 0) }}</template>
      </el-table-column>
      <el-table-column
        prop="cmd"
        label="启动命令"
        min-width="280"
        show-overflow-tooltip
      />
      <el-table-column label="操作" width="72" align="right" fixed="right">
        <template #default="{ row }">
          <el-dropdown trigger="click">
            <el-button size="small" text>⋯</el-button>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item @click="copyCmd(row.cmd)">
                  复制启动命令
                </el-dropdown-item>
                <el-dropdown-item divided @click="kill(row, false)">
                  结束进程 (TERM)
                </el-dropdown-item>
                <el-dropdown-item @click="kill(row, true)">
                  强制结束 (KILL)
                </el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </template>
      </el-table-column>
    </el-table>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { api } from "@/api";
import { usePolling } from "@/composables/usePolling";
import { copyText } from "@/utils/clipboard";
import { formatBytes, formatDuration } from "@/utils/format";

interface ProcInfo {
  pid: number;
  user: string;
  cpu: number;
  mem: number;
  rss: number;
  elapsed: number;
  cmd: string;
}

const props = defineProps<{ host: string }>();
const view = ref<"all" | "java">("all");
const filter = ref("");

const { data, error, loading, refresh } = usePolling<ProcInfo[]>(
  () =>
    view.value === "all"
      ? (api.collectProcesses(props.host, 100) as Promise<ProcInfo[]>)
      : (api.collectJava(props.host) as Promise<ProcInfo[]>),
  5000,
  () => [props.host, view.value]
);

const rows = computed(() => data.value || []);
const filtered = computed(() => {
  const q = filter.value.trim().toLowerCase();
  if (!q) return rows.value;
  return rows.value.filter(
    (p) =>
      (p.cmd || "").toLowerCase().includes(q) ||
      (p.user || "").toLowerCase().includes(q) ||
      String(p.pid).includes(q)
  );
});

function cpuClass(cpu: number) {
  if (cpu > 80) return "danger";
  if (cpu > 30) return "warn";
  return "";
}
function sortCpu(a: ProcInfo, b: ProcInfo) {
  return (a.cpu || 0) - (b.cpu || 0);
}
async function copyCmd(cmd: string) {
  const text = (cmd || "").trim();
  if (!text) {
    ElMessage.warning("启动命令为空");
    return;
  }
  try {
    await copyText(text);
    ElMessage.success("启动命令已复制到剪贴板");
  } catch (e) {
    ElMessage.error(`复制失败: ${e}`);
  }
}
async function kill(row: ProcInfo, force: boolean) {
  try {
    await ElMessageBox.confirm(
      `${force ? "强制结束" : "结束"}进程 ${row.pid}?\n${(row.cmd || "").slice(0, 80)}`,
      "确认",
      { type: "warning" }
    );
  } catch {
    return;
  }
  try {
    await api.killProcess(props.host, row.pid, force);
    ElMessage.success("已发送信号");
    await refresh();
  } catch (e) {
    ElMessage.error(`结束失败: ${e}`);
  }
}
</script>

<style scoped>
.tab-root {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  gap: 8px;
}
.toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}
.filter {
  width: 240px;
}
.count {
  margin-left: auto;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.warn {
  color: var(--el-color-warning);
  font-weight: 600;
}
.danger {
  color: var(--el-color-danger);
  font-weight: 600;
}
:deep(.el-table) {
  flex: 1;
}
</style>
