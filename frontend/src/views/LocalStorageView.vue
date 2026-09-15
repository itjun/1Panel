<template>
  <div class="tab-root tab-table-page storage-page">
    <!-- 与系统概览 machine-card / 网络 egress-card 同构 -->
    <div class="storage-summary">
      <div class="summary-row">
        <div class="summary-main">
          <div class="summary-title mono">
            {{ formatBytesSI(status?.containerUsed || 0) }} /
            {{ formatBytesSI(status?.containerTotal || 0) }}
          </div>
          <div class="summary-meta">
            <span>容器</span>
            <template v-if="status?.containerAvail">
              <span class="sep">·</span>
              <span>可用 {{ formatBytesSI(status.containerAvail) }}</span>
            </template>
            <span class="sep">·</span>
            <template v-if="status?.state === 'idle' && !status?.finishedAt">
              <span>尚未扫描</span>
            </template>
            <template v-else>
              <span>
                已扫描
                <span class="mono">{{ formatBytesSI(status?.scannedBytes || 0) }}</span>
              </span>
              <template v-if="coverage != null">
                <span class="sep">·</span>
                <span>覆盖约 {{ coverage }}%</span>
              </template>
              <template v-if="status?.state === 'running'">
                <span class="sep">·</span>
                <span>{{ status.scannedFiles || 0 }} 文件</span>
              </template>
              <template v-else-if="status?.finishedAt">
                <span class="sep">·</span>
                <span>记录于 {{ formatScanTime(status.finishedAt) }}</span>
              </template>
            </template>
          </div>
          <div v-if="(status?.deniedDirs || 0) > 0" class="summary-note warn">
            <span>{{ status?.deniedDirs }} 个目录因权限跳过</span>
            <el-button link type="primary" @click="openPrivacy">
              授予完全磁盘访问
            </el-button>
          </div>
          <div v-if="status?.error" class="summary-note err">{{ status.error }}</div>
        </div>
        <div class="summary-actions">
          <el-button
            type="primary"
            :loading="status?.state === 'running'"
            @click="startScan"
          >
            {{ scanButtonLabel }}
          </el-button>
        </div>
      </div>
    </div>

    <EnlargableCard bare class="tab-enl">
      <div v-if="status?.state === 'idle' && !hasRecord" class="idle-hint">
        <el-empty description="尚未扫描磁盘占用。全盘扫描可能需要一两分钟，请手动开始。">
          <el-button type="primary" @click="startScan">开始扫描</el-button>
        </el-empty>
      </div>
      <template v-else>
      <div class="view-toolbar">
        <div class="view-toolbar__chips">
          <TagButton v-model="tab" :buttons="tabButtons" />
        </div>
        <div class="view-toolbar__tools">
          <el-input
            v-if="tab === 'apps' || tab === 'large'"
            v-model="keyword"
            clearable
            class="filter-input"
            placeholder="搜索名称 / 路径…"
          />
        </div>
      </div>

      <!-- 应用占用 -->
      <div v-if="tab === 'apps'" class="table-wrap m3-table-surface">
        <el-table
          :data="filteredApps"
          stripe
          style="width: 100%"
          class="data-table-unified"
          height="100%"
          row-key="path"
        >
          <el-table-column type="expand">
            <template #default="{ row }">
              <div v-if="row.parts?.length" class="parts">
                <div v-for="p in row.parts" :key="p.path" class="part-row">
                  <span class="part-label">{{ p.label }}</span>
                  <span class="mono muted part-path" v-tip="p.path">{{ p.path }}</span>
                  <span class="mono">{{ formatBytesSI(p.size) }}</span>
                  <el-button link type="primary" @click="reveal(p.path)">显示</el-button>
                </div>
              </div>
              <div v-else class="muted parts">无关联数据目录</div>
            </template>
          </el-table-column>
          <el-table-column type="index" label="序" width="64" align="center" />
          <el-table-column prop="name" label="应用" min-width="160" show-overflow-tooltip />
          <el-table-column label="程序" min-width="100" align="right">
            <template #default="{ row }">
              <span class="mono">{{ formatBytesSI(row.bundleSize) }}</span>
            </template>
          </el-table-column>
          <el-table-column label="数据" min-width="100" align="right">
            <template #default="{ row }">
              <span class="mono">{{ formatBytesSI(row.dataSize) }}</span>
            </template>
          </el-table-column>
          <el-table-column label="合计" min-width="110" align="right" sortable :sort-method="sortAppTotal">
            <template #default="{ row }">
              <span class="mono">{{ formatBytesSI(row.total) }}</span>
            </template>
          </el-table-column>
          <el-table-column prop="path" label="路径" min-width="220" show-overflow-tooltip>
            <template #default="{ row }">
              <span class="mono">{{ row.path }}</span>
            </template>
          </el-table-column>
          <el-table-column label="" width="72" align="center">
            <template #default="{ row }">
              <el-button link type="primary" @click="reveal(row.path)">显示</el-button>
            </template>
          </el-table-column>
        </el-table>
        <el-empty
          v-if="status?.state === 'done' && !filteredApps.length"
          description="暂无应用占用数据"
        />
      </div>

      <!-- 目录树 -->
      <div v-else-if="tab === 'tree'" class="tree-wrap">
        <div class="crumbs">
          <el-button link type="primary" @click="goTree('')">扫描范围</el-button>
          <template v-for="(c, i) in crumbs" :key="c.path">
            <span class="crumb-sep">/</span>
            <el-button
              link
              type="primary"
              :disabled="i === crumbs.length - 1"
              @click="goTree(c.path)"
            >
              {{ c.name }}
            </el-button>
          </template>
        </div>
        <div class="table-wrap m3-table-surface tree-table">
          <el-table
            :data="treeChildren"
            stripe
            style="width: 100%"
            class="data-table-unified"
            height="100%"
            @row-click="onTreeRow"
          >
            <el-table-column type="index" label="序" width="64" align="center" />
            <el-table-column label="名称" min-width="220" show-overflow-tooltip>
              <template #default="{ row }">
                <span :class="{ 'is-dir': row.isDir }">{{ row.name }}</span>
                <span v-if="row.isDir" class="muted tiny"> 文件夹</span>
              </template>
            </el-table-column>
            <el-table-column label="大小" min-width="100" align="right">
              <template #default="{ row }">
                <span class="mono">{{ formatBytesSI(row.size) }}</span>
              </template>
            </el-table-column>
            <el-table-column label="占比" min-width="160">
              <template #default="{ row }">
                <el-progress
                  :percentage="treePercent(row.size)"
                  :stroke-width="8"
                  :show-text="true"
                />
              </template>
            </el-table-column>
            <el-table-column label="" width="72" align="center">
              <template #default="{ row }">
                <el-button link type="primary" @click.stop="reveal(row.path)">显示</el-button>
              </template>
            </el-table-column>
          </el-table>
        </div>
      </div>

      <!-- 大文件 -->
      <div v-else class="table-wrap m3-table-surface">
        <el-table
          :data="filteredLarge"
          stripe
          style="width: 100%"
          class="data-table-unified"
          height="100%"
        >
          <el-table-column type="index" label="序" width="64" align="center" />
          <el-table-column prop="path" label="路径" min-width="360" show-overflow-tooltip>
            <template #default="{ row }">
              <span class="mono">{{ row.path }}</span>
            </template>
          </el-table-column>
          <el-table-column label="大小" min-width="110" align="right">
            <template #default="{ row }">
              <span class="mono">{{ formatBytesSI(row.size) }}</span>
            </template>
          </el-table-column>
          <el-table-column label="修改时间" min-width="160">
            <template #default="{ row }">
              {{ formatModTime(row.modTime) }}
            </template>
          </el-table-column>
          <el-table-column label="" width="100" align="center">
            <template #default="{ row }">
              <el-button link type="primary" @click="reveal(row.path)">显示</el-button>
            </template>
          </el-table-column>
        </el-table>
        <el-empty
          v-if="status?.state === 'done' && !filteredLarge.length"
          description="暂无大文件"
        />
      </div>
      </template>
    </EnlargableCard>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { api } from "@/api";
