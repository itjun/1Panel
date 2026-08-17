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
      <!-- ===== 日常模式工具栏 ===== -->
      <div class="summary-bar">
        <div class="summary-left">
          <span class="panel-section-title">主机监控</span>
          <span class="meta">共 {{ hosts.length }} 台</span>
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

      <!-- ===== 日常：卡片 ===== -->
      <div v-else-if="viewMode === 'card'" class="host-grid">
        <div
          v-for="h in hosts"
          :key="'c-' + h.name"
          class="host-card panel-hover-card"
          :class="cardClass(h)"
          @click="openHost(h.name)"
        >
          <HostCardBody :host="h" />
        </div>
      </div>

      <!-- ===== 日常：列表 ===== -->
      <div v-else class="host-list-wrap panel-hover-card">
        <el-table
          :data="hosts"
          size="default"
          stripe
          class="host-list-table"
          :row-class-name="tableRowClass"
          @row-dblclick="(row: HostSnap) => openHost(row.name)"
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
          <el-table-column
            label="主机"
            min-width="150"
            fixed
            show-overflow-tooltip
          >
            <template #default="{ row }">
              <div class="list-host-name">
                <span class="list-os-ico">
                  <el-icon v-if="row.error" :size="18" color="#f56c6c">
                    <WarningFilled />
                  </el-icon>
                  <DistroLogo
                    v-else
                    :os-release="row.overview?.osRelease || ''"
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
          <el-table-column label="用户" width="88" show-overflow-tooltip>
            <template #default="{ row }">
              {{ row.user || "—" }}
            </template>
          </el-table-column>
          <el-table-column label="系统" min-width="120" show-overflow-tooltip>
            <template #default="{ row }">
              <template v-if="row.error">—</template>
              <div v-else class="list-os-cell">
                <DistroLogo
                  :os-release="row.overview?.osRelease || ''"
                  :size="16"
                />
                <span>{{
                  shortOs(row.overview?.osRelease || "") || "Linux"
                }}</span>
              </div>
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
                :alert="(row.overview.cpuPercent || 0) >= THRESHOLDS.cpu"
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
                :sub="memUsage(row)"
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
                :sub="diskUsage(row) || '—'"
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
  Refresh,
  WarningFilled,
} from "@element-plus/icons-vue";
import { ElNotification, ElProgress } from "element-plus";
import DistroLogo from "@/components/DistroLogo.vue";
import { api } from "@/api";
import { useAppStore } from "@/stores/app";
import { formatBytes, formatErr } from "@/utils/format";
import type { monitor } from "@wailsjs/go/models";

const props = defineProps<{
  groupId: string;
  groupName: string;
}>();

const app = useAppStore();

const THRESHOLDS = {
  /** CPU ≥ 90% 才告警（原先 80% 过敏感） */
  cpu: 90,
  mem: 85,
  disk: 90,
  loadRatio: 1.0,
};
const POLL_MS = 5000;
const VIEW_KEY = "ipannel.groupViewMode";

type ViewMode = "card" | "list";

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
const group = ref<GroupSnap | null>(null);
const loading = ref(false);
const error = ref("");

let timer: ReturnType<typeof setInterval> | null = null;
let seq = 0;
let prevAlertKeys = new Set<string>();

const hosts = computed(() => group.value?.hosts || []);

const okCount = computed(
  () => hosts.value.filter((h) => !h.error && !isHostAlert(h)).length
);
const alertCount = computed(
  () => hosts.value.filter((h) => !h.error && isHostAlert(h)).length
);
const errCount = computed(() => hosts.value.filter((h) => !!h.error).length);

function persistViewMode() {
  try {
    localStorage.setItem(VIEW_KEY, viewMode.value);
  } catch {
    /* ignore */
  }
}

function openHost(name: string) {
  app.openHostTab(name);
}

// ---------- 指标 / 告警 ----------

function diskPercent(h: HostSnap): number {
  return h.disks?.[0]?.percent ?? 0;
}

/** 内存：已用 / 总量 */
function memUsage(h: HostSnap): string {
  const ov = h.overview;
  if (!ov) return "—";
  return `${formatBytes(ov.memUsed || 0)} / ${formatBytes(ov.memTotal || 0)}`;
}

/** 磁盘：已用 / 总量 */
function diskUsage(h: HostSnap): string | undefined {
  const d = h.disks?.[0];
  if (!d) return undefined;
  return `${formatBytes(d.used || 0)} / ${formatBytes(d.total || 0)}`;
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
  if ((ov.cpuPercent || 0) >= THRESHOLDS.cpu) return true;
  if ((ov.memPercent || 0) > THRESHOLDS.mem) return true;
  if (diskPercent(h) > THRESHOLDS.disk) return true;
  if (isLoadAlert(h)) return true;
  return false;
}

