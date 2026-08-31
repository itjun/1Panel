<template>
  <div class="tab-root">
    <EnlargableCard title="软件包">
      <div class="view-toolbar pkg-toolbar">
        <div class="view-toolbar__chips">
          <span v-if="stats" class="pkg-stats">
            共 {{ stats.total }} 个 · 平均依赖 {{ stats.avgDeps }} · 最多
            {{ stats.maxDeps }} 依赖
          </span>
        </div>
        <div class="view-toolbar__tools">
          <el-input
            v-model="filter"
            clearable
            class="pkg-search"
            placeholder="搜索包名/版本..."
          />
          <el-button :loading="loading" @click="refresh">刷新</el-button>
          <el-button @click="runInTerminal('apt update')">检查更新</el-button>
          <el-button type="primary" @click="runInTerminal('apt update && apt upgrade -y')">
            升级所有
          </el-button>
        </div>
      </div>

      <el-alert v-if="error && !list.length" type="error" :title="error" show-icon />
      <el-empty
        v-if="!loading && !list.length && !error"
        description="点击刷新加载软件包列表（体积较大，按需拉取）"
      />

      <div v-else ref="tableWrap" v-loading="loading && !list.length" class="table-wrap">
        <el-table-v2
          v-if="size.width.value > 0"
          :columns="pkgColumns"
          :data="sorted"
          :width="size.width.value"
          :height="size.height.value"
          :row-height="40"
          :header-height="44"
          :row-class="zebraRowClass"
          :sort-by="sortBy"
          @column-sort="onColumnSort"
        >
          <template #empty>无匹配软件包</template>
        </el-table-v2>
      </div>
    </EnlargableCard>

    <el-dialog
      v-model="depDialog.open"
      :title="depDialog.pkg ? `${depDialog.pkg.name} 的依赖` : '依赖'"
      width="520px"
      append-to-body
      class="m3-form-dialog pkg-dep-dialog"
      destroy-on-close
    >
      <div v-if="depDialog.pkg" v-loading="depDialog.loading">
        <el-alert
          v-if="depDialog.error"
          type="error"
          :title="depDialog.error"
          show-icon
          :closable="false"
          class="dep-alert"
        />
        <div class="dep-meta">
          <div class="dep-meta__row">
            <span class="dep-meta__k">版本</span>
            <span class="dep-meta__v mono selectable">{{ depDialog.pkg.version || "—" }}</span>
          </div>
          <div class="dep-meta__row">
            <span class="dep-meta__k">依赖数</span>
            <span class="dep-meta__v">{{ depCountShown }}</span>
          </div>
        </div>
        <div v-if="depDialog.deps.length" class="dep-list-wrap">
          <ul class="dep-list selectable">
            <li v-for="d in depDialog.deps" :key="d">{{ d }}</li>
          </ul>
        </div>
        <el-empty
          v-else-if="!depDialog.loading && !depDialog.error"
          description="该包无直接依赖"
          :image-size="72"
        />
      </div>
      <template #footer>
        <el-button @click="depDialog.open = false">关闭</el-button>
        <el-button type="primary" :disabled="!depDialog.deps.length" @click="copyDeps">
          复制依赖列表
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, h, reactive, ref } from "vue";
import { ElMessage, TableV2SortOrder } from "element-plus";
import type { ColumnSortParams, SortBy } from "element-plus";
import { api } from "@/api";
import { usePolling } from "@/composables/usePolling";
import { useContainerSize } from "@/composables/useContainerSize";
import EnlargableCard from "@/components/EnlargableCard.vue";
import { useAppStore } from "@/stores/app";
import { copyText } from "@/utils/clipboard";
import { formatErr } from "@/utils/format";

interface AptPackage {
  name: string;
  version: string;
  depends: number;
  depList?: string[] | null;
}

const props = defineProps<{ host: string }>();
const app = useAppStore();
const filter = ref("");

