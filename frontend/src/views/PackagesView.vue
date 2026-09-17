<template>
  <div class="tab-root tab-table-page">
    <EnlargableCard bare class="tab-enl">
      <ViewToolbar>
        <span v-if="stats" class="pkg-stats">
          共 {{ stats.total }} 个 · 平均依赖 {{ stats.avgDeps }} · 最多
          {{ stats.maxDeps }} 依赖
        </span>
        <template #tools>
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
        </template>
      </ViewToolbar>

      <el-alert v-if="error && !list.length" type="error" :title="error" show-icon />
      <PageSkeleton v-if="loading && !list.length" variant="table" :show-toolbar="false" />
      <el-empty
        v-else-if="!loading && !list.length && !error"
        description="点击刷新加载软件包列表（体积较大，按需拉取）"
      />

      <div v-else-if="list.length" ref="tableWrap" class="table-wrap m3-table-surface m3-table-v2">
        <el-table-v2
          v-if="size.width.value > 0"
          :columns="pkgColumns"
          :data="sorted"
          :width="size.width.value"
          :height="size.height.value"
          :row-height="M3_TABLE_ROW_HEIGHT"
          :header-height="M3_TABLE_HEADER_HEIGHT"
          :sort-by="sortBy"
          @column-sort="onColumnSort"
        >
          <template #empty>无匹配软件包</template>
        </el-table-v2>
      </div>
    </EnlargableCard>

    <el-dialog
      v-model="depDialog.open"
      :title="depDialog.pkg ? `${depDialog.pkg.name} 依赖关系` : '依赖关系'"
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
          <div class="dep-meta__row">
            <span class="dep-meta__k">被依赖数</span>
            <span class="dep-meta__v">{{ rDepCountShown }}</span>
          </div>
        </div>
        <template v-if="depDialog.deps.length">
          <div class="dep-section-title">依赖的包</div>
          <div class="dep-list-wrap">
            <ul class="dep-list selectable">
              <li v-for="d in depDialog.deps" :key="'d-' + d">{{ d }}</li>
            </ul>
          </div>
        </template>
        <template v-if="depDialog.rdeps.length">
          <div class="dep-section-title">被哪些包依赖</div>
          <div class="dep-list-wrap">
            <ul class="dep-list selectable">
              <li v-for="d in depDialog.rdeps" :key="'r-' + d">{{ d }}</li>
            </ul>
          </div>
        </template>
        <el-empty
          v-if="!depDialog.loading && !depDialog.error && !depDialog.deps.length && !depDialog.rdeps.length"
          description="无直接依赖关系"
          :image-size="72"
        />
      </div>
      <template #footer>
        <el-button @click="depDialog.open = false">关闭</el-button>
        <el-button
          v-if="depDialog.deps.length"
          @click="copyDeps"
        >
          复制依赖列表
        </el-button>
        <el-button
          v-if="depDialog.rdeps.length"
          type="primary"
          @click="copyRDeps"
        >
          复制被依赖列表
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
import PageSkeleton from "@/components/PageSkeleton.vue";
import ViewToolbar from "@/components/ViewToolbar.vue";
import { useAppStore } from "@/stores/app";
import { copyText } from "@/utils/clipboard";
import { formatErr } from "@/utils/format";
import {
  M3_TABLE_HEADER_HEIGHT,
  M3_TABLE_ROW_HEIGHT,
  m3TableIndexColumn,
} from "@/constants/m3Table";
import { tipAttrs } from "@/directives/tip";

interface AptPackage {
  name: string;
  version: string;
  depends: number;
  depList?: string[] | null;
  dependedBy?: number;
  rDepList?: string[] | null;
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

/** 列表内反查被依赖（兼容旧 agent 无 dependedBy 字段） */
const reverseIndex = computed(() => {
  const counts = new Map<string, number>();
  const lists = new Map<string, string[]>();
  const pkgs = list.value;
  if (!pkgs.length) return { counts, lists };
  const names = new Set(pkgs.map((p) => p.name));
  for (const pkg of pkgs) {
    for (const dep of pkg.depList ?? []) {
      if (!names.has(dep)) continue;
      counts.set(dep, (counts.get(dep) ?? 0) + 1);
      const arr = lists.get(dep) ?? [];
      arr.push(pkg.name);
      lists.set(dep, arr);
    }
  }
  return { counts, lists };
});

function pkgDependedBy(pkg: AptPackage): number {
  if (pkg.dependedBy != null && pkg.dependedBy > 0) return pkg.dependedBy;
  const n = reverseIndex.value.counts.get(pkg.name);
  if (n != null) return n;
  return pkg.dependedBy ?? 0;
}

function pkgRDeps(pkg: AptPackage): string[] {
  if (pkg.rDepList?.length) return [...pkg.rDepList];
  return [...(reverseIndex.value.lists.get(pkg.name) ?? [])];
}
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
  rdeps: [] as string[],
});

