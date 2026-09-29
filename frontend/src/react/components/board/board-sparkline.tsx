/** 近 1h 趋势 sparkline；点数不足时不占位。与 Vue BoardSparkline 同算法。 */

const VB_W = 100;
const PAD_Y = 2;

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
    const pad = Math.max(Math.abs(lo) * 0.05, 0.5);
    return { lo: lo - pad, hi: hi + pad };
  }
  const pad = span * 0.18;
  return { lo: lo - pad, hi: hi + pad };
}

export function BoardSparkline({
  values,
  alert = false,
  height = 28,
}: {
  values: number[];
  alert?: boolean;
  height?: number;
}) {
  const vbH = Math.max(12, height);
  const raw = (values || [])
    .map((v) => Number(v))
    .filter((v) => Number.isFinite(v));
  if (raw.length < 2) return null;

  const { lo, hi } = yScale(raw);
  const range = hi - lo || 1;
  const n = raw.length;
  const points: { x: number; y: number }[] = [];
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * VB_W;
    const t = (raw[i] - lo) / range;
    const y = PAD_Y + (1 - t) * (vbH - PAD_Y * 2);
    points.push({ x, y });
  }

  const last = points[points.length - 1];
  const line = points.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(" ");
  const first = points[0];
  const area = `${first.x.toFixed(2)},${vbH} ${line} ${last.x.toFixed(2)},${vbH}`;
  // 单线主指标走图表主线色，告警走错误色；具体色值由 board.css 的暗色 token 决定
  const color = alert ? "var(--color-danger)" : "var(--color-chart-1)";

  return (
    <svg
      className="board-sparkline"
      viewBox={`0 0 ${VB_W} ${vbH}`}
      preserveAspectRatio="none"
      style={{ height: `${height}px` }}
      aria-hidden="true"
    >
      <polygon className="board-sparkline__area" points={area} fill={color} />
      <polyline
        points={line}
        fill="none"
        stroke={color}
        strokeWidth="2.25"
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
      <circle
        cx={last.x}
        cy={last.y}
        r="2.2"
        fill={color}
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