import type { localsys } from "@/api";
import EnlargableCard from "@/components/EnlargableCard.vue";
import TagButton from "@/components/TagButton.vue";
import { useAppStore } from "@/stores/app";
import { formatBytesSI } from "@/utils/format";

const app = useAppStore();
const tab = ref<"apps" | "tree" | "large">("apps");
const keyword = ref("");
const status = ref<localsys.StorageStatus | null>(null);
const apps = ref<localsys.StorageApp[]>([]);
const large = ref<localsys.StorageFile[]>([]);
const treePath = ref("");
const treeNode = ref<localsys.StorageNode | null>(null);
let pollTimer: ReturnType<typeof setInterval> | null = null;

const tabButtons = [
  { value: "apps", label: "应用占用" },
  { value: "tree", label: "目录" },
  { value: "large", label: "大文件" },
];

const hasRecord = computed(
  () => (status.value?.finishedAt || 0) > 0 || status.value?.state === "done"
);

const scanButtonLabel = computed(() => {
  if (status.value?.state === "running") return "扫描中…";
  if (hasRecord.value) return "重新扫描";
  return "开始扫描";
});

const coverage = computed(() => {
  const used = status.value?.containerUsed || 0;
  const scanned = status.value?.scannedBytes || 0;
  if (!used) return null;
  return Math.min(100, Math.round((scanned / used) * 100));
});

