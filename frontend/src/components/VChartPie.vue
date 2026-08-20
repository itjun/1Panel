<template>
  <div
    ref="el"
    class="v-chart-pie"
    :style="{ height, width: '100%', maxWidth: '100%', minWidth: 0 }"
  />
</template>

<script setup lang="ts">
/**
 * 1Panel 状态环：polar + roundCap bar
 * 源：1Panel/frontend/src/components/v-charts/components/Pie.vue
 */
import { onBeforeUnmount, onMounted, ref, watch, nextTick } from "vue";
import echarts from "@/utils/echarts";
import { useChartVisibility } from "@/composables/useChartVisibility";

const props = defineProps<{
  id?: string;
  height?: string;
  option: { title: string; data: number };
}>();

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

function getThemeColors() {
  const root = getComputedStyle(document.documentElement);
  return {
    primaryLight2:
      root.getPropertyValue("--panel-color-primary-light-3").trim() ||
      "#4c8ef1",
    primaryLight1:
      root.getPropertyValue("--panel-color-primary").trim() || "#005eeb",
    pieBgColor: isDark() ? "#434552" : "#ffffff",
    textColor: isDark() ? "#ffffff" : "#0f0f0f",
    subtextColor: isDark() ? "#BBBFC4" : "#646A73",
    shadowColor: isDark() ? "#16191D" : "rgba(0, 94, 235, 0.1)",
    backgroundStyleColor: isDark()
      ? "rgba(255, 255, 255, 0.05)"
      : "rgba(0, 94, 235, 0.05)",
  };
}

function initChart() {
  if (!el.value) return;
  if (!chart) chart = echarts.init(el.value);
  const v = Math.max(0, Math.min(100, Number(props.option.data) || 0));
  const percentText = v.toFixed(2).split(".");
  const c = getThemeColors();
  chart.setOption(
    {
      title: [
        {
          text: `{a|${percentText[0]}.}{b|${percentText[1] || 0} %}`,
          textStyle: {
            rich: {
              a: { fontSize: "22" },
              b: { fontSize: "14", padding: [5, 0, 0, 0] },
            },
            color: c.textColor,
            lineHeight: 25,
            fontWeight: 500,
          },
          left: "49%",
          top: "32%",
          subtext: props.option.title,
          subtextStyle: { color: c.subtextColor, fontSize: 13 },
          textAlign: "center",
        },
      ],
      polar: { radius: ["71%", "80%"], center: ["50%", "50%"] },
      angleAxis: { max: 100, show: false },
      radiusAxis: {
        type: "category",
        show: true,
        axisLabel: { show: false },
        axisLine: { show: false },
        axisTick: { show: false },
      },
      series: [
        {
          type: "bar",
          roundCap: true,
          barWidth: 30,
          showBackground: true,
          coordinateSystem: "polar",
          backgroundStyle: { color: c.backgroundStyleColor },
          color: [
            new echarts.graphic.LinearGradient(0, 1, 0, 0, [
              { offset: 0, color: c.primaryLight2 },
              { offset: 1, color: c.primaryLight1 },
            ]),
          ],
          label: { show: false },
          data: [v],
        },
        {
          type: "pie",
          radius: ["0%", "60%"],
          center: ["50%", "50%"],
          label: { show: false },
          color: c.pieBgColor,
          data: [
            {
              value: 0,
              itemStyle: { shadowColor: c.shadowColor, shadowBlur: 5 },
            },
          ],
        },
      ],
    },
    true
  );
}

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
.v-chart-pie {
  box-sizing: border-box;
  max-width: 100%;
  min-width: 0;
  overflow: hidden;
}
</style>
