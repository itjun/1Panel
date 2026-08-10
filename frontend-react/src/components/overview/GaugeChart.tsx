import { useEffect, useId, useRef } from "react";
import echarts from "@/lib/echarts";
import { cn } from "@/lib/utils";

interface GaugeChartProps {
  /** 0–100 */
  value: number;
  /** 中心下方标题（对应 1Panel pie option.title，如 CPU / 负载） */
  title?: string;
  /** 图下方主说明（运行流畅等） */
  label: string;
  /** 图下方副说明 */
  subLabel?: string;
  className?: string;
  height?: number;
}

/**
 * 1Panel 状态环：polar + roundCap bar（源码 Pie.vue）
 * github.com/1Panel-dev/1Panel/frontend/src/components/v-charts/components/Pie.vue
 */
export function GaugeChart({
  value,
  title,
  label,
  subLabel,
  className,
  height = 160,
}: GaugeChartProps) {
  const domRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<ReturnType<typeof echarts.init> | null>(null);
  const rid = useId().replace(/:/g, "");

  const v = Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));
  const fixed = v.toFixed(2);
  const [intPart, decPart = "0"] = fixed.split(".");
  const displayTitle = title ?? label;

  useEffect(() => {
    const el = domRef.current;
    if (!el) return;

    let chart = echarts.getInstanceByDom(el);
    if (!chart) {
      chart = echarts.init(el);
    }
    chartRef.current = chart;

    const root = getComputedStyle(document.documentElement);
    const isDark =
      document.documentElement.getAttribute("data-theme") === "dark" ||
      document.documentElement.getAttribute("data-theme") === "midnight" ||
      document.documentElement.getAttribute("data-theme") === "forest";

    // 与 1Panel Pie.vue getThemeColors 对齐
    const primary =
      root.getPropertyValue("--panel-color-primary").trim() || "#005eeb";
    const primaryLight2 =
      root.getPropertyValue("--panel-color-primary-light-3").trim() ||
      "#4c8ef1";
    const pieBg = isDark ? "#434552" : "#ffffff";
    const textColor = isDark ? "#ffffff" : "#0f0f0f";
    const subtextColor = isDark ? "#BBBFC4" : "#646A73";
    const shadowColor = isDark ? "#16191D" : "rgba(0, 94, 235, 0.1)";
    const backgroundStyleColor = isDark
      ? "rgba(255, 255, 255, 0.05)"
      : "rgba(0, 94, 235, 0.05)";

    chart.setOption(
      {
        title: [
          {
            text: `{a|${intPart}.}{b|${decPart} %}`,
            textStyle: {
              rich: {
                a: { fontSize: 22 },
                b: { fontSize: 14, padding: [5, 0, 0, 0] },
              },
              color: textColor,
              lineHeight: 25,
              fontWeight: 500,
            },
            left: "49%",
            top: "32%",
            subtext: displayTitle,
            subtextStyle: {
              color: subtextColor,
              fontSize: 13,
            },
            textAlign: "center",
          },
        ],
        polar: {
          radius: ["71%", "80%"],
          center: ["50%", "50%"],
        },
        angleAxis: {
          max: 100,
          show: false,
        },
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
              color: backgroundStyleColor,
            },
            color: [
              new echarts.graphic.LinearGradient(0, 1, 0, 0, [
                { offset: 0, color: primaryLight2 },
                { offset: 1, color: primary },
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
            color: pieBg,
            data: [
              {
                value: 0,
                itemStyle: {
                  shadowColor,
                  shadowBlur: 5,
                },
              },
            ],
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
  }, [v, intPart, decPart, displayTitle, rid]);

  useEffect(() => {
    return () => {
      if (domRef.current) {
        echarts.getInstanceByDom(domRef.current)?.dispose();
      }
      chartRef.current = null;
    };
  }, []);

  return (
    <div className={cn("flex w-full flex-col items-center", className)}>
      <div ref={domRef} className="w-full" style={{ height }} />
      {subLabel && (
        <div className="input-help max-w-[160px] truncate text-center text-[12px] text-[#646A73]">
          {subLabel}
        </div>
      )}
    </div>
  );
}
