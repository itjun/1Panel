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
import { formatBytes, formatRateKBps } from "@/utils/format";

export interface LineOption {
  xData: string[];
  yData: { name: string; data: (number | null)[] }[];
  formatStr?: string;
  /**
   * tooltip 数值格式化策略：
   * - 默认（不传）：用 formatRateKBps，适合网卡速率（KB/s）
   * - "bytes"：把原始值当字节，格式化为 B/KB/MB/GB，适合内存/堆
   */
  unit?: "bytes" | "rate" | "raw";
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
  const series = (props.option.yData || []).map((item, index) => ({
    name: item.name,
    type: "line" as const,
    showSymbol: false,
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
            const formatted =
              props.option.unit === "bytes"
                ? formatBytes(n)
                : props.option.unit === "raw"
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
        right: 65,
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
      yAxis: {
        name: `( ${props.option.formatStr || "KB/s"} )`,
        nameTextStyle: { color: secondaryText },
        axisLabel: { color: secondaryText },
        splitLine: {
          lineStyle: {
            type: "dashed",
            opacity: isDark() ? 0.1 : 1,
            color: borderColor,
          },
        },
      },
      series,
    },
    true
  );
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
