<template>
  <article
    class="host-board-card"
    :class="[`density-${density}`, `health-${health}`, { 'is-loading': loading && !overview && !error }]"
    role="button"
    tabindex="0"
    :aria-label="`${name}，${healthLabel}`"
    @dblclick="emit('open', name)"
    @keydown.enter="emit('open', name)"
  >
    <header class="host-board-card__head">
      <div class="host-board-card__identity">
        <span class="host-board-card__state-dot" aria-hidden="true" />
        <div class="host-board-card__title">
          <div class="host-board-card__name-line">
            <span class="host-board-card__name" v-tip="name">{{ name }}</span>
            <span class="host-board-card__health">{{ healthLabel }}</span>
          </div>
          <span
            v-if="address && showAddress"
            class="host-board-card__addr mono"
          >{{ address }}</span>
        </div>
      </div>
      <span class="host-board-card__updated">{{ updatedText }}</span>
    </header>

    <div v-if="error" class="host-board-card__state host-board-card__state--error">
      <strong>连接异常</strong>
      <span>{{ error }}</span>
    </div>
    <div v-else-if="!overview" class="host-board-card__state">
      <strong>{{ loading ? "正在采集" : "暂无数据" }}</strong>
      <span>{{ loading ? "等待主机返回首个监控样本" : "请检查 Agent 或连接状态" }}</span>
    </div>
    <div v-else class="host-board-card__telemetry">
      <section class="metric-tile">
        <div class="metric-tile__top">
          <span class="metric-tile__label" :class="{ 'is-alert': cpuAlert }">CPU</span>
          <strong class="metric-tile__value" :class="{ 'is-alert': cpuAlert }">
            {{ overview.cpuPercent.toFixed(1) }}%
          </strong>
        </div>
        <span class="metric-tile__sub">{{ overview.cpuCount || "—" }} 核</span>
        <BoardSparkline
          class="metric-tile__visual"
          :values="cpuTrend || []"
          :alert="cpuAlert"
          :height="sparkHeight"
        />
      </section>

      <section class="metric-tile">
        <div class="metric-tile__top">
          <span class="metric-tile__label" :class="{ 'is-alert': memAlert }">内存</span>
          <strong class="metric-tile__value" :class="{ 'is-alert': memAlert }">
            {{ overview.memPercent.toFixed(1) }}%
          </strong>
        </div>
        <span class="metric-tile__sub">{{ memUsageText }}</span>
        <BoardSparkline
          class="metric-tile__visual"
          :values="memTrend || []"
          :alert="memAlert"
          :height="sparkHeight"
        />
      </section>

      <section class="metric-tile">
        <div class="metric-tile__top">
          <span class="metric-tile__label" :class="{ 'is-alert': loadAlert }">负载</span>
          <strong class="metric-tile__value" :class="{ 'is-alert': loadAlert }">
            {{ overview.load1.toFixed(2) }}
          </strong>
        </div>
        <span class="metric-tile__sub">{{ loadRatioText }}</span>
        <el-progress
          class="metric-tile__bar"
          :class="{ 'is-alert-bar': loadAlert }"
          :percentage="loadBarPct"
          :stroke-width="barStroke"
          :show-text="false"
          :color="barColor(loadAlert)"
        />
      </section>

      <section class="metric-tile">
        <div class="metric-tile__top">
          <span class="metric-tile__label" :class="{ 'is-alert': diskAlert }">磁盘</span>
          <strong class="metric-tile__value" :class="{ 'is-alert': diskAlert }">
            {{ diskPct.toFixed(1) }}%
          </strong>
        </div>
        <span class="metric-tile__sub">{{ diskUsageText }}</span>
        <el-progress
          class="metric-tile__bar"
          :class="{ 'is-alert-bar': diskAlert }"
          :percentage="clampPct(diskPct)"
          :stroke-width="barStroke"
          :show-text="false"
          :color="barColor(diskAlert)"
        />
      </section>
    </div>

    <footer class="host-board-card__apps">
      <span class="host-board-card__apps-label">应用订阅</span>
      <div class="host-board-card__apps-list">
        <span v-if="appSubLoading && !appSubItems.length" class="app-sub-empty">
          探活中…
        </span>
        <span v-else-if="!appSubItems.length" class="app-sub-empty">
          未配置服务
        </span>
        <span
          v-for="item in appSubItems"
          :key="item.name"
          class="app-sub-pill"
          :class="`is-${item.status}`"
        >
          <span>{{ item.name }}</span>
          <b>{{ item.status === "unknown" ? "—" : item.count }}</b>
        </span>
      </div>
    </footer>
  </article>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { monitor } from "@/api";