const filteredApps = computed(() => {
  const q = keyword.value.trim().toLowerCase();
  if (!q) return apps.value;
  return apps.value.filter(
    (a) =>
      (a.name || "").toLowerCase().includes(q) ||
      (a.path || "").toLowerCase().includes(q) ||
      (a.bundleId || "").toLowerCase().includes(q)
  );
});

const filteredLarge = computed(() => {
  const q = keyword.value.trim().toLowerCase();
  if (!q) return large.value;
  return large.value.filter((f) => (f.path || "").toLowerCase().includes(q));
});

const treeChildren = computed(() => treeNode.value?.children || []);

const crumbs = computed(() => {
  const p = treePath.value;
  if (!p) return [] as { name: string; path: string }[];
  const parts = p.split("/").filter(Boolean);
  const out: { name: string; path: string }[] = [];
  let cur = "";
  for (const part of parts) {
    cur += "/" + part;
    out.push({ name: part, path: cur });
  }
  return out;
});

function sortAppTotal(a: localsys.StorageApp, b: localsys.StorageApp) {
  return (a.total || 0) - (b.total || 0);
}

function treePercent(size: number) {
  const parent = treeNode.value?.size || 0;
  if (!parent || !size) return 0;
  return Math.min(100, Math.round((size / parent) * 100));
}

function formatScanTime(sec: number) {
  if (!sec) return "";
  const d = new Date(sec * 1000);
  return d.toLocaleString();
}

function formatModTime(sec: number) {
  if (!sec) return "—";
  return new Date(sec * 1000).toLocaleString();
}

async function refreshStatus() {
  try {
    status.value = await api.localSysStorageStatus();
  } catch {
    /* ignore */
  }
}

async function loadResults() {
  try {
    const [a, l] = await Promise.all([
      api.localSysStorageApps(),
      api.localSysStorageLargeFiles(),
    ]);
    apps.value = a;
    large.value = l;
  } catch {
    apps.value = [];
    large.value = [];
  }
  await loadTree(treePath.value);
}

async function loadTree(path: string) {
  try {
    treeNode.value = await api.localSysStorageTree(path);
    treePath.value = path;
  } catch {
    treeNode.value = null;
  }
}

function goTree(path: string) {
  void loadTree(path);
}

function onTreeRow(row: localsys.StorageNode) {
  if (row.isDir) {
    void loadTree(row.path);
  }
}

