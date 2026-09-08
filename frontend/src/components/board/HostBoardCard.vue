<template>
  <div
    class="host-board-card"
    :class="[
      `density-${density}`,
      {
        'is-bad': !!error || alert,
        'is-ok': !error && !alert && !!overview,
        'is-loading': loading && !overview && !error,
      },
    ]"
    @dblclick="emit('open', name)"
  >
    <div class="host-board-card__head">
      <div class="host-board-card__title">
        <span class="host-board-card__name" :title="name">{{ name }}</span>
        <span v-if="address && showAddr" class="host-board-card__addr mono">{{
          address
        }}</span>
      </div>
    </div>

    <div v-if="error" class="host-board-card__error">
      {{ error }}
    </div>
    <div v-else-if="loading && !overview" class="host-board-card__loading">
      加载中…
    </div>
    <!--
      扁平 2 列网格：上下两排「标签/数值/副文/图」共享行，柱水平对齐。
      布局：CPU | 内存（sparkline）；负载 | 磁盘（进度条）；可选第三行「订阅」。
      xxs 隐藏 sparkline。
    -->
    <div
      v-else-if="overview"
      class="host-board-card__metrics"
      :class="{ 'has-app-sub': showAppSub }"
    >
      <div class="m-label m-r1-c1" :class="{ 'is-alert': cpuAlert }">CPU</div>
      <div class="m-label m-r1-c2" :class="{ 'is-alert': memAlert }">内存</div>
      <div class="m-value m-r1-c1" :class="{ 'is-alert': cpuAlert }">
        {{ overview.cpuPercent.toFixed(1) }}%
      </div>
      <div class="m-value m-r1-c2" :class="{ 'is-alert': memAlert }">
        {{ overview.memPercent.toFixed(1) }}%
      </div>
      <div v-if="showSub" class="m-sub m-r1-c1">{{ overview.cpuCount || "—" }} 核</div>
      <div v-if="showSub" class="m-sub m-r1-c2">{{ memUsageText }}</div>
      <BoardSparkline
        v-if="showSpark"
        class="m-spark m-r1-c1"
        :values="cpuTrend || []"
        :alert="cpuAlert"
        :height="sparkHeight"
      />
      <BoardSparkline
        v-if="showSpark"
        class="m-spark m-r1-c2"
        :values="memTrend || []"
        :alert="memAlert"
        :height="sparkHeight"
      />

      <div class="m-label m-r2-c1" :class="{ 'is-alert': loadAlert }">负载</div>
      <div class="m-label m-r2-c2" :class="{ 'is-alert': diskAlert }">磁盘 /</div>
      <div class="m-value m-r2-c1" :class="{ 'is-alert': loadAlert }">
        {{ overview.load1.toFixed(2) }}
        <span class="m-unit">/ {{ overview.cpuCount || "—" }}</span>
      </div>
      <div class="m-value m-r2-c2" :class="{ 'is-alert': diskAlert }">
        {{ diskPct.toFixed(1) }}%
      </div>
      <div v-if="showSub" class="m-sub m-r2-c1">{{ loadRatioText }}</div>
      <div v-if="showSub" class="m-sub m-r2-c2">{{ diskUsageText }}</div>
      <el-progress
        class="m-bar m-r2-c1"
        :class="{ 'is-alert-bar': loadAlert }"
        :percentage="loadBarPct"
        :stroke-width="barStroke"
        :show-text="false"
        :color="barColor(loadAlert)"
      />
      <el-progress
        class="m-bar m-r2-c2"
        :class="{ 'is-alert-bar': diskAlert }"
        :percentage="clampPct(diskPct)"
        :stroke-width="barStroke"
        :show-text="false"
        :color="barColor(diskAlert)"
      />

      <template v-if="showAppSub">
        <div class="m-label m-r3" :class="{ 'is-alert': appSubAlert }">订阅</div>
        <div v-if="appSubAlert" class="m-value m-r3 is-alert">0</div>
        <div v-else class="m-app-subs m-r3">
          <span
            v-for="it in appSubItems"
            :key="it.name"
            class="m-app-sub"
            :class="{ 'is-alert': it.count === 0 }"
          >
            {{ it.name }} {{ it.count }}
          </span>
        </div>
        <div v-if="showSub" class="m-sub m-r3">已订阅应用</div>
      </template>
    </div>
    <div v-else class="host-board-card__loading">暂无数据</div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { monitor } from "@/api";