import { formatBytes, formatMemCapacity } from "@/utils/format";
import {
  ALERT,
  isCpuAlert,
  isDiskLow,
  isLoadAlert,
  isMemAlert,
  summarizeDisks,
} from "@/utils/alerts";
import BoardSparkline from "@/components/board/BoardSparkline.vue";
import { boardHealthOf, type BoardAppSubItem, type BoardHealth } from "@/utils/boardModel";

export type BoardCardDensity = "lg" | "md" | "sm" | "xs" | "xxs";

const props = withDefaults(
  defineProps<{
    name: string;
    address?: string;
    loading?: boolean;
    overview?: monitor.Overview | null;
    disks?: monitor.DiskInfo[] | null;
    error?: string | null;
    cpuTrend?: number[];
    memTrend?: number[];
    appSubItems?: BoardAppSubItem[] | null;
    appSubLoading?: boolean;
    updatedAt?: number;
    density?: BoardCardDensity;
  }>(),
  { density: "md", appSubLoading: false }
);

const emit = defineEmits<{
  open: [name: string];
}>();

const overview = computed(() => props.overview || null);
const error = computed(() => props.error || "");
const loading = computed(() => !!props.loading);
const density = computed(() => props.density);
const appSubItems = computed(() => props.appSubItems || []);
const appSubLoading = computed(() => !!props.appSubLoading);

const health = computed<BoardHealth>(() =>
  boardHealthOf({
    loading: loading.value,
    overview: overview.value,
    disks: props.disks,
    error: error.value || undefined,
    appSubItems: props.appSubItems,
    appSubLoading: appSubLoading.value,
    updatedAt: props.updatedAt,
  })
);

const healthLabel = computed(() => {
  switch (health.value) {
    case "healthy":
      return "正常";
    case "attention":
      return "注意";
    case "critical":
      return "严重";
    default:
      return "待采集";
  }
});

const showAddress = computed(() => density.value !== "xxs");
const cpuAlert = computed(() => isCpuAlert(overview.value));
const memAlert = computed(() => isMemAlert(overview.value));
const loadAlert = computed(() => isLoadAlert(overview.value));
const diskAlert = computed(() => isDiskLow(props.disks));
const diskSummary = computed(() => summarizeDisks(props.disks));
const diskPct = computed(() => diskSummary.value?.percent ?? 0);

const memUsageText = computed(() => {
  const ov = overview.value;
  if (!ov) return "—";
  return `${formatBytes(ov.memUsed || 0)} / ${formatMemCapacity(ov.memTotal || 0)}`;
});

const diskUsageText = computed(() => {
  const d = diskSummary.value;
  if (!d) return "—";
  return `${formatBytes(d.used || 0)} / ${formatBytes(d.total || 0)}`;
});

const loadRatioText = computed(() => {
  const ov = overview.value;
  if (!ov?.cpuCount) return "核均 —";
  return `核均 ${((ov.load1 || 0) / ov.cpuCount).toFixed(2)}`;
});

const loadBarPct = computed(() => {
  const ov = overview.value;
  if (!ov?.cpuCount) return 0;
  return clampPct(((ov.load1 || 0) / ov.cpuCount / ALERT.loadRatio) * 100);
});

const barStroke = computed(() => {
  switch (density.value) {
    case "lg":
      return 8;
    case "md":
      return 7;
    case "sm":
      return 6;
    default:
      return 5;
  }
});

