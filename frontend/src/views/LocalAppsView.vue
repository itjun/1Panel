<template>
  <div class="tab-root tab-table-page">
    <EnlargableCard bare class="tab-enl">
      <div class="view-toolbar">
        <div class="view-toolbar__chips">
          <RouterButton
            v-model="runtimeFilter"
            fluid
            :buttons="runtimeButtons"
          />
        </div>
        <div class="view-toolbar__tools">
          <el-input
            v-model="keyword"
            clearable
            class="filter-input"
            placeholder="搜索名称 / 命令 / 路径 / 端口…"
          />
          <el-button
            type="danger"
            plain
            :disabled="!canKillSelected"
            @click="killSelected"
          >
            {{ killButtonLabel }}
          </el-button>
          <el-button :icon="Refresh" :loading="loading" @click="refresh" />
        </div>
      </div>

      <el-alert
        v-if="warnings.length"
        type="warning"
        :closable="false"
        show-icon
        class="local-warn"
        :title="warnings.join('；')"
      />

      <div
        v-if="loading && !treeRows.length"
        class="table-wrap m3-table-surface"
      >
        <PageSkeleton
          variant="table"
          :show-toolbar="false"
          :framed="false"
          :cols="11"
          :rows="10"
        />
      </div>
      <el-alert
        v-else-if="error && !treeRows.length"
        type="error"
        :title="error"
        show-icon
        :closable="false"
      />

      <div
        v-else-if="treeRows.length"
        class="table-wrap m3-table-surface m3-table-v2"
      >
        <el-table
          :data="treeRows"
          row-key="id"
          :tree-props="{ children: 'children', hasChildren: 'hasChildren' }"
          :expand-row-keys="expandedKeys"
          :current-row-key="selectedId || undefined"
          stripe
          highlight-current-row
          style="width: 100%"
          class="data-table-unified local-apps-table"
          @expand-change="onExpandChange"
          @row-click="onRowClick"
          @row-dblclick="onRowDblClick"
          @row-contextmenu="onRowContextMenu"
        >
          <!-- 树表展开箭头固定落在首列；单独留一列给箭头，避免挤掉「序」 -->
          <el-table-column width="40" class-name="tree-expand-col" />
          <el-table-column label="序" width="56" align="center">
            <template #default="{ row }">
              <span v-if="row.kind === 'app'" class="mono">{{ row.seq }}</span>
            </template>
          </el-table-column>
          <el-table-column prop="name" label="名称" min-width="220" show-overflow-tooltip>
            <template #default="{ row }">
              <span class="name-cell">{{ row.name }}</span>
            </template>
          </el-table-column>
          <el-table-column prop="typeLabel" label="类型" width="110" show-overflow-tooltip />
          <el-table-column prop="pidLabel" label="进程数/PID" min-width="120" show-overflow-tooltip>
            <template #default="{ row }">
              <span class="mono">{{ row.pidLabel }}</span>
            </template>
          </el-table-column>
          <el-table-column label="端口" min-width="100" show-overflow-tooltip>
            <template #default="{ row }">
              <span class="mono">{{ formatPorts(row) }}</span>
            </template>
          </el-table-column>
          <el-table-column prop="cpu" label="CPU%" min-width="88" align="right">
            <template #default="{ row }">
              <span class="mono" :class="cpuClass(row.cpu)">{{ fmtCpu(row.cpu) }}</span>
            </template>
          </el-table-column>
          <el-table-column label="内存" min-width="110" align="right" show-overflow-tooltip>
            <template #default="{ row }">
              <span class="mono">{{ formatBytes(row.rss || 0) }}</span>
            </template>
          </el-table-column>
          <el-table-column label="磁盘读/写" min-width="180" align="right" show-overflow-tooltip>
            <template #default="{ row }">
              <span class="mono">{{ formatIoPair(row, "disk") }}</span>
            </template>
          </el-table-column>
          <el-table-column label="网络收/发" min-width="180" align="right" show-overflow-tooltip>
            <template #default="{ row }">
              <span class="mono">{{ formatIoPair(row, "net") }}</span>
            </template>
          </el-table-column>
          <el-table-column label="运行时长" min-width="140" show-overflow-tooltip>
            <template #default="{ row }">
              <span v-if="row.elapsed != null && row.elapsed > 0">
                {{ formatDurationLong(row.elapsed) }}
              </span>
              <span v-else class="dim">—</span>
            </template>
          </el-table-column>
        </el-table>
      </div>

      <el-empty
        v-if="!loading && !error && !treeRows.length"
        :description="emptyDescription"
      />
    </EnlargableCard>

    <LocalAppContextMenu
      :menu="ctxMenu"
      @close="ctxMenu = null"
      @killed="onKilled"
      @detail="onOpenDetail"
    />
    <LocalAppDetailCard
      :node="detailCard.node"
      :x="detailCard.x"
      :y="detailCard.y"
      @close="closeDetail"
    />
  </div>
