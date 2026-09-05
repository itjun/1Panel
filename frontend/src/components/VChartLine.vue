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
   * - 默认（不传）：用 formatRateKBps，适合网卡速率（KB/s）；
   *   Y 轴最大值 ≥1024 KB/s 时整轴自动换成 MB/s
   * - "bytes"：原始值当字节；Y 轴按数据最大值自动换成 B/KB/MB/GB
   */
  unit?: LineUnit;
  /** 与 xData 标签对齐的垂线（探活/进程事件） */
  markLines?: { name: string; x: string }[];
  /** 横向参考线（如内存总量） */
  yMarkLine?: { name: string; value: number };
  /** 单轴时的 Y 轴上限（如 CPU% 固定 100） */
  yMax?: number;
}

const props = withDefaults(
  defineProps<{
    height?: string;
    option: LineOption;
    /** echarts.connect 分组名：同组图表 tooltip / dataZoom 联动（监控页多卡同组） */
    connectGroup?: string;
    /** 开启 inside dataZoom（滚轮缩放 + 拖动平移），需配合 connectGroup 同步窗口 */
    zoomable?: boolean;
  }>(),
  { height: "240px" }
);

const el = ref<HTMLDivElement | null>(null);
let chart: echarts.ECharts | null = null;
/** 内容指纹：option 引用每次变，但数据未变时跳过 setOption，避免清掉 connect 轴指针 */
let lastOptionFp = "";

// 隐藏时数据更新只记账不重绘；恢复显示自动补渲染 + 容器尺寸变化自动 resize
const { renderWhenVisible } = useChartVisibility(
  el,
  () => initChart(),
  () => chart?.resize()
);

function isDark() {
  return document.documentElement.classList.contains("dark");
}

/** 只取影响画面的字段做指纹，忽略对象引用差异 */
function optionFingerprint(opt: LineOption): string {
  return JSON.stringify({
    x: opt.xData,
    y: (opt.yData || []).map((s) => ({
      n: s.name,
      d: s.data,
      u: s.unit,
      i: s.yAxisIndex,
    })),
    u: opt.unit,
    f: opt.formatStr,
    ym: opt.yMarkLine,
    ymax: opt.yMax,
    ml: opt.markLines,
    z: props.zoomable ? 1 : 0,
  });
}

function initChart() {
  if (!el.value) return;
  if (!chart) chart = echarts.init(el.value);
  // connect 分组：同组图表 tooltip / dataZoom 动作互相同步。
  // group 赋值后须显式 connect 激活（对同名分组幂等，可重复调用）
  if (props.connectGroup) {
    chart.group = props.connectGroup;
    echarts.connect(props.connectGroup);
  }

  // 数据未变则跳过 setOption：历史模式下内存卡曾因 overview 轮询单独重绘，
  // notMerge 会清掉 axisPointer，表现为「只有内存不联动 / 一会儿消失」
  const fp = optionFingerprint(props.option);
  if (fp === lastOptionFp) return;
  lastOptionFp = fp;
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

  // 第 0 条序列的标线：事件垂线（红虚线，x 轴对齐）+ 可选横向参考线（如内存总量）
  function buildMarkLine(index: number) {
    if (index !== 0) return undefined;
    const lines: Record<string, unknown>[] = [];
    for (const m of props.option.markLines || []) {
      lines.push({ name: m.name, xAxis: m.x });
    }
    const ym = props.option.yMarkLine;
    if (ym) {
      lines.push({ name: ym.name, yAxis: ym.value });
    }
    if (!lines.length) return undefined;
    return {
      symbol: "none",
      silent: true,
      label: { formatter: "{b}", color: secondaryText },
      lineStyle: { type: "dashed", color: danger },
      data: lines,
    };
  }

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
    markLine: buildMarkLine(index),
  }));

  const splitLine = {
    lineStyle: {
      type: "dashed" as const,
      opacity: isDark() ? 0.1 : 1,
      color: borderColor,
    },
  };

  const yAxisBase = (axisSeries: LineSeries[], hideSplit?: boolean) => {
    // 换档基准 = 数据最大值与横向参考线的较大者，保证参考线不出画面
    const scaleMax = Math.max(
      maxSeriesValue(axisSeries),
      props.option.yMarkLine?.value || 0
    );
    const bytesOnly =
      axisSeries.length > 0 &&
      axisSeries.every((s) => (s.unit || props.option.unit) === "bytes");
    if (bytesOnly) {
      const scale = pickByteScale(scaleMax);
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
    // 速率数据（KB/s）：最大值超过 1024 KB/s 时整轴换 MB/s，避免 5,000,000 这类刻度
    const formatStr = props.option.formatStr || "KB/s";
    if (formatStr.includes("KB")) {
      if (scaleMax >= 1024) {
        return {
          name: `( ${formatStr.replace("KB", "MB")} )`,
          nameTextStyle: { color: secondaryText },
          axisLabel: {
            color: secondaryText,
            formatter: (v: number | string) =>
              formatScaledBytes(Number(v), 1024),
          },
          splitLine: hideSplit ? { show: false } : splitLine,
        };
      }
    }
    return {
      name: `( ${formatStr} )`,
      nameTextStyle: { color: secondaryText },
      axisLabel: { color: secondaryText },
      splitLine: hideSplit ? { show: false } : splitLine,
    };
  };

  const dual = yData.some((s) => (s.yAxisIndex || 0) === 1);
  // raw 轴 tooltip 数值后缀（如 %）；与 Y 轴名一致
  const formatStrForTooltip = props.option.formatStr || "";
  // yMax 只作用于单轴场景（如 CPU% 固定 0-100），双轴混轴保持自动缩放
  const axisMax =
    !dual && props.option.yMax != null ? { max: props.option.yMax } : {};
  const yAxis = dual
    ? [
        yAxisBase(yData.filter((s) => (s.yAxisIndex || 0) === 0)),
        yAxisBase(
          yData.filter((s) => (s.yAxisIndex || 0) === 1),
          true
        ),
      ]
    : { ...yAxisBase(yData), ...axisMax };

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
            let formatted: string;
            if (unit === "bytes") {
              formatted = formatBytes(n);
            } else if (unit === "raw") {
              // 原样数值 + 轴单位后缀（如 23.4 %）
              formatted = `${String(Math.round(n * 10) / 10)} ${formatStrForTooltip}`;
            } else {
              formatted = formatRateKBps(n);
            }
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
      ...(props.zoomable
        ? {
            dataZoom: [
              {
                type: "inside",
                xAxisIndex: 0,
                // 触摸板双指滚动在 WebView 里会触发 ctrl+wheel，
                // zoomOnMouseWheel: "shift" 放宽为任意滚轮缩放，拖动平移
                zoomOnMouseWheel: true,
                moveOnMouseWheel: true,
                moveOnMouseMove: true,
              },
            ],
          }
        : {}),
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
  if (chart) {
    // 置空分组再销毁：dispose 会把实例从 connect 联动列表移除
    chart.group = "";
    chart.dispose();
  }
  chart = null;
  lastOptionFp = "";
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
