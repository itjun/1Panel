<template>
  <div class="group-overview">
    <template v-if="hosts.length">
      <div class="summary-bar">
        <div class="summary-left">
          <span class="meta">共 {{ hosts.length }} 台 · 已打开 {{ openedCount }}</span>
          <el-tag size="small" type="success" effect="dark">
            正常 {{ okCount }}
          </el-tag>
          <el-tag
            v-if="alertCount > 0"
            size="small"
            type="danger"
            effect="dark"
          >
            告警 {{ alertCount }}
          </el-tag>
          <el-tag
            v-if="errCount > 0"
            size="small"
            type="danger"
            effect="dark"
          >
            失败 {{ errCount }}
          </el-tag>
        </div>
        <div class="summary-right">
          <span class="dblclick-hint">双击主机打开</span>
          <el-button
            link
            type="primary"
            :icon="Refresh"
            :loading="refreshing"
            @click="refreshAll"
          >
            刷新
          </el-button>
        </div>
      </div>

      <div class="host-list-wrap panel-hover-card">
        <el-table
          :data="hosts"
          size="default"
          stripe
          class="host-list-table"
          :row-class-name="tableRowClass"
          @row-dblclick="(row: sshconfig.HostConfig) => openHost(row.name)"
        >
          <el-table-column label="状态" width="78" fixed>
            <template #default="{ row }">
              <el-tag
                size="small"
                :type="statusTagType(row.name)"
                effect="light"
                round
              >
                {{ statusLabel(row.name) }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column
            label="主机"
            min-width="150"
            fixed
            show-overflow-tooltip
          >
            <template #default="{ row }">
              <div class="list-host-name">
                <span class="list-os-ico">
                  <el-icon
                    v-if="hostState(row.name).error"
                    :size="18"
                    color="#f56c6c"
                    :title="withErrTime(hostState(row.name).error!, hostState(row.name).errorAt)"
                  >
                    <WarningFilled />
                  </el-icon>
                  <DistroLogo
                    v-else
                    :os-release="hostState(row.name).overview?.osRelease || ''"
                    :size="20"
                  />
                </span>
                <span>{{ row.name }}</span>
              </div>
            </template>
          </el-table-column>
          <el-table-column label="地址" min-width="130" show-overflow-tooltip>
            <template #default="{ row }">
              <span class="mono">{{ row.hostName || "—" }}</span>
            </template>
          </el-table-column>
          <el-table-column label="Agent" width="110">
            <template #default="{ row }">
              <el-tag size="small" :type="agentTagOf(row.name).type as any" effect="plain">
                {{ agentTagOf(row.name).text }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="用户" width="88" show-overflow-tooltip>
            <template #default="{ row }">
              {{ row.user || "—" }}
            </template>
          </el-table-column>
          <el-table-column label="系统" min-width="120" show-overflow-tooltip>
            <template #default="{ row }">
              <template v-if="hostState(row.name).error">—</template>
              <div v-else class="list-os-cell">
                <DistroLogo
                  :os-release="hostState(row.name).overview?.osRelease || ''"
                  :size="16"
                />
                <span>{{
                  shortOs(hostState(row.name).overview?.osRelease || "") || "Linux"
                }}</span>
              </div>
            </template>
          </el-table-column>
          <el-table-column label="CPU 核" width="78" align="right">
            <template #default="{ row }">
              <MetricCell
                :snap="hostState(row.name)"
                field="cpuCount"
                :fallback="0"
              />
            </template>
          </el-table-column>
          <el-table-column label="内存总量" width="100" align="right">
            <template #default="{ row }">
              <MetricCell
                :snap="hostState(row.name)"
                field="memTotal"
                :format="formatBytes"
              />
            </template>
          </el-table-column>
          <el-table-column label="CPU" min-width="150">
            <template #default="{ row }">
              <MetricCell
                :snap="hostState(row.name)"
                field="cpuPercent"
                :percent="true"
                :alert-threshold="THRESHOLDS.cpu"
                suffix="%"
              />
            </template>
          </el-table-column>
          <el-table-column label="内存" min-width="170">
            <template #default="{ row }">
              <MetricCell
                :snap="hostState(row.name)"
                field="memPercent"
                :percent="true"
                :alert-threshold="THRESHOLDS.mem"
                :alert-op="'gt'"
                suffix="%"
                :sub="memUsage(hostState(row.name).overview)"
              />
            </template>
          </el-table-column>
          <el-table-column label="磁盘 /" min-width="170">
            <template #default="{ row }">
              <MetricCell
                :snap="hostState(row.name)"
                field="diskPercent"
                :percent="true"
                :disks="hostState(row.name).disks"
                suffix="%"
                :sub="diskUsage(hostState(row.name).disks) || '—'"
              />
            </template>
          </el-table-column>
          <el-table-column label="负载" min-width="120" align="right">
            <template #default="{ row }">
              <el-skeleton
                v-if="hostState(row.name).loading && !hostState(row.name).overview"
                :rows="1"
                animated
                style="width: 80%"
              >
                <template #template><el-skeleton-item variant="text" style="width: 100%" /></template>
              </el-skeleton>
              <template v-else-if="!hostState(row.name).overview">—</template>
              <span
                v-else
                class="load-cell"
                :class="{ 'is-alert': isLoadAlert(hostState(row.name).overview!) }"
              >
                <span class="mono">{{ (hostState(row.name).overview!.load1 || 0).toFixed(2) }}</span>
                <span class="load-sep">/</span>
                <span class="load-cores">{{ hostState(row.name).overview!.cpuCount || 0 }}</span>
              </span>
            </template>
          </el-table-column>
        </el-table>
      </div>
    </template>

    <el-empty v-else description="该分组暂无主机，可将侧栏主机拖入分组" />
  </div>
</template>

<script setup lang="ts">
import {
  computed,
  defineComponent,
  h,
  onBeforeUnmount,
  ref,
  watch,
} from "vue";
import { Refresh, WarningFilled } from "@element-plus/icons-vue";
import { ElNotification, ElProgress, ElSkeleton, ElSkeletonItem } from "element-plus";
import DistroLogo from "@/components/DistroLogo.vue";
import { api } from "@/api";
import { useAppStore, UNGROUPED_ID } from "@/stores/app";
import { useAgentInstallStore } from "@/stores/agentInstall";
import { formatBytes, formatErr, isAgentMissing } from "@/utils/format";
import {
  ALERT,
  diskLowMessage,
  isCpuAlert,
  isDiskLow,
  isLoadAlert,
  isMemAlert,
  pickRootDisk,
} from "@/utils/alerts";
import type { agentcli, monitor, sshconfig } from "@/api";

const props = defineProps<{
  groupId: string;
  groupName: string;
}>();

const app = useAppStore();
const agentInstall = useAgentInstallStore();

const THRESHOLDS = ALERT;
const POLL_MS = 2000;

/** 单主机面板状态：标题/地址来自 store（同步），指标通过 per-host 异步加载 */
interface HostSnap {
  loading: boolean;
  overview?: monitor.Overview;
  disks?: monitor.DiskInfo[];
  error?: string;
  /** 错误发生时刻（展示新鲜度用；成功刷新时随 error 一并清除） */
  errorAt?: number;
}

/** 错误时间后缀（HH:MM），无时间返回空串 */
function errTimeSuffix(at?: number): string {
  if (!at) {
    return "";
  }
  const t = new Date(at);
  const hh = String(t.getHours()).padStart(2, "0");
  const mm = String(t.getMinutes()).padStart(2, "0");
  return `（${hh}:${mm}）`;
}

/** 错误文案补发生时间，便于区分「刚失败」与「陈旧错误」 */
function withErrTime(err: string, at?: number): string {
  return at ? err + errTimeSuffix(at) : err;
}

const refreshing = ref(false);

/** 当前组内主机列表（来自 store 的 groups.json + hosts.json：同步可用，立即渲染） */
const hosts = computed<sshconfig.HostConfig[]>(() => {
  const node = app.groupNodes.find(
    (n) => (n.group?.id ?? UNGROUPED_ID) === props.groupId
  );
  return node?.hosts ?? [];
});

/** 组内已打开（后台保持会话）的主机数 */
const openedCount = computed(
  () => hosts.value.filter((h) => app.isRunning(h.name)).length
);

/** 每主机独立的指标状态：key=host.name */
const hostStates = ref<Record<string, HostSnap>>({});

/** 当前活跃组 id，防止旧组请求覆盖新组 */
let activeGroupId = props.groupId;
const inFlight = new Set<string>();
let prevAlertKeys = new Set<string>();
let pollTimer: ReturnType<typeof setInterval> | null = null;

function hostState(name: string): HostSnap {
  let s = hostStates.value[name];
  if (!s) {
    s = { loading: true };
    hostStates.value[name] = s;
  }
  return s;
}

function openHost(name: string) {
  app.openHostTab(name);
}

// ---------- 指标 / 告警 ----------

function diskPercent(disks?: monitor.DiskInfo[]): number {
  return pickRootDisk(disks)?.percent ?? 0;
}

function memUsage(ov: monitor.Overview | undefined): string {
  if (!ov) return "—";
  return `${formatBytes(ov.memUsed || 0)} / ${formatBytes(ov.memTotal || 0)}`;
}

function diskUsage(disks?: monitor.DiskInfo[]): string | undefined {
  const d = pickRootDisk(disks);
  if (!d) return undefined;
  return `${formatBytes(d.used || 0)} / ${formatBytes(d.total || 0)}`;
}

function isHostAlert(s: HostSnap): boolean {
  if (s.error || !s.overview) return false;
  const ov = s.overview;
  if (isCpuAlert(ov) || isMemAlert(ov) || isLoadAlert(ov)) return true;
  if (isDiskLow(s.disks)) return true;
  return false;
}

const okCount = computed(
  () => hosts.value.filter((h) => {
    const s = hostState(h.name);
    return !!s.overview && !s.error && !isHostAlert(s);
  }).length
);
const alertCount = computed(
  () => hosts.value.filter((h) => {
    const s = hostState(h.name);
    return !s.error && isHostAlert(s);
  }).length
);
const errCount = computed(
  () =>
    hosts.value.filter((h) => {
      const e = hostState(h.name).error;
      return !!e && !isAgentMissing(e);
    }).length
);

// ---------- 单主机加载（独立，互不阻塞）----------

async function loadOne(name: string, showSkeleton: boolean) {
  if (inFlight.has(name)) return;
  if (activeGroupId !== props.groupId) return;
  const prev = hostStates.value[name];
  if (prev?.error && isAgentMissing(prev.error)) return;
  inFlight.add(name);
  if (showSkeleton) {
    hostStates.value[name] = { loading: true };
  }
  try {
    const [ov, disks] = await Promise.all([
      api.collectOverview(name),
      api.collectDisks(name),
    ]);
    if (activeGroupId !== props.groupId) return;
    hostStates.value[name] = { loading: false, overview: ov, disks: disks ?? [], error: undefined };
    notifyAllAlerts();
  } catch (e) {
    if (activeGroupId !== props.groupId) return;
    hostStates.value[name] = {
      loading: false,
      error: formatErr(e),
      errorAt: Date.now(),
    };
  } finally {
    inFlight.delete(name);
  }
}

/** 手动刷新（按钮）：静默重载（按钮自身有 loading 转圈）。
 *  不走骨架路径：骨架会先抹掉已有数据，逐台恢复期间告警键反复进出
 *  去重集合，导致仍存在的告警被当新告警重复弹窗 */
async function refreshAll() {
  refreshing.value = true;
  try {
    await Promise.allSettled(hosts.value.map((h) => loadOne(h.name, false)));
  } finally {
    refreshing.value = false;
  }
}

// ---------- 告警通知 ----------

function collectHostAlerts(name: string): { key: string; line: string }[] {
  const s = hostStates.value[name];
  if (!s) return [];
  if (s.error) {
    if (isAgentMissing(s.error)) return [];
    return [
      {
        key: `${name}|conn`,
        line: `「${name}」连接失败${errTimeSuffix(s.errorAt)}：${s.error}`,
      },
    ];
  }
  const ov = s.overview;
  if (!ov) return [];
  const out: { key: string; line: string }[] = [];
  const cpu = ov.cpuPercent || 0;
  if (cpu >= THRESHOLDS.cpu) {
    out.push({ key: `${name}|cpu`, line: `「${name}」CPU ${cpu.toFixed(1)}% ≥ ${THRESHOLDS.cpu}%` });
  }
  const mem = ov.memPercent || 0;
  if (mem > THRESHOLDS.mem) {
    out.push({ key: `${name}|mem`, line: `「${name}」内存 ${mem.toFixed(1)}% 超过 ${THRESHOLDS.mem}%` });
  }
  if (isDiskLow(s.disks)) {
    out.push({ key: `${name}|disk`, line: diskLowMessage(name, s.disks) });
  }
  if (isLoadAlert(ov)) {
    out.push({
      key: `${name}|load`,
      line: `「${name}」负载 ${ov.load1.toFixed(2)} / ${ov.cpuCount} 核 超过警戒`,
    });
  }
  return out;
}

function notifyAllAlerts() {
  const next = new Set<string>();
  const newLines: string[] = [];
  for (const h of hosts.value) {
    for (const a of collectHostAlerts(h.name)) {
      next.add(a.key);
      if (!prevAlertKeys.has(a.key)) newLines.push(a.line);
    }
  }
  prevAlertKeys = next;
  if (newLines.length === 0) return;
  const title = newLines.length === 1 ? "主机告警" : `主机告警（${newLines.length} 项）`;
  const body = newLines.length <= 6
    ? newLines.join("\n")
    : `${newLines.slice(0, 6).join("\n")}\n…另有 ${newLines.length - 6} 项`;
  ElNotification({
    type: "error",
    title,
    message: body,
    duration: 10000,
    position: "top-right",
    showClose: true,
    zIndex: 50000,
    customClass: "group-alert-notify",
  });
}

function statusLabel(name: string): string {
  const s = hostState(name);
  if (s.error) return isAgentMissing(s.error) ? "未装" : "失败";
  if (!s.overview) return "—";
  if (isHostAlert(s)) return "告警";
  return "正常";
}

function statusTagType(name: string): "success" | "danger" {
  const s = hostState(name);
  if (!s.overview || s.error || isHostAlert(s)) return "danger";
  return "success";
}

function tableRowClass({ row }: { row: sshconfig.HostConfig }) {
  const s = hostState(row.name);
  if (s.error || isHostAlert(s)) return "host-list-row is-danger-row";
  return "host-list-row";
}

function shortOs(osRelease: string): string {
  const s = (osRelease || "").trim();
  if (!s) return "";
  const m = s.match(/^([A-Za-z]+)/);
  return m ? m[1] : s.slice(0, 16);
}

// ---------- 轮询 ----------

function startPoll() {
  stopPoll();
  pollTimer = setInterval(() => {
    if (activeGroupId !== props.groupId) return;
    // 静默轮询：不切 loading（避免列表跳动）
    for (const h of hosts.value) {
      void loadOne(h.name, false);
    }
  }, POLL_MS);
}

function stopPoll() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

// ---------- 切换组 / 卸载 ----------

// ---------- Agent 状态 ----------
/** 每主机 agent 状态（后端 30s 缓存，徽章列显示） */
const agentStatuses = ref<Record<string, agentcli.Status>>({});
const latestAgentVersion = ref("");

async function loadAgentStatuses() {
  const names = hosts.value.map((h) => h.name);
  await Promise.all(
    names.map(async (n) => {
      try {
        agentStatuses.value[n] = await api.agentStatus(n);
      } catch {
        /* 徽章显示离线即可 */
      }
    })
  );
  if (!latestAgentVersion.value) {
    try {
      latestAgentVersion.value = await api.agentLatestVersion();
    } catch {
      /* 忽略 */
    }
  }
}

function agentTagOf(name: string): { type: string; text: string } {
  const st = agentStatuses.value[name];
  if (!st?.ok) return { type: "info", text: "未装/离线" };
  if (latestAgentVersion.value && st.version !== latestAgentVersion.value) {
    return { type: "warning", text: `v${st.version} 可更新` };
  }
  return { type: "success", text: `v${st.version}` };
}

watch(
  hosts,
  (h) => {
    activeGroupId = props.groupId;
    const fresh: Record<string, HostSnap> = {};
    for (const host of h) {
      const existing = hostStates.value[host.name];
      fresh[host.name] = existing ?? { loading: true };
    }
    hostStates.value = fresh;
    // 注意：不重置 prevAlertKeys（store 刷新频繁触发本 watch，
    // 清空会导致仍存在的告警被当新告警重复弹窗）；仅切组时重置。
    // 已有数据的主机静默刷新，避免 Cmd+R 时全组闪骨架
    for (const host of h) {
      void loadOne(host.name, !fresh[host.name].overview);
    }
    void loadAgentStatuses();
  },
  { immediate: true }
);

watch(
  () => props.groupId,
  () => {
    activeGroupId = props.groupId;
    hostStates.value = {};
    prevAlertKeys = new Set();
    stopPoll();
    startPoll();
  }
);

watch(
  () => agentInstall.lastInstalled,
  (info) => {
    if (info && hosts.value.some((h) => h.name === info.host)) {
      const cur = hostStates.value[info.host];
      if (cur) hostStates.value[info.host] = { ...cur, error: undefined, errorAt: undefined };
      void loadOne(info.host, false);
      void loadAgentStatuses();
    }
  }
);

onBeforeUnmount(() => {
  stopPoll();
  activeGroupId = ""; // 取消所有 in-flight
});

// ---------- 子组件：单元格（骨架 + 数值）----------

const MetricCell = defineComponent({
  name: "MetricCell",
  props: {
    snap: { type: Object as () => HostSnap, required: true },
    field: { type: String, required: true },
    fallback: { type: [String, Number], default: "—" },
    format: { type: Function, default: (v: any) => v },
    percent: { type: Boolean, default: false },
    disks: { type: Array as () => monitor.DiskInfo[] | undefined, default: undefined },
    "alert-threshold": { type: Number, default: 0 },
    "alert-op": { type: String, default: "ge" }, // "ge" or "gt"
    suffix: { type: String, default: "" },
    sub: { type: String, default: "" },
  },
  setup(p) {
    return () => {
      const s = p.snap;
      const loading = s.loading && !s.overview;
      const err = !!s.error || !s.overview;
      if (loading) {
        return h(ElSkeleton, { rows: 1, animated: true, style: { width: "100%" } }, {
          template: () => h(ElSkeletonItem, { variant: "text", style: { width: "100%" } }),
        });
      }
      if (err) return h("span", null, "—");
      const ov = s.overview!;
      let value: any;
      let display: any;
      let alert = false;
      if (p.field === "diskPercent") {
        const d = pickRootDisk(p.disks)?.percent ?? 0;
        value = d;
        display = `${d.toFixed(1)}%`;
        alert = isDiskLow(p.disks);
      } else {
        const raw = (ov as any)[p.field] ?? 0;
        if (p.percent) {
          value = raw;
          display = `${raw.toFixed(1)}${p.suffix}`;
          alert = p["alert-op"] === "gt" ? raw > p["alert-threshold"] : raw >= p["alert-threshold"];
        } else {
          display = p.format(raw);
        }
      }
      if (p.percent) {
        return h("div", { class: "list-metric" }, [
          h("div", { class: "list-metric-bar" }, h(ElProgress, {
            percentage: Math.min(100, Math.max(0, value || 0)),
            strokeWidth: 8,
            showText: false,
            color: alert ? "var(--el-color-danger)" : "var(--el-color-primary)",
          })),
          h("div", { class: "list-metric-nums" }, [
            h("span", { class: ["list-metric-val", alert ? "is-alert" : ""] }, display),
            p.sub
              ? h("span", { class: ["list-metric-sub", alert ? "is-alert" : ""] }, p.sub)
              : null,
          ]),
        ]);
      }
      return h("span", null, display);
    };
  },
});

startPoll();
</script>

<style scoped lang="scss">
.group-overview {
  min-height: 200px;
  box-sizing: border-box;
}
.summary-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 14px;
  flex-wrap: wrap;
}
.summary-left,
.summary-right {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.meta {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.dblclick-hint {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.host-list-wrap {
  background: var(--el-bg-color, #fff);
  border-radius: 4px;
  overflow: hidden;
}
.host-list-table {
  width: 100%;
  :deep(.el-table__header th) {
    font-weight: 600;
    background: var(--el-fill-color-lighter, #fafafa);
  }
  :deep(.host-list-row) {
    cursor: pointer;
  }
  :deep(.host-list-row.is-danger-row > td.el-table__cell) {
    background: var(--el-color-danger-light-9, #fef0f0) !important;
  }
  :deep(.host-list-row.is-danger-row .list-host-name) {
    color: var(--el-color-danger);
  }
  :deep(.el-table__row:hover > td.el-table__cell) {
    background: var(--el-color-primary-light-9, #ecf5ff) !important;
  }
  :deep(.host-list-row.is-danger-row:hover > td.el-table__cell) {
    background: var(--el-color-danger-light-8, #fde2e2) !important;
  }
  :deep(.el-table__cell) {
    padding: 10px 0;
  }
}
.list-host-name {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
}
.list-os-ico {
  display: inline-flex;
  width: 22px;
  height: 22px;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.list-os-cell {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-variant-numeric: tabular-nums;
  font-size: 13px;
}
.list-err {
  font-size: 12px;
  color: var(--el-color-danger);
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
:deep(.list-metric) {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding-right: 8px;
}
:deep(.list-metric-nums) {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  font-variant-numeric: tabular-nums;
}
:deep(.list-metric-val) {
  font-size: 13px;
  font-weight: 600;
  &.is-alert {
    color: var(--el-color-danger) !important;
    font-weight: 700;
  }
}
:deep(.list-metric-sub) {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  white-space: nowrap;
  &.is-alert {
    color: var(--el-color-danger);
  }
}

html.dark .host-list-wrap {
  background: var(--panel-main-bg-color-9, #2e313d);
}
</style>

<style>
.group-alert-notify {
  white-space: pre-line !important;
  max-width: 420px;
  border-left: 4px solid var(--el-color-danger) !important;
}
.group-alert-notify .el-notification__title {
  color: var(--el-color-danger);
  font-weight: 700;
}
.group-alert-notify .el-notification__content {
  white-space: pre-line;
  line-height: 1.55;
  font-size: 13px;
}
</style>