</template>

<script setup lang="ts">
/**
 * 本机应用监控：两层树表（应用 → 进程）+ 工具栏/右键结束进程。
 * 过滤：页内 runtime chips + 关键字；展开状态在刷新时合并保留。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { ElMessage } from "element-plus";
import { Refresh } from "@element-plus/icons-vue";
import { api } from "@/api";
import type { localapps } from "@/api";
import EnlargableCard from "@/components/EnlargableCard.vue";
import PageSkeleton from "@/components/PageSkeleton.vue";
import RouterButton from "@/components/RouterButton.vue";
import LocalAppContextMenu, {
  type LocalAppCtxMenuState,
  type LocalCardNode,
} from "@/components/LocalAppContextMenu.vue";
import LocalAppDetailCard from "@/components/LocalAppDetailCard.vue";
import { usePolling } from "@/composables/usePolling";
import { useAppStore, type LocalRuntimeFilter } from "@/stores/app";
import { LOCAL_LANG_OPTIONS, localLangLabel } from "@/utils/localLang";
import {
  confirmAndKillLocalProcs,
  type LocalKillTarget,
} from "@/utils/localAppsKill";
import {
  formatBytes,
  formatDurationLong,
} from "@/utils/format";

type RowKind = "app" | "proc";

interface TreeRow {
  id: string;
  kind: RowKind;
  /** 仅应用行：当前列表中的序号（从 1 起） */
  seq?: number;
  name: string;
  typeLabel: string;
  pidLabel: string;
  ports: number[];
  cpu: number;
  rss: number;
  diskReadRate: number;
  diskWriteRate: number;
  netInRate: number;
  netOutRate: number;
  rateKnown: boolean;
  elapsed: number | null;
  cmd: string;
  children?: TreeRow[];
  hasChildren?: boolean;
  card: LocalCardNode;
}

const app = useAppStore();
const keyword = ref("");
const runtimeFilter = ref<LocalRuntimeFilter>("all");

const { data, error, loading, refresh } = usePolling<localapps.Snapshot>(
  () => api.localAppsScan(),
  5000,
  () => "local-apps",
  () =>
    app.workspace === "local" &&
    app.localSection === "procs" &&
    !app.settingsOpen
);

const warnings = computed(() => data.value?.warnings || []);

const runtimeButtons = computed(() => {
  const apps = data.value?.apps || [];
  const counts: Record<string, number> = {};
  for (const o of LOCAL_LANG_OPTIONS) {
    counts[o.value] = 0;
  }
  for (const a of apps) {
    const rt = a.runtime || "";
    if (rt in counts) {
      counts[rt] += 1;
    }
  }
  return [
    { value: "all", label: "全部", count: apps.length || undefined },
    ...LOCAL_LANG_OPTIONS.map((o) => ({
      value: o.value,
      label: o.label,
      count: counts[o.value] || undefined,
    })),
  ];
});

function runtimeLabel(rt: string) {
  return localLangLabel(rt);
}

function isSelfProc(p: localapps.ProcNode) {
  return p.extra?.self === "1";
}

function procToKillTarget(p: localapps.ProcNode): LocalKillTarget | null {
  if (!p.pid || isSelfProc(p)) return null;
  return {
    pid: p.pid,
    name: baseName(p.exe) || `pid-${p.pid}`,
    cmd: p.cmd || (p.args || []).join(" ") || "",
  };
}

function procToRow(p: localapps.ProcNode, runtime: string): TreeRow {
  const id = `proc:${p.pid}`;
  const threads = p.threads || [];
  const cmd = p.cmd || (p.args || []).join(" ") || "";
  const ports = p.ports || [];
  return {
    id,
    kind: "proc",
    name: baseName(p.exe) || `pid-${p.pid}`,
    typeLabel: "进程",
    pidLabel: String(p.pid),
    ports,
    cpu: p.cpu || 0,
    rss: p.rss || 0,
    diskReadRate: p.diskReadRate || 0,
    diskWriteRate: p.diskWriteRate || 0,
    netInRate: p.netInRate || 0,
    netOutRate: p.netOutRate || 0,
    rateKnown: !!p.rateKnown,
    elapsed: p.elapsed != null ? Number(p.elapsed) : null,
    cmd,
    card: {
      kind: "proc",
      id,
      name: baseName(p.exe) || `pid-${p.pid}`,
      runtime,
      pid: p.pid,
      ppid: p.ppid,
      user: p.user || "",
      cpu: p.cpu || 0,
      rss: p.rss || 0,
      threadCount: p.threadCount || threads.length,
      elapsed: p.elapsed != null ? Number(p.elapsed) : undefined,
      exe: p.exe || "",
      cwd: p.cwd || "",
      cmd,
      ports,
      extra: (p.extra || null) as Record<string, string> | null,
    },
  };
}

