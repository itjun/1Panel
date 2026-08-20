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
    <div v-else ref="tableWrap" v-loading="loading && !list.length" class="table-wrap">
      <!-- 虚拟化表格：数千行 apt 包全量渲染，只画可视区 -->
      <el-table-v2
        v-if="size.width.value > 0"
        :columns="pkgColumns"
        :data="sorted"
        :width="size.width.value"
        :height="size.height.value"
        :row-height="34"
        :header-height="38"
        :sort-by="sortBy"
        @column-sort="onColumnSort"
      >
        <template #empty>无匹配软件包</template>
      </el-table-v2>
    </div>
    </EnlargableCard>
  </div>
</template>

<script setup lang="ts">
import { computed, h, ref } from "vue";
import { ElTag } from "element-plus";
import { api } from "@/api";
import { usePolling } from "@/composables/usePolling";
import { useContainerSize } from "@/composables/useContainerSize";
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
  () => props.host,
  // 子页常驻后切回补刷一次
  () => app.isHostSubActive(props.host, "packages")
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

// 虚拟化表格（el-table-v2）：容器尺寸 + 列定义 + 排序状态
const tableWrap = ref<HTMLDivElement | null>(null);
const size = useContainerSize(tableWrap);

const pkgColumns = [
  { key: "name", dataKey: "name", title: "包名", width: 240, sortable: true, flexGrow: 1, flexShrink: 1 },
  { key: "version", dataKey: "version", title: "版本", width: 200, sortable: true, flexGrow: 1, flexShrink: 1 },
  {
    key: "depends",
    dataKey: "depends",
    title: "依赖数",
    width: 100,
    align: "right" as const,
    sortable: true,
    cellRenderer: ({ cellData }: { cellData: number }) =>
      h(
        ElTag,
        {
          size: "small",
          type: cellData >= 20 ? "warning" : cellData >= 10 ? "primary" : "info",
        },
        () => String(cellData)
      ),
  },
];

const sortBy = ref<{ key: string; order: string }>({ key: "", order: "asc" });
function onColumnSort(by: { key: string; order: string }) {
  sortBy.value = by;
}
const sorted = computed(() => {
  const { key, order } = sortBy.value;
  if (!key) return filtered.value;
  const dir = order === "desc" ? -1 : 1;
  return [...filtered.value].sort((a, b) => {
    if (key === "depends") return dir * ((a.depends || 0) - (b.depends || 0));
    return (
      dir * String(a[key as "name" | "version"] || "").localeCompare(String(b[key as "name" | "version"] || ""))
    );
  });
});
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
.table-wrap {
  flex: 1;
  min-height: 0;
}
</style>