import { formatBytes, formatMemCapacity } from "@/utils/format";
import {
  isCpuAlert,
  isDiskLow,
  isLoadAlert,
  isMemAlert,
  pickRootDisk,
} from "@/utils/alerts";
import BoardSparkline from "@/components/board/BoardSparkline.vue";
import type { BoardAppSubItem } from "@/components/board/BoardModeOverlay.vue";

export type BoardCardDensity = "lg" | "md" | "sm" | "xs" | "xxs";

const props = withDefaults(
  defineProps<{
    name: string;
    address?: string;
    loading?: boolean;
    overview?: monitor.Overview | null;
    disks?: monitor.DiskInfo[] | null;
    error?: string | null;
    /** 近 1h CPU% 趋势（0–100） */
    cpuTrend?: number[];
    /** 近 1h 内存占用% 趋势（0–100） */
    memTrend?: number[];
    /** 已订阅微服务及实例数；null/undefined 表示从未配置、不显示该行 */
    appSubItems?: BoardAppSubItem[] | null;
    /** 由看板宫格档位驱动：越密越紧凑 */
    density?: BoardCardDensity;
  }>(),
  { density: "md" }
);

const emit = defineEmits<{ open: [name: string] }>();

const overview = computed(() => props.overview || null);
const error = computed(() => props.error || "");
const loading = computed(() => !!props.loading);
const density = computed(() => props.density);

/** 超密宫格隐藏副文/地址/sparkline，给主数值和进度条留空间 */
const showSub = computed(() => density.value !== "xxs");
const showAddr = computed(() => density.value !== "xxs" && density.value !== "xs");
const showSpark = computed(() => density.value !== "xxs");

const appSubItems = computed(() => props.appSubItems ?? null);
const showAppSub = computed(() => appSubItems.value !== null);
const appSubAlert = computed(
  () => showAppSub.value && (appSubItems.value?.length ?? 0) === 0
);

const barStroke = computed(() => {
  switch (density.value) {
    case "lg":
      return 10;
    case "md":
      return 8;
    case "sm":
      return 7;
    case "xs":
      return 6;
    default:
      return 5;
  }
});

const sparkHeight = computed(() => {
  switch (density.value) {
    case "lg":
      return 36;
    case "md":
      return 32;
    case "sm":
      return 26;
    case "xs":
      return 22;
    default:
      return 12;
  }
});

const cpuAlert = computed(() => isCpuAlert(overview.value));
const memAlert = computed(() => isMemAlert(overview.value));
const loadAlert = computed(() => isLoadAlert(overview.value));
const diskAlert = computed(() => isDiskLow(props.disks));

const alert = computed(
  () =>
    !error.value &&
    !!overview.value &&
    (cpuAlert.value ||
      memAlert.value ||
      loadAlert.value ||
      diskAlert.value ||
      appSubAlert.value)
);

const rootDisk = computed(() => pickRootDisk(props.disks));
const diskPct = computed(() => rootDisk.value?.percent ?? 0);

const memUsageText = computed(() => {
  const ov = overview.value;
  if (!ov) return "—";
  return `${formatBytes(ov.memUsed || 0)} / ${formatMemCapacity(ov.memTotal || 0)}`;
});

const diskUsageText = computed(() => {
  const d = rootDisk.value;
  if (!d) return "—";
  return `${formatBytes(d.used || 0)} / ${formatBytes(d.total || 0)}`;
});

const loadRatioText = computed(() => {
  const ov = overview.value;
  if (!ov?.cpuCount) return "—";
  const ratio = (ov.load1 || 0) / ov.cpuCount;
  return `核均 ${ratio.toFixed(2)}`;
});

/** 负载柱：核均负载映射到 0–100（与告警阈值 1.0 对齐，超 1 即满格） */
const loadBarPct = computed(() => {
  const ov = overview.value;
  if (!ov?.cpuCount) return 0;
  return clampPct(((ov.load1 || 0) / ov.cpuCount) * 100);
});

function clampPct(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(100, v));
}

/** 进度条颜色：告警红，否则主题蓝 */
function barColor(isAlert: boolean): string {
  // Element Plus / WebView 对 CSS 变量作 color 常不生效，用实色
  return isAlert ? "#ff6b6b" : "#7aa2ff";
}
</script>