function appToRow(a: localapps.AppNode): TreeRow {
  const id = `app:${a.key}`;
  const procs = a.procs || [];
  const children = procs.map((p) => procToRow(p, a.runtime));
  const killTargets: LocalKillTarget[] = [];
  for (const p of procs) {
    const t = procToKillTarget(p);
    if (t) killTargets.push(t);
  }
  const portSet = new Set<number>();
  for (const c of children) {
    for (const port of c.ports) {
      if (port > 0) portSet.add(port);
    }
  }
  const ports = [...portSet].sort((x, y) => x - y);
  const procCount = a.procCount || procs.length;
  return {
    id,
    kind: "app",
    name: a.name || a.key,
    typeLabel: runtimeLabel(a.runtime),
    pidLabel: `×${procCount}`,
    ports,
    cpu: a.cpu || 0,
    rss: a.rss || 0,
    diskReadRate: a.diskReadRate || 0,
    diskWriteRate: a.diskWriteRate || 0,
    netInRate: a.netInRate || 0,
    netOutRate: a.netOutRate || 0,
    rateKnown: !!a.rateKnown,
    elapsed: null,
    cmd: "",
    children: children.length ? children : undefined,
    hasChildren: children.length > 0,
    card: {
      kind: "app",
      id,
      name: a.name || a.key,
      runtime: a.runtime,
      cpu: a.cpu || 0,
      rss: a.rss || 0,
      procCount,
      threadCount: a.threadCount || 0,
      killTargets,
    },
  };
}

function baseName(path: string | undefined) {
  if (!path) return "";
  const i = path.lastIndexOf("/");
  return i >= 0 ? path.slice(i + 1) : path;
}

function rowMatchesKeyword(row: TreeRow, q: string): boolean {
  if (!q) return true;
  if ((row.name || "").toLowerCase().includes(q)) return true;
  if ((row.cmd || "").toLowerCase().includes(q)) return true;
  if ((row.card.exe || "").toLowerCase().includes(q)) return true;
  if (row.ports && row.ports.some((p) => String(p).includes(q))) return true;
  return false;
}

/** 关键字命中时保留祖先，并保留命中节点的子树 */
function filterTree(rows: TreeRow[], q: string): TreeRow[] {
  if (!q) return rows;
  const out: TreeRow[] = [];
  for (const row of rows) {
    const selfHit = rowMatchesKeyword(row, q);
    const filteredChildren = row.children ? filterTree(row.children, q) : [];
    if (selfHit) {
      out.push(row);
    } else if (filteredChildren.length) {
      out.push({ ...row, children: filteredChildren, hasChildren: true });
    }
  }
  return out;
}

const treeRows = computed(() => {
  const apps = data.value?.apps || [];
  const rt = runtimeFilter.value;
  let filteredApps = apps;
  if (rt !== "all") {
    filteredApps = apps.filter((a) => (a.runtime || "") === rt);
  }
  const built = filteredApps.map(appToRow);
  const q = keyword.value.trim().toLowerCase();
  const rows = filterTree(built, q);
  rows.forEach((row, i) => {
    if (row.kind === "app") row.seq = i + 1;
  });
  return rows;
});

const emptyDescription = computed(() => {
  if (runtimeFilter.value !== "all") {
    return `未发现运行中的 ${runtimeLabel(runtimeFilter.value)} 应用`;
  }
  if (keyword.value.trim()) return "无匹配应用";
  return "未发现本机开发语言相关应用";
});

/* ---------- 展开状态：Set 语义，刷新时合并 ---------- */
const expandedKeys = ref<string[]>([]);
const expandReady = ref(false);

function collectExpandableIds(rows: TreeRow[]): string[] {
  const ids: string[] = [];
  const walk = (r: TreeRow) => {
    if (r.children && r.children.length) {
      ids.push(r.id);
      for (const c of r.children) walk(c);
    }
  };
  for (const r of rows) walk(r);
  return ids;
}

