/** 近 1h 趋势 sparkline；点数不足时不占位。与 Vue BoardSparkline 同算法。 */
import { useId, type ReactNode } from "react";
import { bandTone, type UsageBands, type UsageTone } from "@/react/lib/usage-tone";

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
  bands,
}: {
  values: number[];
  alert?: boolean;
  height?: number;
  /** 占用类趋势按 §4.7 三档分段着色；alert 为真时仍整条走危险色 */
  bands?: UsageBands;
}) {
  // useId 带冒号 / 书名号，url(#…) 引用前去掉
  const gradientId = `spark-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
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
  let color = alert ? "var(--color-danger)" : "var(--color-chart-1)";
  let dotColor = color;
  let gradient: ReactNode = null;
  if (bands && !alert) {
    // 阈值换算到 viewBox 纵坐标，做硬切色标：线在哪一档就是哪一档的颜色
    const toOffset = (v: number) => {
      const y = PAD_Y + (1 - (v - lo) / range) * (vbH - PAD_Y * 2);
      return Math.min(1, Math.max(0, y / vbH));
    };
    const dangerAt = toOffset(bands.danger);
    const warnAt = toOffset(bands.warn);
    const stops: [number, UsageTone][] = [
      [0, "danger"],
      [dangerAt, "danger"],
      [dangerAt, "warn"],
      [warnAt, "warn"],
      [warnAt, "ok"],
      [1, "ok"],
    ];
    gradient = (
      <defs>
        <linearGradient id={gradientId} gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2={vbH}>
          {stops.map(([offset, tone], i) => (
            <stop key={i} offset={offset} style={{ stopColor: `var(--meter-${tone})` }} />
          ))}
        </linearGradient>
      </defs>
    );
    color = `url(#${gradientId})`;
    dotColor = `var(--meter-${bandTone(raw[n - 1]!, bands)})`;
  }

  return (
    <svg
      className="board-sparkline"
      viewBox={`0 0 ${VB_W} ${vbH}`}
      preserveAspectRatio="none"
      style={{ height: `${height}px` }}
      aria-hidden="true"
    >
      {gradient}
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
        fill={dotColor}
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
