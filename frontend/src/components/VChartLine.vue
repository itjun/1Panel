<template>
  <div
    ref="el"
    class="v-chart-line"
    :style="{ height, width: '100%', maxWidth: '100%', minWidth: 0 }"
  />
</template>

<script setup lang="ts">
/**
 * 1Panel 监控折线：源 Line.vue
 */
import { onBeforeUnmount, onMounted, ref, watch, nextTick } from "vue";
import echarts from "@/utils/echarts";
import { useChartVisibility } from "@/composables/useChartVisibility";
import {
  formatBytes,
  formatRateKBps,
  formatScaledBytes,
  pickByteScale,
} from "@/utils/format";

export type LineUnit = "bytes" | "rate" | "raw";

export interface LineSeries {
  name: string;
  data: (number | null)[];
  /** 覆盖 option.unit，用于混轴（如 CPU% + 内存字节） */
  unit?: LineUnit;
  yAxisIndex?: number;
}

export interface LineOption {
  xData: string[];
  yData: LineSeries[];
  formatStr?: string;
  /**
   * tooltip / 默认 Y 轴格式化：
   * - 默认（不传）：用 formatRateKBps，适合网卡速率（KB/s）
   * - "bytes"：原始值当字节；Y 轴按数据最大值自动换成 B/KB/MB/GB
   */
  unit?: LineUnit;
  /** 与 xData 标签对齐的垂线（探活/进程事件） */
  markLines?: { name: string; x: string }[];
}

const props = withDefaults(
  defineProps<{
    height?: string;
    option: LineOption;
  }>(),
  { height: "240px" }
);

const el = ref<HTMLDivElement | null>(null);
let chart: echarts.ECharts | null = null;

// 隐藏时数据更新只记账不重绘；恢复显示自动补渲染 + 容器尺寸变化自动 resize
const { renderWhenVisible } = useChartVisibility(
  el,
  () => initChart(),
  () => chart?.resize()
);

function isDark() {
  return document.documentElement.classList.contains("dark");
}