watch(
  treeRows,
  (rows) => {
    const valid = new Set(collectExpandableIds(rows));
    if (!expandReady.value) {
      // 默认全部收起，只显示应用行
      expandedKeys.value = [];
      expandReady.value = true;
      return;
    }
    const next: string[] = [];
    for (const k of expandedKeys.value) {
      if (valid.has(k)) next.push(k);
    }
    expandedKeys.value = next;
  },
  { immediate: true }
);

watch(runtimeFilter, () => {
  // 切换运行时过滤后重新默认收起
  expandReady.value = false;
});

function onExpandChange(row: TreeRow, expanded: boolean | TreeRow[]) {
  let isExpanded = false;
  if (typeof expanded === "boolean") {
    isExpanded = expanded;
  } else {
    isExpanded = expanded.some((r) => r.id === row.id);
  }
  const set = new Set(expandedKeys.value);
  if (isExpanded) {
    set.add(row.id);
  } else {
    set.delete(row.id);
  }
  expandedKeys.value = [...set];
}

/* ---------- 展示辅助 ---------- */
function fmtCpu(n: number) {
  return Number(n || 0).toFixed(1);
}

function cpuClass(cpu: number) {
  if (cpu > 80) return "danger";
  if (cpu > 30) return "warn";
  return "";
}

function formatRate(bps: number) {
  return `${formatBytes(bps || 0)}/s`;
}

/** 模板行类型在 el-table 里是 DefaultRow，这里放宽入参 */
function formatIoPair(row: TreeRow | Record<string, unknown>, kind: "disk" | "net") {
  const r = row as TreeRow;
  if (!r.rateKnown) return "—";
  const a = kind === "disk" ? r.diskReadRate || 0 : r.netInRate || 0;
  const b = kind === "disk" ? r.diskWriteRate || 0 : r.netOutRate || 0;
  if (a <= 0 && b <= 0) return "—";
  const left = a > 0 ? formatRate(a) : "—";
  const right = b > 0 ? formatRate(b) : "—";
  return `${left} / ${right}`;
}

function formatPorts(row: TreeRow | Record<string, unknown>) {
  const r = row as TreeRow;
  if (!r.ports || r.ports.length === 0) return "—";
  return r.ports.join("、");
}

/* ---------- 单击高亮 / 双击展开 / 右键菜单 / 详情卡 ---------- */
const selectedId = ref<string | null>(null);
const selectedRow = ref<TreeRow | null>(null);
const ctxMenu = ref<LocalAppCtxMenuState | null>(null);
const detailCard = ref<{
  node: LocalCardNode | null;
  x: number;
  y: number;
}>({ node: null, x: 0, y: 0 });

const CARD_W = 560;
const CARD_EST_H = 420;

function findRowById(rows: TreeRow[], id: string): TreeRow | null {
  for (const r of rows) {
    if (r.id === id) return r;
    if (r.children) {
      const hit = findRowById(r.children, id);
      if (hit) return hit;
    }
  }
  return null;
}

function killTargetsOf(row: TreeRow | null): LocalKillTarget[] {
  if (!row) return [];
  if (row.kind === "proc") {
    if (!row.card.pid || row.card.extra?.self === "1") return [];
    return [{ pid: row.card.pid, name: row.name, cmd: row.cmd }];
  }
  return row.card.killTargets || [];
}

const canKillSelected = computed(() => killTargetsOf(selectedRow.value).length > 0);

const killButtonLabel = computed(() => {
  const row = selectedRow.value;
  if (row?.kind === "app") return "结束应用";
  return "结束进程";
});

watch(
  treeRows,
  (rows) => {
    const id = selectedId.value;
    if (!id) {
      selectedRow.value = null;
      return;
    }
    const hit = findRowById(rows, id);
    selectedRow.value = hit;
    if (!hit) selectedId.value = null;
  }
);

function placeDetailCard(clientX: number, clientY: number) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let x = clientX + 12;
  let y = clientY + 12;
  if (x + CARD_W > vw - 8) x = Math.max(8, clientX - CARD_W - 12);
  if (y + CARD_EST_H > vh - 8) y = Math.max(8, vh - CARD_EST_H - 8);
  if (x < 8) x = 8;
  if (y < 8) y = 8;
  return { x, y };
}

function onOpenDetail(payload: { node: LocalCardNode; x: number; y: number }) {
  const pos = placeDetailCard(payload.x, payload.y);
  detailCard.value = { node: payload.node, x: pos.x, y: pos.y };
}

function closeDetail() {
  detailCard.value = { node: null, x: 0, y: 0 };
}