const depCountShown = computed(() => {
  if (depDialog.deps.length) return depDialog.deps.length;
  return depDialog.pkg?.depends ?? 0;
});

const rDepCountShown = computed(() => {
  if (depDialog.rdeps.length) return depDialog.rdeps.length;
  if (depDialog.pkg) return pkgDependedBy(depDialog.pkg);
  return 0;
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
  depDialog.rdeps = pkgRDeps(pkg);
  depDialog.open = true;

  const needFetchDeps =
    depDialog.deps.length === 0 && (pkg.depends || 0) > 0;
  if (!needFetchDeps) return;

  depDialog.loading = true;
  try {
    const deps = await api.collectPackageDepends(props.host, pkg.name);
    depDialog.deps = deps;
    cacheDepList(pkg.name, deps);
    // 补拉依赖后刷新被依赖反查
    depDialog.rdeps = pkgRDeps({ ...pkg, depList: deps, depends: deps.length });
  } catch (e) {
    depDialog.error = formatErr(e);
  } finally {
    depDialog.loading = false;
  }
}

function depCountCell(n: number, rowData: AptPackage, tip: string) {
  if (n <= 0) {
    return h("span");
  }
  return h(
    "button",
    {
      type: "button",
      class: "pkg-dep-link",
      ...tipAttrs(tip),
      onClick: (e: Event) => {
        e.stopPropagation();
        void openDepDialog(rowData);
      },
    },
    String(n)
  );
}

const pkgColumns = [
  m3TableIndexColumn(),
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
    width: 180,
    sortable: true,
    flexGrow: 1,
    flexShrink: 1,
    cellRenderer: ({ cellData }: { cellData: string }) =>
      h("span", { class: "mono cell-ellipsis", ...tipAttrs(cellData) }, cellData || ""),
  },
  {
    key: "depends",
    dataKey: "depends",
    title: "依赖数",
    width: 88,
    align: "right" as const,
    sortable: true,
    cellRenderer: ({ cellData, rowData }: { cellData: number; rowData: AptPackage }) =>
      depCountCell(cellData || 0, rowData, "查看依赖的包"),
  },
  {
    key: "dependedBy",
    dataKey: "dependedBy",
    title: "被依赖数",
    width: 96,
    align: "right" as const,
    sortable: true,
    cellRenderer: ({ rowData }: { rowData: AptPackage }) =>
      depCountCell(pkgDependedBy(rowData), rowData, "查看被哪些包依赖"),
  },
];

const sortBy = ref<SortBy>({ key: "", order: TableV2SortOrder.ASC });
function onColumnSort(by: ColumnSortParams<any>) {
  sortBy.value = { key: by.key, order: by.order };
}

const sorted = computed(() => {
  const { key, order } = sortBy.value;
  if (!key) return filtered.value;
  const dir = order === TableV2SortOrder.DESC ? -1 : 1;
  return [...filtered.value].sort((a, b) => {
    if (key === "depends") return dir * ((a.depends || 0) - (b.depends || 0));
    if (key === "dependedBy") return dir * (pkgDependedBy(a) - pkgDependedBy(b));
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
  void app.runInTerminal(cmd);
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

async function copyRDeps() {
  if (!depDialog.rdeps.length) return;
  try {
    await copyText(depDialog.rdeps.join("\n"));
    ElMessage.success("已复制被依赖列表");
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

.dep-section-title {
  margin: 12px 0 8px;
  font: var(--m3-title-small);
  color: var(--m3-on-surface-variant);
}
.dep-section-title:first-of-type {
  margin-top: 0;
}

.dep-list-wrap {
  max-height: 360px;
  overflow: auto;
  border: 1px solid var(--m3-outline-variant);
  border-radius: var(--m3-shape-s);
  background: var(--m3-card);
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
  border-bottom: 1px solid color-mix(in srgb, var(--m3-outline-variant) 45%, transparent);
}
.dep-list li:last-child {
  border-bottom: none;
}

.selectable {
  user-select: text;
  cursor: text;
}
</style>

<style>
/* el-table-v2 单元格 Teleport 到表内，scoped 样式打不上，依赖数链接用全局类 */
.pkg-dep-link {
  display: inline;
  margin: 0;
  padding: 0;
  border: none;
  background: none;
  appearance: none;
  font: inherit;
  font-variant-numeric: tabular-nums;
  color: var(--m3-primary);
  cursor: pointer;
  text-decoration: none;
  line-height: inherit;
}
.pkg-dep-link:hover {
  color: color-mix(in srgb, var(--m3-primary) 85%, var(--m3-on-surface));
  text-decoration: underline;
  text-underline-offset: 2px;
}
</style>