function initChart() {
  if (!el.value) return;
  if (!chart) chart = echarts.init(el.value);
  const root = getComputedStyle(document.documentElement);
  const get = (name: string, fallback: string) =>
    root.getPropertyValue(name).trim() || fallback;
  const primary = get("--m3-primary", "#6750a4");
  const secondary = get("--m3-secondary", "#625b71");
  const tertiary = get("--m3-tertiary", "#7d5260");
  const regularText = get("--m3-on-surface-variant", "#49454f");
  const secondaryText = get("--m3-on-surface-variant", "#49454f");
  const borderColor = get("--m3-outline-variant", "#cac4d0");
  const tooltipBg = get("--m3-surface-container-lowest", "#ffffff");
  const danger = get("--m3-error", "#b3261e");

  // M3 图表惯例：细实线 + 低透明度面积（禁大面积渐变紫墙）
  // 线色用 primary/secondary/tertiary 区分序列，面积统一 10% 透明度
  const seriesStyle = [
    primary,
    secondary,
    tertiary,
    get("--m3-outline", "#79747e"),
  ];
  const seriesColor = (index: number) => seriesStyle[index] || seriesStyle[0];

  const xData =
    props.option.xData?.length > 0
      ? props.option.xData
      : Array.from({ length: 20 }, () => "");
  const yData = props.option.yData || [];
  const series = yData.map((item, index) => ({
    name: item.name,
    type: "line" as const,
    showSymbol: false,
    yAxisIndex: item.yAxisIndex || 0,
    lineStyle: { width: 1.5 },
    itemStyle: { color: seriesColor(index) },
    areaStyle: {
      color: seriesColor(index),
      opacity: 0.1,
    },
    data:
      item.data?.length > 0
        ? item.data
        : Array.from({ length: 20 }, () => null),
    markLine:
      index === 0 && (props.option.markLines?.length || 0) > 0
        ? {
            symbol: "none",
            label: { formatter: "{b}", color: secondaryText },
            lineStyle: { type: "dashed", color: danger },
            data: (props.option.markLines || []).map((m) => ({
              name: m.name,
              xAxis: m.x,
            })),
          }
        : undefined,
  }));

  const splitLine = {
    lineStyle: {
      type: "dashed" as const,
      opacity: isDark() ? 0.1 : 1,
      color: borderColor,
    },
  };

  const yAxisBase = (axisSeries: LineSeries[], hideSplit?: boolean) => {
    const bytesOnly =
      axisSeries.length > 0 &&
      axisSeries.every((s) => (s.unit || props.option.unit) === "bytes");
    if (bytesOnly) {
      const scale = pickByteScale(maxSeriesValue(axisSeries));
      return {
        name: `( ${scale.unit} )`,
        nameTextStyle: { color: secondaryText },
        axisLabel: {
          color: secondaryText,
          formatter: (v: number | string) =>
            formatScaledBytes(Number(v), scale.divisor),
        },
        splitLine: hideSplit ? { show: false } : splitLine,
      };
    }
    return {
      name: `( ${props.option.formatStr || "KB/s"} )`,
      nameTextStyle: { color: secondaryText },
      axisLabel: { color: secondaryText },
      splitLine: hideSplit ? { show: false } : splitLine,
    };
  };

  const dual = yData.some((s) => (s.yAxisIndex || 0) === 1);
  const yAxis = dual
    ? [
        yAxisBase(yData.filter((s) => (s.yAxisIndex || 0) === 0)),
        yAxisBase(
          yData.filter((s) => (s.yAxisIndex || 0) === 1),
          true
        ),
      ]
    : yAxisBase(yData);

  chart.setOption(
    {
      tooltip: {
        trigger: "axis",
        backgroundColor: tooltipBg,
        borderColor,
        textStyle: { color: regularText },
        formatter(datas: any) {
          if (!datas?.length) return "";
          let res = datas[0].name + "<br/>";
          for (const item of datas) {
            const n = typeof item.data === "number" ? item.data : 0;
            const s = yData[item.seriesIndex as number];
            const unit = s?.unit || props.option.unit;
            const formatted =
              unit === "bytes"
                ? formatBytes(n)
                : unit === "raw"
                  ? String(Math.round(n * 10) / 10)
                  : formatRateKBps(n);
            res +=
              item.marker +
              " " +
              item.seriesName +
              "：" +
              formatted +
              "<br/>";
          }
          return res;
        },
      },
      grid: { left: 65, right: 65, bottom: "12%", top: 36 },
      legend: {
        top: 0,
        ...(dual ? { left: "center" } : { right: 65 }),
        itemWidth: 8,
        icon: "circle",
        textStyle: { color: regularText },
      },
      color: seriesStyle,
      xAxis: {
        type: "category",
        data: xData,
        boundaryGap: false,
        axisLabel: { color: secondaryText },
        axisLine: { lineStyle: { color: borderColor } },
      },
      yAxis,
      series,
    },
    true
  );
}

function maxSeriesValue(seriesList: LineSeries[]): number {
  let max = 0;
  for (const s of seriesList) {
    for (const v of s.data || []) {
      if (typeof v === "number" && Number.isFinite(v) && v > max) max = v;
    }
  }
  return max;
}

// option 是 computed 每次返回新引用，浅比较足够
watch(() => props.option, () => nextTick(renderWhenVisible));

onMounted(() => {
  // 挂载时若处于隐藏（v-show 藏起）则不 init，等恢复显示由 RO 触发
  nextTick(renderWhenVisible);
});

onBeforeUnmount(() => {
  chart?.dispose();
  chart = null;
});
</script>

<style scoped>
.v-chart-line {
  box-sizing: border-box;
  max-width: 100%;
  min-width: 0;
  overflow: hidden;
}
</style>