<style scoped lang="scss">
.host-board-card {
  --board-accent: #7aa2ff;
  --board-danger: #ff6b6b;
  --board-warn: #ffb020;
  --board-ok: #3dd68c;
  --board-surface: #1a1d24;
  --board-border: #2a303c;
  --board-text: #e8eaed;
  --board-muted: #9aa0a6;

  /* 默认 = md（3×3 九宫格） */
  --card-pad: 16px 18px;
  --card-gap: 12px;
  --head-min-h: 44px;
  --name-size: 20px;
  --addr-size: 12px;
  --label-size: 12px;
  --value-size: 26px;
  --unit-size: 15px;
  --sub-size: 12px;
  --bar-h: 8px;
  --spark-h: 32px;
  --metric-col-gap: 20px;
  --metric-row-gap: 4px;
  --metric-mid-gap: 12px;

  box-sizing: border-box;
  min-width: 0;
  min-height: 0;
  height: 100%;
  display: flex;
  flex-direction: column;
  gap: var(--card-gap);
  padding: var(--card-pad);
  border-radius: 12px;
  background: var(--board-surface);
  border: 1px solid var(--board-border);
  color: var(--board-text);
  cursor: pointer;
  user-select: none;
  /* M3：描边/阴影态变走 short4 + standard；reduced-motion 由全局 token 置 0 */
  transition: border-color var(--m3-motion-select), box-shadow var(--m3-motion-select);

  &:hover {
    border-color: color-mix(in srgb, var(--board-accent) 55%, var(--board-border));
  }

  &.is-bad {
    background: #3a1518;
    border-color: var(--board-danger);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--board-danger) 45%, transparent);
  }

  &.is-ok {
    border-color: color-mix(in srgb, var(--board-ok) 35%, var(--board-border));
  }

  &.density-lg {
    --card-pad: 20px 22px;
    --card-gap: 16px;
    --head-min-h: 52px;
    --name-size: 26px;
    --addr-size: 14px;
    --label-size: 13px;
    --value-size: 34px;
    --unit-size: 18px;
    --sub-size: 13px;
    --bar-h: 10px;
    --spark-h: 36px;
    --metric-col-gap: 28px;
    --metric-row-gap: 6px;
    --metric-mid-gap: 16px;
  }

  &.density-sm {
    --card-pad: 12px 14px;
    --card-gap: 8px;
    --head-min-h: 36px;
    --name-size: 16px;
    --addr-size: 11px;
    --label-size: 11px;
    --value-size: 20px;
    --unit-size: 12px;
    --sub-size: 11px;
    --bar-h: 7px;
    --spark-h: 26px;
    --metric-col-gap: 14px;
    --metric-row-gap: 3px;
    --metric-mid-gap: 8px;
  }

  &.density-xs {
    --card-pad: 10px 12px;
    --card-gap: 6px;
    --head-min-h: 28px;
    --name-size: 14px;
    --addr-size: 10px;
    --label-size: 10px;
    --value-size: 17px;
    --unit-size: 11px;
    --sub-size: 10px;
    --bar-h: 6px;
    --spark-h: 22px;
    --metric-col-gap: 12px;
    --metric-row-gap: 2px;
    --metric-mid-gap: 6px;
  }

  &.density-xxs {
    --card-pad: 8px 10px;
    --card-gap: 4px;
    --head-min-h: 22px;
    --name-size: 13px;
    --addr-size: 10px;
    --label-size: 10px;
    --value-size: 15px;
    --unit-size: 10px;
    --sub-size: 10px;
    --bar-h: 5px;
    --spark-h: 0px;
    --metric-col-gap: 10px;
    --metric-row-gap: 2px;
    --metric-mid-gap: 4px;
  }
}

.host-board-card__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
  flex-shrink: 0;
  min-height: var(--head-min-h);
}

