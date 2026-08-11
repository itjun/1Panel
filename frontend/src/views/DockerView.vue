<template>
  <div class="tab-root" v-loading="loading && !data">
    <el-alert v-if="error && !data" type="error" :title="error" show-icon />
    <template v-else-if="data && !data.available">
      <el-empty description="目标机未安装 Docker，或当前用户没有 docker 权限" />
    </template>
    <template v-else-if="data">
      <div class="toolbar">
        <span class="muted">共 {{ (data.containers || []).length }} 个容器</span>
        <el-button size="small" @click="refresh">刷新</el-button>
      </div>
      <div class="grid">
        <el-card
          v-for="c in data.containers || []"
          :key="c.id"
          shadow="never"
          class="card"
        >
          <div class="head">
            <span class="dot" :class="{ on: c.state === 'running' }" />
            <span class="name" :title="c.name">{{ c.name }}</span>
            <el-tag size="small" :type="stateType(c.state)">{{ c.state }}</el-tag>
            <el-dropdown trigger="click">
              <el-button size="small" text :loading="busy === c.name">⋯</el-button>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item
                    :disabled="c.state === 'running'"
                    @click="act(c.name, 'start')"
                  >
                    启动
                  </el-dropdown-item>
                  <el-dropdown-item
                    :disabled="c.state !== 'running'"
                    @click="act(c.name, 'stop')"
                  >
                    停止
                  </el-dropdown-item>
                  <el-dropdown-item @click="act(c.name, 'restart')">重启</el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
          </div>
          <div class="image muted">{{ c.image }}</div>
          <div class="row">
            <span class="muted">CPU</span>
            <span class="mono">{{ (statOf(c.name)?.cpuPercent || 0).toFixed(2) }}%</span>
          </div>
          <div class="row">
            <span class="muted">内存</span>
            <span class="mono">
              {{ formatBytes(statOf(c.name)?.memUsage || 0) }} /
              {{ formatBytes(statOf(c.name)?.memLimit || 0) }}
            </span>
          </div>
          <el-progress
            :percentage="Math.min(100, Number(statOf(c.name)?.memPercent || 0))"
            :stroke-width="6"
            :show-text="false"
          />
          <div class="status muted" :title="c.status">{{ c.status }}</div>
        </el-card>
        <el-empty
          v-if="!(data.containers || []).length"
          class="full"
          description="没有容器"
        />
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { ElMessage } from "element-plus";
import { api } from "@/api";
import { usePolling } from "@/composables/usePolling";
import { formatBytes } from "@/utils/format";

interface ContainerStat {
  name: string;
  cpuPercent: number;
  memUsage: number;
  memLimit: number;
  memPercent: number;
}
interface Container {
  id: string;
  name: string;
  image: string;
  status: string;
  state: string;
}
interface DockerInfo {
  available: boolean;
  containers: Container[];
  stats: ContainerStat[];
}

const props = defineProps<{ host: string }>();
const busy = ref<string | null>(null);

const { data, error, loading, refresh } = usePolling<DockerInfo>(
  () => api.collectDocker(props.host) as Promise<DockerInfo>,
  5000,
  () => props.host
);

const statMap = computed(() => {
  const m = new Map<string, ContainerStat>();
  for (const s of data.value?.stats || []) m.set(s.name, s);
  return m;
});
function statOf(name: string) {
  return statMap.value.get(name);
}
function stateType(state: string) {
  if (state === "running") return "success";
  if (state === "paused" || state === "restarting") return "warning";
  if (state === "dead") return "danger";
  return "info";
}
async function act(name: string, action: "start" | "stop" | "restart") {
  busy.value = name;
  try {
    await api.dockerAction(props.host, action, name);
    ElMessage.success(`${action} 已提交`);
    await refresh();
  } catch (e) {
    ElMessage.error(`操作失败: ${e}`);
  } finally {
    busy.value = null;
  }
}
</script>

<style scoped>
.tab-root {
  height: 100%;
  min-height: 0;
  overflow: auto;
}
.toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 10px;
}
.grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}
.card {
  min-width: 0;
}
.head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}
.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--el-text-color-secondary);
  flex-shrink: 0;
}
.dot.on {
  background: var(--el-color-success);
}
.name {
  flex: 1;
  min-width: 0;
  font-weight: 600;
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.image {
  font-size: 11px;
  margin-bottom: 8px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.row {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  margin: 4px 0;
}
.status {
  margin-top: 8px;
  font-size: 11px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.muted {
  color: var(--el-text-color-secondary);
}
.mono {
  font-variant-numeric: tabular-nums;
}
.full {
  grid-column: 1 / -1;
}
@media (max-width: 900px) {
  .grid {
    grid-template-columns: 1fr;
  }
}
</style>
