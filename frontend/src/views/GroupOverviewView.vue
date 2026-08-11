<template>
  <div v-loading="loading && !group" class="group-overview">
    <el-alert
      v-if="error && !group"
      type="error"
      :title="error"
      show-icon
      class="mb"
    />

    <template v-if="group">
      <!-- 摘要条 + 视图切换 -->
      <div class="summary-bar">
        <div class="summary-left">
          <span class="panel-section-title">主机监控</span>
          <span class="meta">共 {{ hosts.length }} 台</span>
          <el-tag size="small" type="success" effect="plain">
            正常 {{ okCount }}
          </el-tag>
          <el-tag
            v-if="alertCount > 0"
            size="small"
            type="warning"
            effect="plain"
          >
            告警 {{ alertCount }}
          </el-tag>
          <el-tag
            v-if="errCount > 0"
            size="small"
            type="danger"
            effect="plain"
          >
            失败 {{ errCount }}
          </el-tag>
        </div>
        <div class="summary-right">
          <el-radio-group
            v-model="viewMode"
            size="small"
            class="view-switch"
            @change="persistViewMode"
          >
            <el-radio-button value="card">
              <span class="view-opt">
                <el-icon><Grid /></el-icon>
                卡片
              </span>
            </el-radio-button>
            <el-radio-button value="list">
              <span class="view-opt">
                <el-icon><List /></el-icon>
                列表
              </span>
            </el-radio-button>
          </el-radio-group>
          <el-button
            link
            type="primary"
            :icon="Refresh"
            :loading="loading"
            @click="load"
          >
            刷新
          </el-button>
        </div>
      </div>

      <el-empty
        v-if="hosts.length === 0"
        description="该分组暂无主机，可将侧栏主机拖入分组"
      />

      <!-- ========== 卡片视图 ========== -->
      <div v-else-if="viewMode === 'card'" class="host-grid">
        <div
          v-for="h in hosts"
          :key="h.name"
          class="host-card panel-hover-card"
          :class="{
            'is-error': !!h.error,
            'is-alert': !h.error && isHostAlert(h),
          }"
          @click="openHost(h.name)"
        >
          <span
            class="status-dot"
            :title="statusTitle(h)"
            :class="statusClass(h)"
          />

          <div class="card-top">
            <div class="avatar" :class="{ err: !!h.error }">
              <el-icon v-if="h.error" :size="22"><WarningFilled /></el-icon>
              <el-icon v-else :size="22"><Monitor /></el-icon>
            </div>
            <div class="id-block">
              <div class="host-name" :title="h.name">{{ h.name }}</div>
              <div class="host-sub" :title="subLine(h)">
                <template v-if="h.error">
                  <span class="err-text">{{ h.error }}</span>
                </template>
                <template v-else>
                  {{ h.user || "?" }}@{{ h.hostName || "?" }}
                </template>
              </div>
              <div v-if="!h.error && h.overview" class="host-meta">
                {{ h.overview.cpuCount || 0 }} 核 ·
                {{ formatBytes(h.overview.memTotal || 0) }}
                <template v-if="h.overview.osRelease">
                  · {{ shortOs(h.overview.osRelease) }}
                </template>
              </div>
            </div>
          </div>

          <div v-if="!h.error && h.overview" class="metrics">
            <MetricRow
              label="CPU"
              :percent="h.overview.cpuPercent || 0"
              :alert="(h.overview.cpuPercent || 0) > THRESHOLDS.cpu"
              :display="`${(h.overview.cpuPercent || 0).toFixed(1)}%`"
            />
            <MetricRow
              label="MEM"
              :percent="h.overview.memPercent || 0"
              :alert="(h.overview.memPercent || 0) > THRESHOLDS.mem"
              :display="`${(h.overview.memPercent || 0).toFixed(1)}%`"
              :sub="formatBytes(h.overview.memUsed || 0)"
            />
            <MetricRow
              label="DISK"
              :percent="diskPercent(h)"
              :alert="diskPercent(h) > THRESHOLDS.disk"
              :display="`${diskPercent(h).toFixed(1)}%`"
              :sub="diskUsed(h)"
            />
            <MetricRow
              label="LOAD"
              :percent="loadBar(h)"
              :alert="isLoadAlert(h)"
              :display="(h.overview.load1 || 0).toFixed(2)"
              :sub="`/ ${h.overview.cpuCount || 0}`"
            />
          </div>

          <div v-else-if="h.error" class="card-footer-hint">
            点击打开主机后可重试连接
          </div>
        </div>
      </div>

      <!-- ========== 列表视图（信息更清晰） ========== -->
      <div v-else class="host-list-wrap panel-hover-card">
        <el-table
          :data="hosts"
          size="default"
          stripe
          class="host-list-table"
          row-class-name="host-list-row"
          @row-click="(row: HostSnap) => openHost(row.name)"
        >
          <el-table-column label="状态" width="78" fixed>
            <template #default="{ row }">
              <el-tag
                size="small"
                :type="statusTagType(row)"
                effect="light"
                round
              >
                {{ statusLabel(row) }}
              </el-tag>
            </template>
          </el-table-column>

          <el-table-column label="主机" min-width="140" fixed show-overflow-tooltip>
            <template #default="{ row }">
              <div class="list-host-name">
                <el-icon class="list-host-ico"><Monitor /></el-icon>
                <span>{{ row.name }}</span>
              </div>
            </template>
          </el-table-column>

          <el-table-column label="地址" min-width="130" show-overflow-tooltip>
            <template #default="{ row }">
              <span class="mono">{{ row.hostName || "—" }}</span>
            </template>
          </el-table-column>

          <el-table-column label="用户" width="88" show-overflow-tooltip>
            <template #default="{ row }">
              {{ row.user || "—" }}
            </template>
          </el-table-column>

          <el-table-column label="系统" min-width="100" show-overflow-tooltip>
            <template #default="{ row }">
              <template v-if="row.error">—</template>
              <template v-else>
                {{ shortOs(row.overview?.osRelease || "") || "—" }}
              </template>
            </template>
          </el-table-column>

          <el-table-column label="CPU 核" width="78" align="right">
            <template #default="{ row }">
              <template v-if="row.error || !row.overview">—</template>
              <template v-else>{{ row.overview.cpuCount || 0 }}</template>
            </template>
          </el-table-column>

          <el-table-column label="内存总量" width="100" align="right">
            <template #default="{ row }">
              <template v-if="row.error || !row.overview">—</template>
              <template v-else>
                {{ formatBytes(row.overview.memTotal || 0) }}
              </template>
            </template>
          </el-table-column>

          <el-table-column label="CPU" min-width="150">
            <template #default="{ row }">
              <template v-if="row.error || !row.overview">
                <span class="err-text list-err" :title="row.error">{{
                  row.error || "—"
                }}</span>
              </template>
              <ListMetric
                v-else
                :percent="row.overview.cpuPercent || 0"
                :alert="(row.overview.cpuPercent || 0) > THRESHOLDS.cpu"
                :text="`${(row.overview.cpuPercent || 0).toFixed(1)}%`"
              />
            </template>
          </el-table-column>

          <el-table-column label="内存" min-width="170">
            <template #default="{ row }">
              <template v-if="row.error || !row.overview">—</template>
              <ListMetric
                v-else
                :percent="row.overview.memPercent || 0"
                :alert="(row.overview.memPercent || 0) > THRESHOLDS.mem"
                :text="`${(row.overview.memPercent || 0).toFixed(1)}%`"
                :sub="formatBytes(row.overview.memUsed || 0)"
              />
            </template>
          </el-table-column>

          <el-table-column label="磁盘 /" min-width="170">
            <template #default="{ row }">
              <template v-if="row.error">—</template>
              <ListMetric
                v-else
                :percent="diskPercent(row)"
                :alert="diskPercent(row) > THRESHOLDS.disk"
                :text="`${diskPercent(row).toFixed(1)}%`"
                :sub="diskUsed(row) || '—'"
              />
            </template>
          </el-table-column>

          <el-table-column label="负载" min-width="120" align="right">
            <template #default="{ row }">
              <template v-if="row.error || !row.overview">—</template>
              <span
                v-else
                class="load-cell"
                :class="{ 'is-alert': isLoadAlert(row) }"
              >
                <span class="mono">{{
                  (row.overview.load1 || 0).toFixed(2)
                }}</span>
                <span class="load-sep">/</span>
                <span class="load-cores">{{ row.overview.cpuCount || 0 }}</span>
              </span>
            </template>
          </el-table-column>

          <el-table-column label="操作" width="80" fixed="right" align="center">
            <template #default="{ row }">
              <el-button
                link
                type="primary"
                size="small"
                @click.stop="openHost(row.name)"
              >
                打开
              </el-button>
            </template>
          </el-table-column>
        </el-table>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import {
  computed,
  defineComponent,
  h,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from "vue";
import {
  Grid,
  List,
  Monitor,
  Refresh,
  WarningFilled,
} from "@element-plus/icons-vue";
import { ElProgress } from "element-plus";
import { api } from "@/api";
import { useAppStore } from "@/stores/app";
import { formatBytes } from "@/utils/format";
import type { monitor } from "@wailsjs/go/models";

const props = defineProps<{
  groupId: string;
  groupName: string;
}>();

const app = useAppStore();

const THRESHOLDS = {
  cpu: 80,
  mem: 85,
  disk: 90,
  loadRatio: 1.0,
};

const VIEW_KEY = "ipannel.groupViewMode";
type ViewMode = "card" | "list";

function loadViewMode(): ViewMode {
  try {
    const v = localStorage.getItem(VIEW_KEY);
    if (v === "list" || v === "card") return v;
  } catch {
    /* ignore */
  }
  return "card";
}

const viewMode = ref<ViewMode>(loadViewMode());

function persistViewMode() {
  try {
    localStorage.setItem(VIEW_KEY, viewMode.value);
  } catch {
    /* ignore */
  }
}

/** 与后端 HostOverviewSnapshot 对齐 */
interface HostSnap {
  name: string;
  hostName: string;
  user: string;
  overview: monitor.Overview;
  disks: monitor.DiskInfo[];
  error?: string;
}

interface GroupSnap {
  groupId: string;
  groupName: string;
  hosts: HostSnap[];
}

const group = ref<GroupSnap | null>(null);
const loading = ref(false);
const error = ref("");
let timer: ReturnType<typeof setInterval> | null = null;
let seq = 0;

const hosts = computed(() => group.value?.hosts || []);

const okCount = computed(
  () => hosts.value.filter((h) => !h.error && !isHostAlert(h)).length
);
const alertCount = computed(
  () => hosts.value.filter((h) => !h.error && isHostAlert(h)).length
);
const errCount = computed(() => hosts.value.filter((h) => !!h.error).length);

function diskPercent(h: HostSnap): number {
  return h.disks?.[0]?.percent ?? 0;
}

function diskUsed(h: HostSnap): string | undefined {
  const d = h.disks?.[0];
  if (!d) return undefined;
  return formatBytes(d.used || 0);
}

function loadBar(h: HostSnap): number {
  const n = h.overview?.cpuCount || 0;
  const load1 = h.overview?.load1 || 0;
  if (n <= 0) return 0;
  return Math.min(100, (load1 / n) * 50);
}

function isLoadAlert(h: HostSnap): boolean {
  const n = h.overview?.cpuCount || 0;
  const load1 = h.overview?.load1 || 0;
  return n > 0 && load1 / n > THRESHOLDS.loadRatio;
}

function isHostAlert(h: HostSnap): boolean {
  if (h.error) return false;
  const ov = h.overview;
  if (!ov) return false;
  if ((ov.cpuPercent || 0) > THRESHOLDS.cpu) return true;
  if ((ov.memPercent || 0) > THRESHOLDS.mem) return true;
  if (diskPercent(h) > THRESHOLDS.disk) return true;
  if (isLoadAlert(h)) return true;
  return false;
}

function statusLabel(h: HostSnap): string {
  if (h.error) return "失败";
  if (isHostAlert(h)) return "告警";
  return "正常";
}

function statusTagType(h: HostSnap): "success" | "warning" | "danger" {
  if (h.error) return "danger";
  if (isHostAlert(h)) return "warning";
  return "success";
}

function statusTitle(h: HostSnap): string {
  if (h.error) return "连接失败";
  if (isHostAlert(h)) return "存在告警";
  return "正常";
}

function statusClass(h: HostSnap) {
  return {
    err: !!h.error,
    alert: !h.error && isHostAlert(h),
    ok: !h.error && !isHostAlert(h),
  };
}

function shortOs(osRelease: string): string {
  const s = (osRelease || "").trim();
  if (!s) return "";
  const m = s.match(/^([A-Za-z]+)/);
  return m ? m[1] : s.slice(0, 16);
}

function subLine(h: HostSnap): string {
  if (h.error) return h.error;
  return `${h.user || "?"}@${h.hostName || "?"}`;
}

function openHost(name: string) {
  app.openHostTab(name);
}

function formatErr(e: unknown): string {
  if (e == null) return "未知错误";
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message || String(e);
  const any = e as { message?: string };
  if (any.message) return any.message;
  return String(e);
}

async function load() {
  if (!props.groupId) return;
  const my = ++seq;
  loading.value = true;
  try {
    const data = (await api.listOneGroupOverview(props.groupId)) as GroupSnap;
    if (my !== seq) return;
    group.value = {
      groupId: data.groupId,
      groupName: data.groupName,
      hosts: data.hosts || [],
    };
    error.value = "";
  } catch (e) {
    if (my !== seq) return;
    error.value = formatErr(e);
  } finally {
    if (my === seq) loading.value = false;
  }
}

function startPoll() {
  stopPoll();
  timer = setInterval(() => {
    void loadQuiet();
  }, 8000);
}

async function loadQuiet() {
  if (!props.groupId || document.hidden) return;
  const my = ++seq;
  try {
    const data = (await api.listOneGroupOverview(props.groupId)) as GroupSnap;
    if (my !== seq) return;
    group.value = {
      groupId: data.groupId,
      groupName: data.groupName,
      hosts: data.hosts || [],
    };
    error.value = "";
  } catch {
    /* 静默 */
  }
}

function stopPoll() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

// 卡片内进度行
const MetricRow = defineComponent({
  name: "MetricRow",
  props: {
    label: { type: String, required: true },
    percent: { type: Number, required: true },
    alert: { type: Boolean, default: false },
    display: { type: String, required: true },
    sub: { type: String, default: undefined },
  },
  setup(p) {
    return () =>
      h("div", { class: "metric-row" }, [
        h("span", { class: "m-label" }, p.label),
        h(
          "span",
          { class: "m-bar" },
          h(ElProgress, {
            percentage: Math.min(100, Math.max(0, p.percent || 0)),
            strokeWidth: 6,
            showText: false,
            color: p.alert
              ? "var(--el-color-danger)"
              : "var(--el-color-primary)",
          })
        ),
        h(
          "span",
          { class: ["m-val", p.alert ? "is-alert" : ""] },
          p.display
        ),
        p.sub
          ? h("span", { class: "m-sub" }, p.sub)
          : h("span", { class: "m-sub empty" }, ""),
      ]);
  },
});

// 列表内进度 + 数值（更宽、更清晰）
const ListMetric = defineComponent({
  name: "ListMetric",
  props: {
    percent: { type: Number, required: true },
    alert: { type: Boolean, default: false },
    text: { type: String, required: true },
    sub: { type: String, default: undefined },
  },
  setup(p) {
    return () =>
      h("div", { class: "list-metric" }, [
        h(
          "div",
          { class: "list-metric-bar" },
          h(ElProgress, {
            percentage: Math.min(100, Math.max(0, p.percent || 0)),
            strokeWidth: 8,
            showText: false,
            color: p.alert
              ? "var(--el-color-danger)"
              : "var(--el-color-primary)",
          })
        ),
        h("div", { class: "list-metric-nums" }, [
          h(
            "span",
            { class: ["list-metric-val", p.alert ? "is-alert" : ""] },
            p.text
          ),
          p.sub ? h("span", { class: "list-metric-sub" }, p.sub) : null,
        ]),
      ]);
  },
});

onMounted(() => {
  void load().then(startPoll);
});

onBeforeUnmount(() => {
  stopPoll();
  seq++;
});

watch(
  () => props.groupId,
  () => {
    group.value = null;
    error.value = "";
    void load().then(startPoll);
  }
);
</script>

<style scoped lang="scss">
.group-overview {
  min-height: 200px;
}
.mb {
  margin-bottom: 12px;
}
.summary-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 14px;
  flex-wrap: wrap;
}
.summary-left {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.summary-right {
  display: flex;
  align-items: center;
  gap: 10px;
}
.meta {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.view-opt {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.view-switch {
  :deep(.el-radio-button__inner) {
    padding: 6px 12px;
  }
}

/* ---------- 卡片 ---------- */
.host-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 12px;
}

.host-card {
  position: relative;
  padding: 14px 14px 12px;
  background: var(--el-bg-color, #fff);
  cursor: pointer;
  transition: transform 0.15s ease, box-shadow 0.15s ease;

  &:hover {
    transform: translateY(-1px);
  }

  &.is-error {
    border-color: var(--el-color-danger-light-5) !important;
  }
  &.is-alert {
    border-color: var(--el-color-warning-light-5) !important;
  }
}

.status-dot {
  position: absolute;
  top: 12px;
  right: 12px;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  &.ok {
    background: #67c23a;
    box-shadow: 0 0 0 2px rgba(103, 194, 58, 0.2);
  }
  &.alert {
    background: #e6a23c;
    box-shadow: 0 0 0 2px rgba(230, 162, 60, 0.2);
  }
  &.err {
    background: #f56c6c;
    box-shadow: 0 0 0 2px rgba(245, 108, 108, 0.2);
  }
}

.card-top {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  min-width: 0;
  padding-right: 14px;
}
.avatar {
  width: 44px;
  height: 44px;
  border-radius: 10px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--el-color-primary-light-9, #ecf5ff);
  color: var(--el-color-primary);
  &.err {
    background: var(--el-color-danger-light-9, #fef0f0);
    color: var(--el-color-danger);
  }
}
.id-block {
  min-width: 0;
  flex: 1;
}
.host-name {
  font-size: 14px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.host-sub {
  margin-top: 2px;
  font-size: 11px;
  color: var(--el-text-color-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.err-text {
  color: var(--el-color-danger);
}
.host-meta {
  margin-top: 2px;
  font-size: 11px;
  color: var(--el-text-color-placeholder, #a8abb2);
}

.metrics {
  margin-top: 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.card-footer-hint {
  margin-top: 12px;
  font-size: 11px;
  color: var(--el-text-color-placeholder);
}

/* ---------- 列表 ---------- */
.host-list-wrap {
  background: var(--el-bg-color, #fff);
  border-radius: 4px;
  overflow: hidden;
  padding: 0;
}

.host-list-table {
  width: 100%;

  :deep(.el-table__header th) {
    font-weight: 600;
    color: var(--el-text-color-regular);
    background: var(--el-fill-color-lighter, #fafafa);
  }

  :deep(.host-list-row) {
    cursor: pointer;
  }

  :deep(.el-table__row:hover > td.el-table__cell) {
    background: var(--el-color-primary-light-9, #ecf5ff) !important;
  }

  :deep(.el-table__cell) {
    padding: 10px 0;
  }
}

.list-host-name {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}
.list-host-ico {
  color: var(--el-color-primary);
  flex-shrink: 0;
}

.mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-variant-numeric: tabular-nums;
  font-size: 13px;
}

.list-err {
  font-size: 12px;
  display: inline-block;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.load-cell {
  font-variant-numeric: tabular-nums;
  &.is-alert {
    color: var(--el-color-danger);
    font-weight: 600;
  }
}
.load-sep {
  margin: 0 2px;
  color: var(--el-text-color-placeholder);
}
.load-cores {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

/* MetricRow（卡片） */
:deep(.metric-row) {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11px;
}
:deep(.m-label) {
  width: 34px;
  flex-shrink: 0;
  color: var(--el-text-color-secondary);
  font-variant-numeric: tabular-nums;
}
:deep(.m-bar) {
  flex: 1;
  min-width: 0;
  .el-progress__outer {
    background: var(--el-fill-color, #f0f2f5);
  }
}
:deep(.m-val) {
  width: 44px;
  text-align: right;
  font-variant-numeric: tabular-nums;
  flex-shrink: 0;
  &.is-alert {
    color: var(--el-color-danger);
    font-weight: 600;
  }
}
:deep(.m-sub) {
  width: 56px;
  text-align: right;
  font-size: 10px;
  color: var(--el-text-color-placeholder);
  font-variant-numeric: tabular-nums;
  flex-shrink: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  &.empty {
    visibility: hidden;
  }
}

/* ListMetric */
:deep(.list-metric) {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
  padding-right: 8px;
}
:deep(.list-metric-bar) {
  width: 100%;
  .el-progress__outer {
    background: var(--el-fill-color, #f0f2f5);
  }
}
:deep(.list-metric-nums) {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  font-variant-numeric: tabular-nums;
}
:deep(.list-metric-val) {
  font-size: 13px;
  font-weight: 600;
  &.is-alert {
    color: var(--el-color-danger);
  }
}
:deep(.list-metric-sub) {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

html.dark .host-card,
html.dark .host-list-wrap {
  background: var(--panel-main-bg-color-9, #2e313d);
}
html.dark .avatar:not(.err) {
  background: rgba(64, 158, 255, 0.12);
}
html.dark .host-list-table {
  :deep(.el-table__header th) {
    background: var(--panel-main-bg-color-8, #25272e);
  }
}
</style>