async function startScan() {
  try {
    status.value = await api.localSysStorageScanStart();
    startPoll();
  } catch (e) {
    status.value = {
      state: "error",
      error: e instanceof Error ? e.message : String(e),
      scannedBytes: 0,
      scannedFiles: 0,
      scannedDirs: 0,
      deniedDirs: 0,
      deniedPaths: [],
      startedAt: 0,
      finishedAt: 0,
      roots: [],
      containerTotal: 0,
      containerUsed: 0,
      containerAvail: 0,
    };
  }
}

function startPoll() {
  stopPoll();
  pollTimer = setInterval(async () => {
    await refreshStatus();
    const st = status.value?.state;
    if (st === "done" || st === "error" || st === "idle") {
      stopPoll();
      if (st === "done") {
        await loadResults();
      }
    }
  }, 1000);
}

function stopPoll() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

async function reveal(path: string) {
  try {
    await api.localSysStorageReveal(path);
  } catch {
    /* ignore */
  }
}

async function openPrivacy() {
  try {
    await api.localSysStorageOpenPrivacy();
  } catch {
    /* ignore */
  }
}

watch(tab, (v) => {
  if (v === "tree" && !treeNode.value && status.value?.state === "done") {
    void loadTree(treePath.value);
  }
});

onMounted(async () => {
  await refreshStatus();
  const st = status.value?.state;
  if (st === "done") {
    await loadResults();
  } else if (st === "running") {
    startPoll();
  }
  // idle：不自动扫描，等用户手动点「开始扫描」
});

onUnmounted(() => {
  stopPoll();
});

// 离开本页再回来时由 onMounted 处理；workspace 切换时若仍挂载则刷新
watch(
  () => app.localSection,
  async (v) => {
    if (v !== "storage") return;
    await refreshStatus();
    if (status.value?.state === "done" && !apps.value.length) {
      await loadResults();
    } else if (status.value?.state === "running") {
      startPoll();
    }
  }
);
</script>

<style scoped lang="scss">
.idle-hint {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 240px;
}

.storage-page {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 0;
}

.storage-summary {
  padding: 12px 16px;
  border-radius: var(--m3-shape-m, 12px);
  background: var(--el-bg-color);
  border: 1px solid var(--el-border-color-lighter);
}

.summary-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.summary-main {
  min-width: 0;
  flex: 1;
}

.summary-title {
  font-size: 22px;
  font-weight: 700;
  letter-spacing: -0.02em;
  line-height: 1.25;
  color: var(--el-text-color-primary);
}

.summary-meta {
  margin-top: 6px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
  display: flex;
  flex-wrap: wrap;
  gap: 2px 0;
  align-items: center;
}

.sep {
  margin: 0 7px;
  opacity: 0.4;
}

.summary-note {
  margin-top: 8px;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  font-size: 12px;
}

.summary-note.warn {
  color: var(--el-color-warning);
}

.summary-note.err {
  color: var(--el-color-danger);
}

.summary-actions {
  flex-shrink: 0;
}

.muted {
  color: var(--m3-on-surface-variant, var(--el-text-color-secondary));
}

.mono {
  font-family: var(--m3-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
  font-variant-numeric: tabular-nums;
}

.table-wrap {
  flex: 1;
  min-height: 0;
}

.tree-wrap {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  gap: 8px;
}

.tree-table {
  flex: 1;
}

.crumbs {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 2px;
  padding: 0 4px;
}

.crumb-sep {
  color: var(--el-text-color-placeholder);
  margin: 0 2px;
}

.is-dir {
  font-weight: 600;
}

.tiny {
  font-size: 11px;
}

.parts {
  padding: 8px 16px 12px 48px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.part-row {
  display: grid;
  grid-template-columns: 140px 1fr auto auto;
  gap: 10px;
  align-items: center;
  font-size: 12px;
}

.part-label {
  color: var(--el-text-color-secondary);
}

.part-path {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.filter-input {
  width: 220px;
}
</style>
