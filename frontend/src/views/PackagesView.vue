<template>
  <div class="tab-root">
    <EnlargableCard title="软件包">
    <div class="toolbar">
      <span v-if="stats" class="muted">
        共 {{ stats.total }} 个 · 平均依赖 {{ stats.avgDeps }} · 最多
        {{ stats.maxDeps }} 依赖
      </span>
      <el-input
        v-model="filter"
        size="large"
        clearable
        class="search"
        placeholder="搜索包名/版本..."
      />
      <el-button size="large" :loading="loading" @click="refresh">刷新</el-button>
      <el-button size="large" @click="runInTerminal('apt update')">检查更新</el-button>
      <el-button
        size="large"
        type="primary"
        @click="runInTerminal('apt update && apt upgrade -y')"
      >
        升级所有
      </el-button>
    </div>
    <el-alert v-if="error && !list.length" type="error" :title="error" show-icon />
    <el-empty
      v-if="!loading && !list.length && !error"
      description="点击刷新加载软件包列表（体积较大，按需拉取）"
    />
    <el-table
      v-else
      v-loading="loading && !list.length"
      :data="display"
      height="100%"
      size="small"
      stripe
      empty-text="无匹配软件包"
    >
      <el-table-column prop="name" label="包名" min-width="180" sortable />
      <el-table-column prop="version" label="版本" min-width="160" sortable />
      <el-table-column prop="depends" label="依赖数" width="100" align="right" sortable>
        <template #default="{ row }">
          <el-tag
            size="small"
            :type="row.depends >= 20 ? 'warning' : row.depends >= 10 ? 'primary' : 'info'"
          >
            {{ row.depends }}
          </el-tag>
        </template>
      </el-table-column>
    </el-table>
    <div v-if="filtered.length > 500" class="hint">
      只显示前 500 条（共 {{ filtered.length }} 条匹配），请用搜索缩小范围
    </div>
    </EnlargableCard>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { api } from "@/api";
import { usePolling } from "@/composables/usePolling";
import EnlargableCard from "@/components/EnlargableCard.vue";
import { useAppStore } from "@/stores/app";

interface AptPackage {
  name: string;
  version: string;
  depends: number;
}

const props = defineProps<{ host: string }>();
const app = useAppStore();
const filter = ref("");

const { data, error, loading, refresh } = usePolling<AptPackage[]>(
  () => api.collectPackages(props.host) as Promise<AptPackage[]>,
  0,
  () => props.host
);

const list = computed(() => data.value || []);
const filtered = computed(() => {
  const q = filter.value.trim().toLowerCase();
  if (!q) return list.value;
  return list.value.filter(
    (p) =>
      p.name.toLowerCase().includes(q) || (p.version || "").toLowerCase().includes(q)
  );
});
const display = computed(() => filtered.value.slice(0, 500));
const stats = computed(() => {
  if (!list.value.length) return null;
  let maxDeps = 0;
  let sum = 0;
  for (const p of list.value) {
    if (p.depends > maxDeps) maxDeps = p.depends;
    sum += p.depends;
  }
  return {
    total: list.value.length,
    maxDeps,
    avgDeps: Math.round((sum / list.value.length) * 10) / 10,
  };
});

function runInTerminal(cmd: string) {
  if (!app.activeTabId) return;
  app.sendTerminalCmd(cmd);
  app.setSubTab(app.activeTabId, "terminal");
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
.title {
  font-weight: 600;
}
.muted {
  font-size: 11px;
  color: var(--el-text-color-secondary);
}
.search {
  width: 220px;
  margin-left: auto;
}
.hint {
  font-size: 11px;
  color: var(--el-text-color-secondary);
  text-align: center;
}
:deep(.el-table) {
  flex: 1;
}
</style>
