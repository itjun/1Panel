import { useEffect, useRef } from "react";
import echarts from "@/lib/echarts";
import { formatBytes } from "@/lib/utils";

export interface TrafficPoint {
  /** 展示用时间 HH:mm:ss */
  time: string;
  /** 时间戳 ms */
  ts: number;
  /** 上行 KB/s */
  up: number;
  /** 下行 KB/s */
  down: number;
}

interface TrafficChartProps {
  data: TrafficPoint[];
  height?: number;
}

/**
 * 1Panel 监控折线/面积图（源码 Line.vue + home networkChart）
 * 上行 / 下行 顺序与配色对齐官方 seriesStyle
 */
export function TrafficChart({ data, height = 240 }: TrafficChartProps) {
  const domRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = domRef.current;
    if (!el) return;

    let chart = echarts.getInstanceByDom(el);
    if (!chart) chart = echarts.init(el);

    const root = getComputedStyle(document.documentElement);
    const isDark =
      document.documentElement.getAttribute("data-theme") === "dark" ||
      document.documentElement.getAttribute("data-theme") === "midnight" ||
      document.documentElement.getAttribute("data-theme") === "forest";

    const primary =
      root.getPropertyValue("--panel-color-primary").trim() || "#005eeb";
    const primaryLight9 =
      root.getPropertyValue("--panel-color-primary-light-9").trim() ||
      "#e5eefd";
    const regularText =
      root.getPropertyValue("--el-text-color-regular").trim() || "#646a73";
    const secondaryText =
      root.getPropertyValue("--el-text-color-secondary").trim() || "#909399";
    const borderColor =
      root.getPropertyValue("--el-border-color-light").trim() || "#e4e7ed";
    const tooltipBg =
      root.getPropertyValue("--el-bg-color-overlay").trim() || "#ffffff";

    // 1Panel Line.vue seriesStyle：index0 面积=主色渐变；index1 面积=蓝；
    // itemStyle 用 index+2 → 上行绿 / 下行黄
    const areaUp = new echarts.graphic.LinearGradient(0, 0, 0, 1, [
      { offset: 0, color: primaryLight9 },
      { offset: 1, color: primary },
    ]);
    const areaDown = new echarts.graphic.LinearGradient(0, 0, 0, 1, [
      { offset: 0, color: "rgba(0, 94, 235, .3)" },
      { offset: 1, color: "rgba(0, 94, 235, .4)" },
    ]);
    const lineUp = new echarts.graphic.LinearGradient(0, 0, 0, 1, [
      { offset: 0, color: "rgba(27, 143, 60, .3)" },
      { offset: 1, color: "rgba(27, 143, 60, .4)" },
    ]);
    const lineDown = new echarts.graphic.LinearGradient(0, 0, 0, 1, [
      { offset: 0, color: "rgba(249, 199, 79, .3)" },
      { offset: 1, color: "rgba(249, 199, 79, .4)" },
    ]);

    const xData =
      data.length > 0
        ? data.map((d) => d.time)
        : Array.from({ length: 20 }, () => "");
    const upData =
      data.length > 0
        ? data.map((d) => d.up)
        : Array.from({ length: 20 }, () => null);
    const downData =
      data.length > 0
        ? data.map((d) => d.down)
        : Array.from({ length: 20 }, () => null);

    chart.setOption(
      {
        zlevel: 1,
        z: 1,
        tooltip: {
          trigger: "axis",
          backgroundColor: tooltipBg,
          borderColor,
          textStyle: { color: regularText, fontSize: 12 },
          formatter: (datas: unknown) => {
            const list = datas as Array<{
              name: string;
              marker: string;
              seriesName: string;
              data: number | null;
            }>;
            if (!list?.length) return "";
            let res = `${list[0].name}<br/>`;
            for (const item of list) {
              const n = typeof item.data === "number" ? item.data : 0;
              res += `${item.marker} ${item.seriesName}：${formatRate(n)}<br/>`;
            }
            return res;
          },
        },
        grid: { left: 65, right: 65, bottom: "12%", top: 36 },
        legend: {
          top: 0,
          right: 65,
          itemWidth: 8,
          icon: "circle",
          textStyle: { color: regularText, fontSize: 12 },
        },
        xAxis: {
          type: "category",
          data: xData,
          boundaryGap: false,
          axisLabel: { color: secondaryText, fontSize: 11 },
          axisLine: { lineStyle: { color: borderColor } },
          axisTick: { lineStyle: { color: borderColor } },
        },
        yAxis: {
          name: "( KB/s )",
          nameTextStyle: { color: secondaryText, fontSize: 11 },
          axisLabel: {
            color: secondaryText,
            fontSize: 11,
            formatter: (val: number) =>
              val >= 1024 ? `${(val / 1024).toFixed(1)}` : `${val}`,
          },
          splitLine: {
            lineStyle: {
              type: "dashed",
              opacity: isDark ? 0.1 : 1,
              color: borderColor,
            },
          },
        },
        series: [
          {
            name: "上行",
            type: "line",
            showSymbol: false,
            itemStyle: { color: lineUp },
            areaStyle: { color: areaUp },
            data: upData,
          },
          {
            name: "下行",
            type: "line",
            showSymbol: false,
            itemStyle: { color: lineDown },
            areaStyle: { color: areaDown },
            data: downData,
          },
        ],
      },
      true
    );

    const onResize = () => chart?.resize();
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
    };
  }, [data, height]);

  useEffect(() => {
    return () => {
      if (domRef.current) {
        echarts.getInstanceByDom(domRef.current)?.dispose();
      }
    };
  }, []);

  return <div ref={domRef} style={{ width: "100%", height }} />;
}

function formatRate(kbps: number): string {
  if (kbps >= 1024) return `${(kbps / 1024).toFixed(2)} MB/s`;
  if (kbps >= 1) return `${kbps.toFixed(2)} KB/s`;
  return `${(kbps * 1024).toFixed(0)} B/s`;
}

/** 把字节差 + 时间差换算成 KB/s */
export function bytesToKBps(deltaBytes: number, deltaMs: number): number {
  if (deltaMs <= 0 || deltaBytes < 0) return 0;
  return deltaBytes / 1024 / (deltaMs / 1000);
}

/** 格式化瞬时速率展示（输入 B/s） */
export function formatBps(bps: number): string {
  return formatBytes(bps) + "/s";
}