const { data, error, loading, refresh } = usePolling<AptPackage[]>(
  () => api.collectPackages(props.host) as Promise<AptPackage[]>,
  0,
  () => props.host,
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

const tableWrap = ref<HTMLDivElement | null>(null);
const size = useContainerSize(tableWrap);

const depDialog = reactive({
  open: false,
  loading: false,
  error: "",
  pkg: null as AptPackage | null,
  deps: [] as string[],
});

const depCountShown = computed(() => {
  if (depDialog.deps.length) return depDialog.deps.length;
  return depDialog.pkg?.depends ?? 0;
});

function cacheDepList(name: string, deps: string[]) {
  if (!data.value?.length || !deps.length) return;
  const idx = data.value.findIndex((p) => p.name === name);
  if (idx < 0) return;
  data.value[idx] = { ...data.value[idx], depList: deps, depends: deps.length };
}

async function openDepDialog(pkg: AptPackage) {
  depDialog.pkg = pkg;
  depDialog.error = "";
  depDialog.deps = pkg.depList?.length ? [...pkg.depList] : [];
  depDialog.open = true;

  if (depDialog.deps.length > 0) return;
  if ((pkg.depends || 0) <= 0) return;

  depDialog.loading = true;
  try {
    const deps = await api.collectPackageDepends(props.host, pkg.name);
    depDialog.deps = deps;
    cacheDepList(pkg.name, deps);
  } catch (e) {
    depDialog.error = formatErr(e);
  } finally {
    depDialog.loading = false;
  }
}

const pkgColumns = [
  {
    key: "name",
    dataKey: "name",
    title: "包名",
    width: 240,
    sortable: true,
    flexGrow: 1,
    flexShrink: 1,
    cellRenderer: ({ cellData }: { cellData: string }) =>
      h("span", { class: "pkg-name" }, cellData || ""),
  },
  {
    key: "version",
    dataKey: "version",
    title: "版本",
    width: 200,
    sortable: true,
    flexGrow: 1,
    flexShrink: 1,
    cellRenderer: ({ cellData }: { cellData: string }) =>
      h("span", { class: "mono cell-ellipsis", title: cellData }, cellData || ""),
  },
  {
    key: "depends",
    dataKey: "depends",
    title: "依赖数",
    width: 96,
    align: "right" as const,
    sortable: true,
    cellRenderer: ({ cellData, rowData }: { cellData: number; rowData: AptPackage }) => {
      const n = cellData || 0;
      if (n <= 0) {
        return h("span", { class: "dep-zero" }, "0");
      }
      return h(
        "button",
        {
          type: "button",
          class: "dep-link",
          title: "查看依赖列表",
          onClick: (e: Event) => {
            e.stopPropagation();
            void openDepDialog(rowData);
          },
        },
        String(n)
      );
    },
  },
];

const sortBy = ref<SortBy>({ key: "", order: TableV2SortOrder.ASC });
function onColumnSort(by: ColumnSortParams<any>) {
  sortBy.value = { key: by.key, order: by.order };
}

function zebraRowClass({ rowIndex }: { rowIndex: number }): string {
  return rowIndex % 2 === 1 ? "zebra-row" : "";
}

const sorted = computed(() => {
  const { key, order } = sortBy.value;
  if (!key) return filtered.value;
  const dir = order === TableV2SortOrder.DESC ? -1 : 1;
  return [...filtered.value].sort((a, b) => {
    if (key === "depends") return dir * ((a.depends || 0) - (b.depends || 0));
    return (
      dir *
      String(a[key as "name" | "version"] || "").localeCompare(
        String(b[key as "name" | "version"] || "")
      )
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

async function copyDeps() {
  if (!depDialog.deps.length) return;
  try {
    await copyText(depDialog.deps.join("\n"));
    ElMessage.success("已复制依赖列表");
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

.pkg-toolbar {
  margin: 0;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--m3-outline-variant);
}

.pkg-stats {
  font: var(--m3-body-small);
  color: var(--m3-on-surface-variant);
}

.pkg-search {
  width: 240px;
}

.table-wrap {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--m3-outline-variant);
  border-radius: var(--m3-shape-m);
  overflow: hidden;
  background: var(--m3-surface-container-lowest);
}

.mono {
  font-family: var(--m3-font-mono);
  font-size: 12px;
}

.cell-ellipsis {
  display: block;
  min-width: 0;
  width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pkg-name {
  font: var(--m3-body-medium);
  color: var(--m3-on-surface);
}

/* 依赖数：M3 文本链接，无背景 chip */
.dep-link {
  border: none;
  padding: 0;
  background: none;
  font: var(--m3-label-large);
  color: var(--m3-primary);
  cursor: pointer;
  text-decoration: underline;
  text-underline-offset: 2px;
  &:hover {
    color: color-mix(in srgb, var(--m3-primary) 85%, var(--m3-on-surface));
  }
}
.dep-zero {
  font: var(--m3-body-medium);
  color: var(--m3-on-surface-variant);
}

.dep-alert {
  margin-bottom: 12px;
}

.dep-meta {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 12px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--m3-outline-variant);
}
.dep-meta__row {
  display: flex;
  align-items: baseline;
  gap: 12px;
  font: var(--m3-body-medium);
}
.dep-meta__k {
  flex-shrink: 0;
  width: 56px;
  color: var(--m3-on-surface-variant);
}
.dep-meta__v {
  min-width: 0;
  color: var(--m3-on-surface);
  word-break: break-all;
}

:deep(.el-table-v2__header-row) {
  background: var(--m3-surface-container);
}
:deep(.el-table-v2__header-cell) {
  font: var(--m3-title-small);
  color: var(--m3-on-surface-variant);
}
:deep(.el-table-v2__row) {
  overflow: hidden;
}
:deep(.el-table-v2__row-cell) {
  overflow: hidden;
  min-width: 0;
  font: var(--m3-body-medium);
  color: var(--m3-on-surface);
}
:deep(.el-table-v2__row.zebra-row) {
  background: color-mix(in srgb, var(--m3-primary) 4%, var(--m3-surface-container-lowest));
}
:deep(.el-table-v2__row:hover) {
  background: color-mix(in srgb, var(--m3-primary) 8%, var(--m3-surface-container-lowest));
}

.dep-list-wrap {
  max-height: 360px;
  overflow: auto;
  border: 1px solid var(--m3-outline-variant);
  border-radius: var(--m3-shape-s);
  background: var(--m3-surface-container-lowest);
}
.dep-list {
  margin: 0;
  padding: 8px 0;
  list-style: none;
  font: var(--m3-body-medium);
  color: var(--m3-on-surface);
}
.dep-list li {
  padding: 6px 14px;
  font-family: var(--m3-font-mono);
  font-size: 13px;
  line-height: 1.45;
}
.dep-list li:nth-child(odd) {
  background: color-mix(in srgb, var(--m3-primary) 4%, transparent);
}

.selectable {
  user-select: text;
  cursor: text;
}
</style>
