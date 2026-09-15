<template>
  <div :class="embedded ? 'cpu-cores-embed' : 'cpu-cores-card home-card panel-hover-card'">
    <div v-if="!embedded" class="card-header">
      <span class="panel-section-title">CPU 核心</span>
      <span v-if="cores.length" class="muted mono">{{ cores.length }} 核</span>
    </div>
    <div v-else class="embed-head">
      <span class="embed-title">每核负载</span>
    </div>

    <div v-if="!cores.length" class="muted">无每核数据</div>
    <template v-else>
      <div class="cores-grid">
        <div
          v-for="c in cores"
          :key="c.index"
          class="core-cell"
          v-tip="coreTitle(c)"
        >
          <svg class="core-ring" viewBox="0 0 36 36" aria-hidden="true">
            <circle class="core-ring__track" cx="18" cy="18" r="14" />
            <circle
              class="core-ring__arc"
              :class="ringClass(c.kind)"
              cx="18"
              cy="18"
              r="14"
              :stroke-dasharray="arcDash(c.percent)"
              stroke-dashoffset="0"
            />
          </svg>
          <div class="core-label">
            <span class="core-pct mono">{{ formatPct(c.percent) }}</span>
            <span class="core-idx muted">#{{ c.index }}</span>
          </div>
        </div>
      </div>

      <div v-if="showLegend" class="cores-legend">
        <!-- 与环图从左到右一致：先性能核（蓝），再能效核（粉） -->
        <span class="legend-item">
          <i class="legend-dot legend-dot--perf" />
          性能核心 {{ formatPct(perfPercent) }}%
          <template v-if="(perfCores || 0) > 0"> · {{ perfCores }} 核</template>
        </span>
        <span class="legend-item">
          <i class="legend-dot legend-dot--eff" />
          能效核心 {{ formatPct(effPercent) }}%
          <template v-if="(effCores || 0) > 0"> · {{ effCores }} 核</template>
        </span>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { localsys } from "@/api";

const props = withDefaults(
  defineProps<{
    cores: localsys.CPUCoreStat[] | null | undefined;
    perfPercent?: number;
    effPercent?: number;
    perfCores?: number;
    effCores?: number;
    /** 嵌在弹窗内：去掉外层卡片样式 */
    embedded?: boolean;
  }>(),
  { embedded: false }
);

const CIRC = 2 * Math.PI * 14;

const cores = computed(() => props.cores || []);

const showLegend = computed(
  () => (props.perfCores || 0) > 0 || (props.effCores || 0) > 0
);

function clampPct(v: number): number {
  if (!Number.isFinite(v) || v < 0) return 0;
  if (v > 100) return 100;
  return v;
}

function formatPct(v: number | undefined): string {
  return clampPct(Number(v) || 0).toFixed(0);
}

function arcDash(percent: number): string {
  const p = clampPct(percent) / 100;
  const filled = CIRC * p;
  return `${filled} ${CIRC - filled}`;
}

function ringClass(kind: string): string {
  if (kind === "eff") return "is-eff";
  if (kind === "perf") return "is-perf";
  return "is-neutral";
}

function coreTitle(c: localsys.CPUCoreStat): string {
  const kindLabel =
    c.kind === "perf" ? "性能核" : c.kind === "eff" ? "能效核" : "逻辑核";
  return `${kindLabel} #${c.index}: ${clampPct(c.percent).toFixed(1)}%`;
}
</script>

<style scoped lang="scss">
.cpu-cores-card {
  margin-bottom: 0;
  background: var(--m3-card, var(--m3-surface-container-lowest, #fff));
  border: 1px solid var(--m3-outline-variant, #cac4d0);
  border-radius: 12px;
  padding: 12px 14px;
}

.cpu-cores-embed {
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid var(--m3-outline-variant, #cac4d0);
}

.card-header,
.embed-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
  gap: 8px;
}

.embed-title {
  font-size: 12px;
  color: var(--m3-on-surface-variant, #49454f);
}

.cores-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 10px;
  justify-content: flex-start;
}

.core-cell {
  width: 48px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
}

.core-ring {
  width: 40px;
  height: 40px;
  transform: rotate(-90deg);
}

.core-ring__track {
  fill: none;
  stroke: var(--m3-surface-container-highest, #e6e5ea);
  stroke-width: 3.5;
}

.core-ring__arc {
  fill: none;
  stroke-width: 3.5;
  stroke-linecap: round;
  transition: stroke-dasharray 0.35s ease;

  &.is-eff {
    stroke: #e85d8a;
  }

  &.is-perf {
    stroke: #4a7dff;
  }

  &.is-neutral {
    stroke: var(--m3-primary, #6750a4);
  }
}

.core-label {
  display: flex;
  flex-direction: column;
  align-items: center;
  line-height: 1.2;
}

.core-pct {
  font-size: 11px;
  font-weight: 600;
  color: var(--m3-on-surface, #1d1b20);
}

.core-idx {
  font-size: 10px;
}

.cores-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 10px 16px;
  margin-top: 10px;
  padding-top: 8px;
  border-top: 1px solid var(--m3-outline-variant, #cac4d0);
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.legend-item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.legend-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;

  &--eff {
    background: #e85d8a;
  }

  &--perf {
    background: #4a7dff;
  }
}

.mono {
  font-family: var(--m3-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
  font-variant-numeric: tabular-nums;
}

.muted {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}
</style>
