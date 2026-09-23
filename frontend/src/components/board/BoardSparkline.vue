<template>
  <!-- 点数不足时不占位，避免挤布局 -->
  <svg
    v-if="points.length >= 2"
    class="board-sparkline"
    :viewBox="`0 0 ${VB_W} ${vbH}`"
    preserveAspectRatio="none"
    :style="{ height: `${height}px` }"
    aria-hidden="true"
  >
    <polygon
      class="board-sparkline__area"
      :points="areaPoints"
      :fill="strokeColor"
    />
    <polyline
      class="board-sparkline__line"
      :points="linePoints"
      fill="none"
      :stroke="strokeColor"
      stroke-width="2.25"
      stroke-linejoin="round"
      stroke-linecap="round"
      vector-effect="non-scaling-stroke"
    />
    <!-- 最新点：强调当前值 -->
    <circle
      class="board-sparkline__dot"
      :cx="lastPoint.x"
      :cy="lastPoint.y"
      r="2.2"
      :fill="strokeColor"
      vector-effect="non-scaling-stroke"
    />
  </svg>
</template>

<script setup lang="ts">
import { computed } from "vue";

const VB_W = 100;
const PAD_Y = 2;

const props = withDefaults(
  defineProps<{
    /** 原始采样值（通常 0–100）；纵轴按本段数据自适应放大波动 */
    values: number[];
    alert?: boolean;
    /** SVG 显示高度（px） */
    height?: number;
  }>(),
  { height: 28 }
);

const vbH = computed(() => Math.max(12, props.height));

/** 清洗为有限数；纵轴用 min/max 自适应，避免全程贴在 0–100 底部看不出波动 */
function yScale(vals: number[]): { lo: number; hi: number } {
  let lo = Infinity;
  let hi = -Infinity;
  for (const raw of vals) {
    const v = Number(raw);
    if (!Number.isFinite(v)) continue;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) {
    return { lo: 0, hi: 1 };
  }
  const span = hi - lo;
  if (span < 1e-6) {
    // 几乎水平：上下各扩一点，避免看不见线
    const pad = Math.max(Math.abs(lo) * 0.05, 0.5);
    return { lo: lo - pad, hi: hi + pad };
  }
  // 上下各留 18% 余量，让波峰波谷更满
  const pad = span * 0.18;
  return { lo: lo - pad, hi: hi + pad };
}

const points = computed(() => {
  const raw = (props.values || [])
    .map((v) => Number(v))
    .filter((v) => Number.isFinite(v));
  if (raw.length < 2) return [] as { x: number; y: number }[];
  const h = vbH.value;
  const { lo, hi } = yScale(raw);
  const range = hi - lo || 1;
  const n = raw.length;
  const out: { x: number; y: number }[] = [];
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * VB_W;
    const t = (raw[i] - lo) / range;
    const y = PAD_Y + (1 - t) * (h - PAD_Y * 2);
    out.push({ x, y });
  }
  return out;
});

const lastPoint = computed(() => {
  const pts = points.value;
  return pts[pts.length - 1] || { x: 0, y: 0 };
});

const linePoints = computed(() =>
  points.value.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(" ")
);

const areaPoints = computed(() => {
  const pts = points.value;
  if (pts.length < 2) return "";
  const h = vbH.value;
  const first = pts[0];
  const last = pts[pts.length - 1];
  const line = pts.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(" ");
  return `${first.x.toFixed(2)},${h} ${line} ${last.x.toFixed(2)},${h}`;
});

const BOARD_ACCENT = "#51d5b0";
const BOARD_DANGER = "#ff6673";

const strokeColor = computed(() =>
  props.alert ? BOARD_DANGER : BOARD_ACCENT
);
</script>

<style scoped>
.board-sparkline {
  display: block;
  width: 100%;
  min-width: 0;
  overflow: visible;
}

.board-sparkline__area {
  opacity: 0.28;
}

.board-sparkline__line {
  opacity: 1;
}

.board-sparkline__dot {
  opacity: 1;
}
</style>