const sparkHeight = computed(() => {
  switch (density.value) {
    case "lg":
      return 34;
    case "md":
      return 28;
    case "sm":
      return 23;
    case "xs":
      return 18;
    default:
      return 14;
  }
});

const updatedText = computed(() => {
  if (!props.updatedAt) return "待更新";
  const d = new Date(props.updatedAt);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
});

function clampPct(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(100, v));
}

function barColor(isAlert: boolean): string {
  return isAlert ? "#ff6673" : "#51d5b0";
}
</script>

<style scoped lang="scss">
.host-board-card {
  --card-pad: 13px 15px 11px;
  --card-gap: 10px;
  --value-size: 23px;
  --label-size: 11px;
  --sub-size: 10px;
  --app-size: 11px;
  --bar-h: 7px;
  --health-color: #51d5b0;

  container-type: inline-size;
  box-sizing: border-box;
  min-width: 0;
  min-height: 0;
  height: 100%;
  display: flex;
  flex-direction: column;
  gap: var(--card-gap);
  padding: var(--card-pad);
  overflow: hidden;
  border: 1px solid rgba(160, 207, 213, 0.16);
  border-left: 3px solid var(--health-color);
  border-radius: 4px;
  background: rgba(16, 35, 45, 0.94);
  color: #edf7f5;
  cursor: pointer;
  outline: none;
  user-select: none;
  transition: border-color var(--m3-motion-select), background-color var(--m3-motion-select);
}

.host-board-card:hover,
.host-board-card:focus-visible {
  border-color: color-mix(in srgb, var(--health-color) 70%, rgba(160, 207, 213, 0.16));
}

.host-board-card:focus-visible {
  outline: 2px solid var(--health-color);
  outline-offset: 2px;
}

.host-board-card.health-attention {
  --health-color: #eab25f;
}

.host-board-card.health-critical {
  --health-color: #ff6673;
  background: color-mix(in srgb, #ff6673 7%, #10232d);
}

.host-board-card.health-unknown {
  --health-color: #a8bec0;
}

.host-board-card.density-lg {
  --card-pad: 17px 19px 14px;
  --card-gap: 13px;
  --value-size: 31px;
  --label-size: 12px;
  --sub-size: 11px;
  --app-size: 12px;
  --bar-h: 8px;
}

.host-board-card.density-sm {
  --card-pad: 10px 12px 9px;
  --card-gap: 8px;
  --value-size: 19px;
  --label-size: 10px;
  --sub-size: 9px;
  --app-size: 10px;
  --bar-h: 6px;
}

.host-board-card.density-xs {
  --card-pad: 8px 10px 7px;
  --card-gap: 6px;
  --value-size: 17px;
  --label-size: 9px;
  --sub-size: 8px;
  --app-size: 9px;
  --bar-h: 5px;
}

.host-board-card.density-xxs {
  --card-pad: 7px 8px 6px;
  --card-gap: 5px;
  --value-size: 15px;
  --label-size: 8px;
  --sub-size: 8px;
  --app-size: 8px;
  --bar-h: 5px;
}

.host-board-card__head {
  flex: 0 0 auto;
  min-width: 0;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
  padding-bottom: 8px;
  border-bottom: 1px solid rgba(160, 207, 213, 0.13);
}

.host-board-card__identity {
  min-width: 0;
  display: flex;
  align-items: flex-start;
  gap: 8px;
}

.host-board-card__state-dot {
  flex: 0 0 auto;
  width: 7px;
  height: 7px;
  margin-top: 5px;
  border-radius: 50%;
  background: var(--health-color);
  box-shadow: 0 0 9px color-mix(in srgb, var(--health-color) 60%, transparent);
}

.host-board-card__title {
  min-width: 0;
}

.host-board-card__name-line {
  min-width: 0;
  display: flex;
  align-items: baseline;
  gap: 8px;
}

.host-board-card__name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: #edf7f5;
  font-size: clamp(14px, 1.2cqw, 22px);
  font-weight: 700;
  letter-spacing: 0.01em;
}

