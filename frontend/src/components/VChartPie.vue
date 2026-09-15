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
  /** 告警态：圆环与中心百分比改用危险色 */
  danger?: boolean;
}>();

const el = ref<HTMLDivElement | null>(null);
let chart: echarts.ECharts | null = null;

// 隐藏时数据更新只记账不重绘；恢复显示自动补渲染 + 容器尺寸变化自动 resize；
// 长期隐藏（60s）自动 dispose 释放 canvas 内存，恢复时由 initChart 重建重画
const { renderWhenVisible } = useChartVisibility(
  el,
  () => initChart(),
  () => chart?.resize(),
  () => {
    chart?.dispose();
    chart = null;
  }
);

function isDark() {
  return document.documentElement.classList.contains("dark");
}

function getThemeColors() {
  const root = getComputedStyle(document.documentElement);
  const get = (name: string, fallback: string) =>
    root.getPropertyValue(name).trim() || fallback;
  return {
    primaryLight2: get("--m3-primary", "#6750a4"),
    primaryLight1: get("--m3-primary", "#6750a4"),
    pieBgColor: get("--m3-surface-container-lowest", "#ffffff"),
    textColor: get("--m3-on-surface", "#1d1b20"),
    subtextColor: get("--m3-on-surface-variant", "#49454f"),
    // 环形图轨迹槽：中性灰（surface-container-highest），非紫色
    trackColor: get("--m3-surface-container-highest", "#e6e5ea"),
    shadowColor: isDark() ? "#131316" : "rgba(0, 0, 0, 0.08)",
    backgroundStyleColor: get("--m3-surface-container-highest", "#e6e5ea"),
    danger: get("--m3-error", "#b3261e"),
    dangerLight: get("--m3-error", "#b3261e"),
    dangerShadow: "rgba(179, 38, 30, 0.15)",
    dangerBg: get("--m3-surface-container-highest", "#e6e5ea"),
  };
}

function initChart() {
  if (!el.value) return;
  if (!chart) chart = echarts.init(el.value);
  const raw = Math.max(0, Number(props.option.data) || 0);
  // 中心文案可 >100%（负载过载）；圆环仍按满圈封顶，避免极坐标溢出
  const arc = Math.min(100, raw);
  const percentText = raw.toFixed(2).split(".");
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
            color: props.danger ? c.danger : c.textColor,
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
          backgroundStyle: {
            color: c.backgroundStyleColor,
          },
          // M3：纯色数值弧，不用渐变
          color: [props.danger ? c.danger : c.primaryLight2],
          label: { show: false },
          data: [arc],
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
              itemStyle: {
                shadowColor: props.danger ? c.dangerShadow : c.shadowColor,
                shadowBlur: 5,
              },
            },
          ],
        },
      ],
    },
    true
  );
}

watch(
  () => [props.option, props.danger],
  () => nextTick(renderWhenVisible)
);

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
