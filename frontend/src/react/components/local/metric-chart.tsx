import * as echarts from "echarts";
import { useEffect, useRef } from "react";
import { formatBytes } from "@/utils/format";

export function MetricChart({
  option,
  height = 200,
}: {
  option: echarts.EChartsOption;
  height?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const chartRef = useRef<echarts.EChartsType | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    const chart = echarts.init(ref.current);
    chartRef.current = chart;
    const onResize = () => chart.resize();
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      chart.dispose();
      chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    chartRef.current?.setOption(option, { notMerge: true });
  }, [option]);

  return <div ref={ref} style={{ height }} className="w-full min-w-0" />;
}

function pickByteScale(max: number) {
  if (max >= 1024 ** 3) return { divisor: 1024 ** 3, unit: "GB" };
  if (max >= 1024 ** 2) return { divisor: 1024 ** 2, unit: "MB" };
  if (max >= 1024) return { divisor: 1024, unit: "KB" };
  return { divisor: 1, unit: "B" };
}

function formatScaledBytes(v: number, divisor: number) {
  return (v / divisor).toFixed(divisor >= 1024 ** 2 ? 1 : 0);
}

/** 本机概览折线：CPU % / 内存 bytes / 磁盘 IO KB/s */
export function buildLocalLineOption(opts: {
  xData: string[];
  series: { name: string; data: number[]; yAxisIndex?: number }[];
  unit?: "percent" | "bytes" | "kbps";
  yMax?: number;
  markLine?: { name: string; value: number };
}): echarts.EChartsOption {
  const dual = opts.series.some((s) => s.yAxisIndex === 1);
  const allY = opts.series.flatMap((s) => s.data);
  const bytesScale =
    opts.unit === "bytes" ? pickByteScale(Math.max(0, ...allY, 1)) : null;

  const yAxes: echarts.YAXisComponentOption[] = [
    {
      type: "value",
      max: opts.yMax,
      axisLabel: {
        fontSize: 10,
        color: "#687382",
        formatter:
          opts.unit === "bytes" && bytesScale
            ? (v: number) => formatScaledBytes(v, bytesScale.divisor)
            : opts.unit === "kbps"
              ? (v: number) => `${Number(v).toFixed(0)}`
              : undefined,
      },
      name:
        opts.unit === "bytes"
          ? bytesScale?.unit
          : opts.unit === "kbps"
            ? "KB/s"
            : opts.unit === "percent"
              ? "%"
              : undefined,
      nameTextStyle: { fontSize: 10, color: "#687382" },
      splitLine: { lineStyle: { color: "#eef1f4" } },
    },
  ];

  if (dual && opts.unit === "bytes") {
    const right = opts.series.find((s) => s.yAxisIndex === 1);
    const rightScale = pickByteScale(Math.max(0, ...(right?.data || [0]), 1));
    yAxes.push({
      type: "value",
      axisLabel: {
        fontSize: 10,
        color: "#687382",
        formatter: (v: number) => formatScaledBytes(v, rightScale.divisor),
      },
      name: rightScale.unit,
      nameTextStyle: { fontSize: 10, color: "#687382" },
      splitLine: { show: false },
    });
  }

  return {
    color: ["#005EEB", "#14b8a6", "#f59e0b"],
    grid: { left: 52, right: dual ? 52 : 16, top: 28, bottom: 28 },
    tooltip: {
      trigger: "axis",
      valueFormatter: (v) => {
        if (typeof v !== "number") return String(v ?? "");
        if (opts.unit === "bytes") return formatBytes(v);
        if (opts.unit === "kbps") return `${v.toFixed(1)} KB/s`;
        if (opts.unit === "percent") return `${v.toFixed(1)}%`;
        return String(v);
      },
    },
    legend: { top: 0, right: 0, textStyle: { fontSize: 11 } },
    xAxis: {
      type: "category",
      data: opts.xData,
      axisLabel: { fontSize: 10, color: "#687382" },
      axisLine: { lineStyle: { color: "#dfe3e8" } },
    },
    yAxis: yAxes,
    series: opts.series.map((s, idx) => ({
      name: s.name,
      type: "line" as const,
      showSymbol: false,
      smooth: true,
      data: s.data,
      yAxisIndex: s.yAxisIndex || 0,
      lineStyle: { width: 1.5 },
      areaStyle: { opacity: 0.06 },
      markLine:
        idx === 0 && opts.markLine
          ? {
              silent: true,
              symbol: "none",
              lineStyle: { type: "dashed", color: "#94a3b8" },
              data: [{ yAxis: opts.markLine.value, name: opts.markLine.name }],
              label: { formatter: opts.markLine.name, fontSize: 10 },
            }
          : undefined,
    })),
  };
}