.host-board-card__health {
  flex: 0 0 auto;
  color: var(--health-color);
  font-size: var(--label-size);
  letter-spacing: 0.08em;
}

.host-board-card__addr,
.host-board-card__updated {
  color: #88a3a7;
  font-size: var(--sub-size);
  font-variant-numeric: tabular-nums;
}

.host-board-card__addr {
  display: block;
  margin-top: 3px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.host-board-card__updated {
  flex: 0 0 auto;
  padding-top: 2px;
}

.host-board-card__state {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 7px;
  text-align: center;
  color: #a5babb;
  font-size: var(--sub-size);
}

.host-board-card__state strong {
  color: var(--health-color);
  font-size: calc(var(--value-size) * 0.72);
}

.host-board-card__state--error span {
  max-width: 90%;
  color: #ffb7be;
  overflow: hidden;
  text-overflow: ellipsis;
}

.host-board-card__telemetry {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
  align-content: start;
}

.metric-tile {
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding: 9px 10px 8px;
  border-top: 1px solid rgba(160, 207, 213, 0.13);
  border-left: 1px solid rgba(160, 207, 213, 0.13);
  background: rgba(4, 18, 26, 0.3);
}

.metric-tile__top {
  min-width: 0;
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 6px;
}

.metric-tile__label {
  color: #92adb0;
  font-size: var(--label-size);
  letter-spacing: 0.1em;
}

.metric-tile__label.is-alert {
  color: var(--board-critical, #ff6673);
}

.metric-tile__value {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: #edf7f5;
  font: 700 var(--value-size)/1 "SF Mono", "JetBrains Mono", ui-monospace, monospace;
  font-variant-numeric: tabular-nums;
}

.metric-tile__value.is-alert {
  color: var(--board-critical, #ff6673);
}

.metric-tile__sub {
  min-height: 1.2em;
  margin-top: 5px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: #78969a;
  font-size: var(--sub-size);
  font-variant-numeric: tabular-nums;
}

.metric-tile__visual,
.metric-tile__bar {
  width: 100%;
  min-width: 0;
  margin-top: 10px !important;
}

.metric-tile__bar {
  margin-top: auto !important;
  padding-top: 10px;
}

.host-board-card__apps {
  flex: 0 0 auto;
  min-width: 0;
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding-top: 8px;
  border-top: 1px solid rgba(160, 207, 213, 0.13);
}

.host-board-card__apps-label {
  flex: 0 0 auto;
  padding-top: 2px;
  color: #92adb0;
  font-size: var(--app-size);
  letter-spacing: 0.08em;
}

.host-board-card__apps-list {
  min-width: 0;
  max-height: 42px;
  display: flex;
  flex: 1;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 8px;
  overflow: auto;
}

.app-sub-pill {
  display: inline-flex;
  align-items: baseline;
  gap: 4px;
  color: #b8d0ce;
  font: 600 var(--app-size)/1.25 "SF Mono", "JetBrains Mono", ui-monospace, monospace;
  white-space: nowrap;
}

.app-sub-pill b {
  color: var(--board-healthy, #51d5b0);
  font-weight: 700;
}

.app-sub-pill.is-critical,
.app-sub-pill.is-critical b {
  color: var(--board-critical, #ff6673);
}

.app-sub-pill.is-unknown,
.app-sub-pill.is-unknown b,
.app-sub-empty {
  color: #a3b8b9;
}

:deep(.el-progress) {
  display: block;
  line-height: 0;
}

:deep(.el-progress-bar) {
  width: 100%;
  padding-right: 0;
  margin-right: 0;
}

:deep(.el-progress-bar__outer) {
  height: var(--bar-h) !important;
  background-color: rgba(160, 207, 213, 0.16) !important;
}

:deep(.is-alert-bar .el-progress-bar__inner) {
  background-color: #ff6673 !important;
}

@container (max-width: 560px) {
  .host-board-card__telemetry {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .metric-tile {
    padding-inline: 7px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .host-board-card {
    transition: none;
  }

  .host-board-card__state-dot {
    box-shadow: none;
  }
}
</style>