function collectHostAlerts(h: HostSnap): { key: string; line: string }[] {
  if (h.error) {
    return [
      {
        key: `${h.name}|conn`,
        line: `「${h.name}」连接失败：${h.error}`,
      },
    ];
  }
  const ov = h.overview;
  if (!ov) return [];
  const out: { key: string; line: string }[] = [];
  const cpu = ov.cpuPercent || 0;
  if (cpu >= THRESHOLDS.cpu) {
    out.push({
      key: `${h.name}|cpu`,
      line: `「${h.name}」CPU ${cpu.toFixed(1)}% ≥ ${THRESHOLDS.cpu}%`,
    });
  }
  const mem = ov.memPercent || 0;
  if (mem > THRESHOLDS.mem) {
    out.push({
      key: `${h.name}|mem`,
      line: `「${h.name}」内存 ${mem.toFixed(1)}% 超过 ${THRESHOLDS.mem}%`,
    });
  }
  const disk = diskPercent(h);
  if (disk > THRESHOLDS.disk) {
    out.push({
      key: `${h.name}|disk`,
      line: `「${h.name}」磁盘 ${disk.toFixed(1)}% 超过 ${THRESHOLDS.disk}%`,
    });
  }
  if (isLoadAlert(h)) {
    const cores = ov.cpuCount || 0;
    const load1 = ov.load1 || 0;
    out.push({
      key: `${h.name}|load`,
      line: `「${h.name}」负载 ${load1.toFixed(2)} / ${cores} 核 超过警戒`,
    });
  }
  return out;
}

function notifyNewAlerts(list: HostSnap[]) {
  const next = new Set<string>();
  const newLines: string[] = [];
  for (const h of list) {
    for (const a of collectHostAlerts(h)) {
      next.add(a.key);
      if (!prevAlertKeys.has(a.key)) {
        newLines.push(a.line);
      }
    }
  }
  prevAlertKeys = next;
  // 仅在新出现的告警时弹窗
  if (newLines.length === 0) return;

  const title =
    newLines.length === 1
      ? "主机告警"
      : `主机告警（${newLines.length} 项）`;
  const body =
    newLines.length <= 6
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

function applyHostData(data: GroupSnap) {
  const list = data.hosts || [];
  group.value = {
    groupId: data.groupId,
    groupName: data.groupName,
    hosts: list,
  };
  notifyNewAlerts(list);
}

function statusLabel(h: HostSnap): string {
  if (h.error) return "失败";
  if (isHostAlert(h)) return "告警";
  return "正常";
}

function statusTagType(h: HostSnap): "success" | "danger" {
  if (h.error || isHostAlert(h)) return "danger";
  return "success";
}

function cardClass(h: HostSnap) {
  return {
    "is-error": !!h.error,
    "is-alert": !h.error && isHostAlert(h),
  };
}

function tableRowClass({ row }: { row: HostSnap }) {
  if (row.error || isHostAlert(row)) return "host-list-row is-danger-row";
  return "host-list-row";
}

function shortOs(osRelease: string): string {
  const s = (osRelease || "").trim();
  if (!s) return "";
  const m = s.match(/^([A-Za-z]+)/);
  return m ? m[1] : s.slice(0, 16);
}

async function load() {
  if (!props.groupId) return;
  const my = ++seq;
  loading.value = true;
  try {
    const data = (await api.listOneGroupOverview(props.groupId)) as GroupSnap;
    if (my !== seq) return;
    applyHostData(data);
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
  }, POLL_MS);
}