watch(
  treeRows,
  (rows) => {
    const n = detailCard.value.node;
    if (!n) return;
    const hit = findRowById(rows, n.id);
    if (!hit) {
      closeDetail();
      return;
    }
    detailCard.value = {
      ...detailCard.value,
      node: hit.card,
    };
  }
);

function isActionEvent(e: MouseEvent) {
  const t = e.target as HTMLElement | null;
  if (!t) return false;
  return !!t.closest(
    ".el-button, .el-checkbox, .el-table__expand-icon, .host-ctx-menu, .local-app-detail-card"
  );
}

/** 单击只高亮，延迟执行以免干扰双击展开 */
let clickTimer: number | undefined;

function selectRow(r: TreeRow) {
  selectedId.value = r.id;
  selectedRow.value = r;
}

function onRowClick(
  row: TreeRow | Record<string, unknown>,
  _column: unknown,
  event: MouseEvent
) {
  if (isActionEvent(event)) return;
  const r = row as TreeRow;
  clearTimeout(clickTimer);
  clickTimer = window.setTimeout(() => {
    selectRow(r);
  }, 220);
}

/** 双击有子节点的行（应用）：展开或收起 */
function onRowDblClick(
  row: TreeRow | Record<string, unknown>,
  _column: unknown,
  event: MouseEvent
) {
  if (isActionEvent(event)) return;
  clearTimeout(clickTimer);
  const r = row as TreeRow;
  selectRow(r);
  if (!r.children || r.children.length === 0) return;
  const set = new Set(expandedKeys.value);
  if (set.has(r.id)) {
    set.delete(r.id);
  } else {
    set.add(r.id);
  }
  expandedKeys.value = [...set];
}

function onRowContextMenu(
  row: TreeRow | Record<string, unknown>,
  _column: unknown,
  event: MouseEvent
) {
  event.preventDefault();
  event.stopPropagation();
  clearTimeout(clickTimer);
  const r = row as TreeRow;
  selectRow(r);

  const pad = 8;
  let x = event.clientX;
  let y = event.clientY;
  const approxW = 200;
  const approxH = 200;
  if (x + approxW > window.innerWidth - pad) {
    x = window.innerWidth - approxW - pad;
  }
  if (y + approxH > window.innerHeight - pad) {
    y = window.innerHeight - approxH - pad;
  }
  if (x < pad) x = pad;
  if (y < pad) y = pad;

  ctxMenu.value = { x, y, node: r.card };
}

function onEsc(e: KeyboardEvent) {
  if (e.key !== "Escape") return;
  if (ctxMenu.value) {
    ctxMenu.value = null;
    return;
  }
  if (detailCard.value.node) closeDetail();
}

onMounted(() => {
  window.addEventListener("keydown", onEsc);
});
onBeforeUnmount(() => {
  window.removeEventListener("keydown", onEsc);
  clearTimeout(clickTimer);
});

async function killSelected() {
  const row = selectedRow.value;
  const targets = killTargetsOf(row);
  if (!row || !targets.length) {
    ElMessage.warning("请先选中要结束的应用或进程");
    return;
  }
  let title = "结束进程";
  let summary: string | undefined;
  if (row.kind === "app") {
    title = "结束应用";
    summary = `确定要结束应用「${row.name}」下的 ${targets.length} 个进程吗？`;
  }
  const ok = await confirmAndKillLocalProcs(targets, { title, summary });
  if (ok) await onKilled();
}

async function onKilled() {
  ctxMenu.value = null;
  closeDetail();
  await refresh();
}
</script>

<style scoped lang="scss">
.toolbar-meta {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.local-warn {
  margin-bottom: 8px;
  flex-shrink: 0;
}
.mono {
  font-variant-numeric: tabular-nums;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12px;
}
.dim {
  color: var(--el-text-color-placeholder);
}
.warn {
  color: var(--el-color-warning);
  font-weight: 600;
}
.danger {
  color: var(--el-color-danger);
  font-weight: 600;
}
.name-cell {
  font-weight: 500;
}
.local-apps-table {
  width: 100%;

  :deep(.el-table__header .cell) {
    overflow: visible;
    text-overflow: clip;
  }

  :deep(.tree-expand-col .cell) {
    padding: 0;
    display: flex;
    align-items: center;
    justify-content: center;
  }
}
.table-wrap {
  flex: 1;
  min-width: 0;
  width: 100%;
  min-height: 0;
  overflow: auto;
}
</style>

<style>
.local-kill-box .el-checkbox {
  margin-top: 4px;
}
</style>
