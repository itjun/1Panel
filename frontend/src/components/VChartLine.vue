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
import { formatRateKBps } from "@/utils/format";

export interface LineOption {
  xData: string[];
  yData: { name: string; data: (number | null)[] }[];
  formatStr?: string;
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

function isDark() {
  return document.documentElement.classList.contains("dark");
}

function initChart() {
  if (!el.value) return;
  if (!chart) chart = echarts.init(el.value);
  const root = getComputedStyle(document.documentElement);
  const primary =
    root.getPropertyValue("--panel-color-primary").trim() || "#005eeb";
  const primaryLight9 =
    root.getPropertyValue("--panel-color-primary-light-9").trim() || "#e5eefd";
  const regularText =
    root.getPropertyValue("--el-text-color-regular").trim() || "#646a73";
  const secondaryText =
    root.getPropertyValue("--el-text-color-secondary").trim() || "#909399";
  const borderColor =
    root.getPropertyValue("--el-border-color-light").trim() || "#e4e7ed";
  const tooltipBg =
    root.getPropertyValue("--el-bg-color-overlay").trim() || "#ffffff";

  // 与 1Panel Line.vue seriesStyle 对齐
  const seriesStyle = [
    {
      color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
        { offset: 0, color: primaryLight9 },
        { offset: 1, color: primary },
      ]),
    },
    {
      color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
        { offset: 0, color: "rgba(0, 94, 235, .3)" },
        { offset: 1, color: "rgba(0, 94, 235, .4)" },
      ]),
    },
    {
      color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
        { offset: 0, color: "rgba(27, 143, 60, .3)" },
        { offset: 1, color: "rgba(27, 143, 60, .4)" },
      ]),
    },
    {
      color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
        { offset: 0, color: "rgba(249, 199, 79, .3)" },
        { offset: 1, color: "rgba(249, 199, 79, .4)" },
      ]),
    },
  ];

  const xData =
    props.option.xData?.length > 0
      ? props.option.xData
      : Array.from({ length: 20 }, () => "");
  const series = (props.option.yData || []).map((item, index) => ({
    name: item.name,
    type: "line" as const,
    showSymbol: false,
    itemStyle: seriesStyle[index + 2] || seriesStyle[2],
    areaStyle: seriesStyle[index] || seriesStyle[0],
    data:
      item.data?.length > 0
        ? item.data
        : Array.from({ length: 20 }, () => null),
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
            res +=
              item.marker +
              " " +
              item.seriesName +
              "：" +
              formatRateKBps(n) +
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

function onResize() {
  chart?.resize();
}

watch(
  () => props.option,
  () => nextTick(initChart),
  { deep: true }
);

onMounted(() => {
  nextTick(() => {
    initChart();
    window.addEventListener("resize", onResize);
  });
});

onBeforeUnmount(() => {
  window.removeEventListener("resize", onResize);
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