async function loadQuiet() {
  if (!props.groupId) return;
  const my = ++seq;
  try {
    const data = (await api.listOneGroupOverview(props.groupId)) as GroupSnap;
    if (my !== seq) return;
    applyHostData(data);
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

// ---------- 子组件：卡片内容 ----------

const HostCardBody = defineComponent({
  name: "HostCardBody",
  props: {
    host: { type: Object as () => HostSnap, required: true },
    large: { type: Boolean, default: false },
  },
  setup(p) {
    return () => {
      const hst = p.host;
      const alert = !!hst.error || isHostAlert(hst);
      const ov = hst.overview;
      return h(
        "div",
        { class: ["hcb", p.large ? "hcb--large" : "", alert ? "hcb--alarm" : ""] },
        [
          h("span", {
            class: [
              "status-dot",
              hst.error ? "err" : alert ? "alert" : "ok",
            ],
            title: hst.error
              ? "连接失败"
              : alert
                ? "存在告警"
                : "正常",
          }),
          h("div", { class: "card-top" }, [
            h(
              "div",
              { class: ["avatar", hst.error ? "err" : ""] },
              hst.error
                ? h(
                    "span",
                    { class: "avatar-warn" },
                    h(WarningFilled, { style: { width: "22px", height: "22px" } })
                  )
                : h(DistroLogo, {
                    osRelease: ov?.osRelease || "",
                    size: p.large ? 30 : 26,
                  })
            ),
            h("div", { class: "id-block" }, [
              h("div", { class: "host-name", title: hst.name }, hst.name),
              h(
                "div",
                {
                  class: "host-sub",
                  title: hst.error
                    ? hst.error
                    : `${hst.user || "?"}@${hst.hostName || "?"}`,
                },
                hst.error
                  ? h("span", { class: "err-text" }, hst.error)
                  : `${hst.user || "?"}@${hst.hostName || "?"}`
              ),
              !hst.error && ov
                ? h(
                    "div",
                    { class: "host-meta" },
                    `${ov.cpuCount || 0} 核 · ${formatBytes(ov.memTotal || 0)}${
                      ov.osRelease ? ` · ${shortOs(ov.osRelease)}` : ""
                    }`
                  )
                : null,
            ]),
          ]),
          !hst.error && ov
            ? h("div", { class: "metrics" }, [
                metricRow(
                  "CPU",
                  ov.cpuPercent || 0,
                  (ov.cpuPercent || 0) >= THRESHOLDS.cpu,
                  `${(ov.cpuPercent || 0).toFixed(1)}%`
                ),
                metricRow(
                  "MEM",
                  ov.memPercent || 0,
                  (ov.memPercent || 0) > THRESHOLDS.mem,
                  `${(ov.memPercent || 0).toFixed(1)}%`,
                  memUsage(hst)
                ),
                metricRow(
                  "DISK",
                  diskPercent(hst),
                  diskPercent(hst) > THRESHOLDS.disk,
                  `${diskPercent(hst).toFixed(1)}%`,
                  diskUsage(hst)
                ),
                metricRow(
                  "LOAD",
                  loadBar(hst),
                  isLoadAlert(hst),
                  (ov.load1 || 0).toFixed(2),
                  `/ ${ov.cpuCount || 0}`
                ),
              ])
            : hst.error
              ? h(
                  "div",
                  { class: "card-footer-hint" },
                  p.large ? "双击打开后可重试连接" : "点击打开后可重试连接"
                )
              : null,
        ]
      );
    };
  },
});

function metricRow(
  label: string,
  percent: number,
  alert: boolean,
  display: string,
  sub?: string
) {
  return h("div", { class: ["metric-row", alert ? "is-alert" : ""] }, [
    h("span", { class: "m-label" }, label),
    h(
      "span",
      { class: "m-bar" },
      h(ElProgress, {
        percentage: Math.min(100, Math.max(0, percent || 0)),
        strokeWidth: 6,
        showText: false,
        color: alert ? "var(--el-color-danger)" : "var(--el-color-primary)",
      })
    ),
    h("span", { class: ["m-val", alert ? "is-alert" : ""] }, display),
    sub
      ? h("span", { class: "m-sub" }, sub)
      : h("span", { class: "m-sub empty" }, ""),
  ]);
}

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
    prevAlertKeys = new Set();
    void load().then(startPoll);
  }
);
</script>

<style scoped lang="scss">
.group-overview {
  min-height: 200px;
  box-sizing: border-box;
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
.view-opt {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.view-switch :deep(.el-radio-button__inner) {
  padding: 6px 12px;
}

/* ---------- 日常卡片 ---------- */
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
  &.is-error,
  &.is-alert {
    border-color: var(--el-color-danger) !important;
    box-shadow: 0 0 0 1px var(--el-color-danger);
  }
}

/* HostCardBody */
:deep(.hcb) {
  position: relative;
}
:deep(.status-dot) {
  position: absolute;
  top: 0;
  right: 0;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  &.ok {
    background: #67c23a;
    box-shadow: 0 0 0 2px rgba(103, 194, 58, 0.2);
  }
  &.alert,
  &.err {
    background: #f56c6c;
    box-shadow: 0 0 0 2px rgba(245, 108, 108, 0.25);
  }
}
:deep(.card-top) {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  min-width: 0;
  padding-right: 14px;
}
:deep(.avatar) {
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
:deep(.avatar-warn) {
  display: flex;
  color: var(--el-color-danger);
}
:deep(.id-block) {
  min-width: 0;
  flex: 1;
}
:deep(.host-name) {
  font-size: 14px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
:deep(.host-sub) {
  margin-top: 2px;
  font-size: 11px;
  color: var(--el-text-color-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
:deep(.err-text) {
  color: var(--el-color-danger);
}
:deep(.host-meta) {
  margin-top: 2px;
  font-size: 11px;
  color: var(--el-text-color-placeholder, #a8abb2);
}
:deep(.metrics) {
  margin-top: 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
:deep(.card-footer-hint) {
  margin-top: 12px;
  font-size: 11px;
  color: var(--el-text-color-placeholder);
}
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
}
:deep(.metric-row.is-alert .m-label) {
  color: var(--el-color-danger);
  font-weight: 600;
}
:deep(.m-bar) {
  flex: 1;
  min-width: 0;
}
:deep(.m-val) {
  width: 44px;
  text-align: right;
  font-variant-numeric: tabular-nums;
  flex-shrink: 0;
  &.is-alert {
    color: var(--el-color-danger) !important;
    font-weight: 700;
  }
}
:deep(.m-sub) {
  width: 96px;
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
:deep(.hcb--large .host-name) {
  font-size: 16px;
}
:deep(.hcb--large .host-sub) {
  font-size: 12px;
}
:deep(.hcb--large .avatar) {
  width: 52px;
  height: 52px;
}
:deep(.hcb--large .metric-row) {
  font-size: 12px;
}
:deep(.hcb--large .m-val) {
  width: 52px;
  font-size: 13px;
}

/* ---------- 列表 ---------- */
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
}

html.dark .host-card,
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