.host-board-card__title {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.host-board-card__name {
  font-size: var(--name-size);
  font-weight: 650;
  letter-spacing: 0.01em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.host-board-card__addr {
  font-size: var(--addr-size);
  color: var(--board-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.host-board-card.is-bad .host-board-card__name,
.host-board-card.is-bad .host-board-card__addr {
  color: #ffc9c9;
}

.host-board-card.is-bad .host-board-card__addr {
  color: #ffb0b0;
  opacity: 0.85;
}

.host-board-card__error,
.host-board-card__loading {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  text-align: center;
  color: var(--board-muted);
  font-size: var(--sub-size);
  padding: 4px;
  overflow: hidden;
}

.host-board-card__error {
  color: var(--board-danger);
}

/*
  有副文：9 行（含中间空隙）；CPU/内存行高用 --spark-h，负载/磁盘用 --bar-h
  无副文（xxs）：隐藏 sparkline，6 行
  has-app-sub：再加空隙 + 订阅标签/数值（及可选副文）
*/
.host-board-card__metrics {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  grid-template-rows:
    auto
    auto
    auto
    var(--spark-h)
    var(--metric-mid-gap)
    auto
    auto
    auto
    var(--bar-h);
  column-gap: var(--metric-col-gap);
  row-gap: var(--metric-row-gap);
  align-content: start;
}

.host-board-card__metrics.has-app-sub {
  grid-template-rows:
    auto
    auto
    auto
    var(--spark-h)
    var(--metric-mid-gap)
    auto
    auto
    auto
    var(--bar-h)
    var(--metric-mid-gap)
    auto
    auto
    auto;
}

.density-xxs .host-board-card__metrics {
  grid-template-rows:
    auto
    auto
    var(--metric-mid-gap)
    auto
    auto
    var(--bar-h);
}

.density-xxs .host-board-card__metrics.has-app-sub {
  grid-template-rows:
    auto
    auto
    var(--metric-mid-gap)
    auto
    auto
    var(--bar-h)
    var(--metric-mid-gap)
    auto
    auto;
}

.m-r1-c1 {
  grid-column: 1;
}
.m-r1-c2 {
  grid-column: 2;
}
.m-r2-c1 {
  grid-column: 1;
}
.m-r2-c2 {
  grid-column: 2;
}
.m-r3 {
  grid-column: 1 / -1;
}

.m-label.m-r1-c1,
.m-label.m-r1-c2 {
  grid-row: 1;
}
.m-value.m-r1-c1,
.m-value.m-r1-c2 {
  grid-row: 2;
}
.m-sub.m-r1-c1,
.m-sub.m-r1-c2 {
  grid-row: 3;
}
.m-spark.m-r1-c1,
.m-spark.m-r1-c2 {
  grid-row: 4;
  align-self: center;
}

.m-label.m-r2-c1,
.m-label.m-r2-c2 {
  grid-row: 6;
}
.m-value.m-r2-c1,
.m-value.m-r2-c2 {
  grid-row: 7;
}
.m-sub.m-r2-c1,
.m-sub.m-r2-c2 {
  grid-row: 8;
}
.m-bar.m-r2-c1,
.m-bar.m-r2-c2 {
  grid-row: 9;
  align-self: center;
}

.m-label.m-r3 {
  grid-row: 11;
}
.m-value.m-r3,
.m-app-subs.m-r3 {
  grid-row: 12;
}
.m-sub.m-r3 {
  grid-row: 13;
}

.density-xxs .m-label.m-r2-c1,
.density-xxs .m-label.m-r2-c2 {
  grid-row: 4;
}
.density-xxs .m-value.m-r2-c1,
.density-xxs .m-value.m-r2-c2 {
  grid-row: 5;
}
.density-xxs .m-bar.m-r2-c1,
.density-xxs .m-bar.m-r2-c2 {
  grid-row: 6;
}

.density-xxs .m-label.m-r3 {
  grid-row: 8;
}
.density-xxs .m-value.m-r3,
.density-xxs .m-app-subs.m-r3 {
  grid-row: 9;
}

.m-label {
  font-size: var(--label-size);
  line-height: 1.2;
  color: var(--board-muted);
  letter-spacing: 0.04em;

  &.is-alert {
    color: var(--board-danger);
  }
}

.m-value {
  font-size: var(--value-size);
  font-weight: 650;
  line-height: 1.15;
  height: 1.15em;
  font-variant-numeric: tabular-nums;
  overflow: hidden;
  white-space: nowrap;

  &.is-alert {
    color: var(--board-danger);
  }
}

.m-app-subs {
  display: flex;
  flex-wrap: wrap;
  gap: 0.15em 0.65em;
  align-items: baseline;
  min-height: 1.15em;
  font-size: calc(var(--value-size) * 0.72);
  font-weight: 650;
  font-variant-numeric: tabular-nums;
  line-height: 1.25;
}

.m-app-sub {
  white-space: nowrap;

  &.is-alert {
    color: var(--board-danger);
  }
}

.m-unit {
  font-size: var(--unit-size);
  font-weight: 500;
  color: var(--board-muted);
}

.m-sub {
  font-size: var(--sub-size);
  line-height: 1.2;
  height: 1.2em;
  color: var(--board-muted);
  font-variant-numeric: tabular-nums;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.m-bar,
.m-spark {
  width: 100%;
  min-width: 0;
  margin: 0 !important;
}

.mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}

:deep(.el-progress) {
  display: block;
  line-height: 0;
}

:deep(.el-progress-bar) {
  padding-right: 0;
  margin-right: 0;
  width: 100%;
}

:deep(.el-progress-bar__outer) {
  background-color: #2c3340 !important;
  height: var(--bar-h) !important;
}

:deep(.is-alert-bar .el-progress-bar__inner) {
  background-color: #ff6b6b !important;
}
</style>
