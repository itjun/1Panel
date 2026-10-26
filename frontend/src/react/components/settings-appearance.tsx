import { Check, Monitor, Server, Settings } from "lucide-react";
import { Fragment, useId, useMemo, type CSSProperties } from "react";
import type { EChartsOption } from "echarts";
import type { AppOs } from "@/react/lib/platform";
import { useSettings, type AppearancePref } from "@/react/state/settings";
import { COLOR_PALETTES, paletteTokens, type ColorPaletteId, type ColorTokens, type PaletteMode } from "@/react/lib/color-palettes";
import { ChartHost } from "@/react/components/monitor/charts";
import { ResourceRing } from "@/react/components/ui/resource-ring";
import { Meter } from "@/react/components/ui/meter";

const APPEARANCES: { value: AppearancePref; label: string }[] = [
  { value: "light", label: "浅色" },
  { value: "dark", label: "深色" },
  { value: "system", label: "跟随系统" },
];

export function AppearancePreviews({ os, value, onChange }: {
  os: AppOs; value: AppearancePref; onChange: (value: AppearancePref) => void;
}) {
  const name = useId();
  const settings = useSettings();
  const light = paletteTokens(settings.colorPalette, "light");
  const dark = paletteTokens(settings.colorPalette, "dark");
  return <div className="settings-appearances" role="radiogroup" aria-label="明暗模式" data-os={os}>
    {APPEARANCES.map((appearance) => <label key={appearance.value} className="settings-appearance" data-selected={value === appearance.value || undefined}>
      <input type="radio" name={name} value={appearance.value} checked={value === appearance.value} onChange={() => onChange(appearance.value)} />
      <span className="settings-appearance-frame" aria-hidden="true">
        <PaletteMiniature colors={appearance.value === "dark" ? dark : light} />
        {appearance.value === "system" ? <span className="settings-appearance-half"><PaletteMiniature colors={dark} /></span> : null}
        {value === appearance.value ? <span className="settings-appearance-check"><Check size={12} strokeWidth={2} /></span> : null}
      </span>
      <span>{appearance.label}</span>
    </label>)}
  </div>;
}

/** 使用真实圆环、Meter 和曲线组件，预览与应用共享色值；不嵌入静态概念图。 */
function PaletteMiniature({ colors, mode }: { colors: ColorTokens; mode?: PaletteMode }) {
  const option = useMemo<EChartsOption>(() => ({
    animation: false,
    color: [colors["--color-chart-1"], colors["--color-io-read"]],
    grid: { left: 0, right: 0, top: 3, bottom: 3 },
    xAxis: { type: "category", show: false, boundaryGap: false, data: Array.from({ length: 10 }, (_, i) => i) },
    yAxis: { type: "value", show: false, min: 0, max: 100 },
    series: [[18, 31, 26, 48, 42, 62, 56, 76, 68, 82], [10, 16, 13, 25, 22, 34, 29, 42, 36, 46]].map((data) => ({
      type: "line", data, silent: true, showSymbol: false, smooth: 0.3, lineStyle: { width: 2 },
    })),
  }), [colors]);
  return <span className="palette-miniature" style={colors as CSSProperties} aria-hidden="true">
    <span className="palette-mini-toolbar"><i /><i /><i />{mode ? <span>{mode === "light" ? "浅色" : "深色"}</span> : null}</span>
    <span className="palette-mini-body">
    <span className="palette-mini-rail"><Server size={10} /><Monitor size={10} /><Settings size={10} /></span>
    <span className="palette-mini-sidebar"><span className="palette-mini-selected" /><span /><span /></span>
    <span className="palette-mini-content">
      <span className="palette-mini-title">概览<span className="palette-mini-action" /></span>
      <span className="palette-mini-gauges">
        {[{ label: "CPU", value: 32 }, { label: "内存", value: 68 }, { label: "磁盘", value: 87 }].map(({ label, value }) => <span key={label}>
          <ResourceRing value={value} label={label} valueText={`${value}%`}><strong>{value}</strong></ResourceRing><span>{label}</span>
        </span>)}
      </span>
      <ChartHost option={option} height={28} />
      <span className="palette-mini-progress"><span /></span>
      <Meter value={68} showValue={false} segments={12} />
    </span>
    </span>
  </span>;
}

export function PalettePreviews({ value, onChange }: { value: ColorPaletteId; onChange: (value: ColorPaletteId) => void }) {
  const name = useId();
  return <div className="settings-palettes" role="radiogroup" aria-label="配色风格">
    {COLOR_PALETTES.map((palette, index) => <Fragment key={palette.id}>
      {index === 1 ? <span className="settings-palette-series">马卡龙色系</span> : null}
      <label className="settings-palette" data-default={palette.id === "classic" || undefined} data-selected={value === palette.id || undefined}>
      <input type="radio" name={name} value={palette.id} checked={value === palette.id} onChange={() => onChange(palette.id)} />
      <span className="settings-palette-frame">
        <PaletteMiniature colors={palette.light} mode="light" />
        <PaletteMiniature colors={palette.dark} mode="dark" />
      </span>
      <span className="settings-palette-caption"><span className="settings-palette-name">{palette.name}</span><span className="settings-palette-check" aria-hidden="true">{value === palette.id ? <Check size={12} strokeWidth={2} /> : null}</span></span>
    </label></Fragment>)}
  </div>;
}
