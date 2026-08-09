import { useMemo } from "react";

interface SparklineProps {
  data: number[];
  color: string;
  height?: number;
}

// Sparkline 用 SVG 画一条迷你折线（无坐标轴），用于 CPU/MEM 趋势
export function Sparkline({ data, color, height = 32 }: SparklineProps) {
  const width = 240;
  const path = useMemo(() => {
    if (data.length < 2) return "";
    const max = Math.max(...data, 1);
    const min = Math.min(...data, 0);
    const range = max - min || 1;
    const step = width / (data.length - 1);
    return data
      .map((v, i) => {
        const x = i * step;
        const y = height - ((v - min) / range) * (height - 4) - 2;
        return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");
  }, [data, height]);

  // 渐变填充区域
  const fillPath = useMemo(() => {
    if (!path) return "";
    return `${path} L${width},${height} L0,${height} Z`;
  }, [path, height]);

  if (data.length < 2) {
    return (
      <div
        className="flex items-center justify-center text-[10px] text-muted-foreground"
        style={{ height }}
      >
        采集中...
      </div>
    );
  }

  const gradId = `spark-${color.replace(/[^a-z0-9]/gi, "")}`;
  return (
    <svg
      width="100%"
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className="overflow-visible"
    >
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.35} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={fillPath} fill={`url(#${gradId})`} />
      <path
        d={path}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}
