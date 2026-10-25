import { Check, Monitor, Server, Settings } from "lucide-react";
import { useId, useMemo, type CSSProperties } from "react";
import type { EChartsOption } from "echarts";
import type { AppOs } from "@/react/lib/platform";
import type { AppearancePref } from "@/react/state/settings";
import { COLOR_PALETTES, type ColorPaletteId, type ColorTokens } from "@/react/lib/color-palettes";
import { useThemeMode } from "@/react/lib/use-theme-mode";
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
  return <div className="settings-appearances" role="radiogroup" aria-label="明暗模式">
    {APPEARANCES.map((appearance) => <label key={appearance.value} className="settings-appearance" data-selected={value === appearance.value || undefined}>
      <input type="radio" name={name} value={appearance.value} checked={value === appearance.value} onChange={() => onChange(appearance.value)} />
      <span className="settings-appearance-frame" aria-hidden="true">
        <img src={`/settings-previews/${os}-${appearance.value === "dark" ? "dark" : "light"}.png`} alt="" />
        {appearance.value === "system" ? <img className="settings-appearance-half" src={`/settings-previews/${os}-dark.png`} alt="" /> : null}
        {value === appearance.value ? <span className="settings-appearance-check"><Check size={12} strokeWidth={2} /></span> : null}
      </span>
      <span>{appearance.label}</span>
    </label>)}
  </div>;
}

/** 使用真实圆环、Meter 和曲线组件，预览与应用共享色值；不嵌入静态概念图。 */
function PaletteMiniature({ colors }: { colors: ColorTokens }) {
  const option = useMemo<EChartsOption>(() => ({
    animation: false,
    color: [colors["--color-io-read"], colors["--color-io-write"]],
    grid: { left: 0, right: 0, top: 3, bottom: 3 },
    xAxis: { type: "category", show: false, boundaryGap: false, data: Array.from({ length: 10 }, (_, i) => i) },
    yAxis: { type: "value", show: false, min: 0, max: 100 },
    series: [[28, 52, 39, 68, 50, 76, 63, 87, 61, 72], [12, 23, 17, 30, 22, 38, 29, 42, 32, 38]].map((data) => ({
      type: "line", data, silent: true, showSymbol: false, smooth: 0.15, lineStyle: { width: 2 },
    })),
  }), [colors]);
  return <span className="palette-miniature" style={colors as CSSProperties} aria-hidden="true">
    <span className="palette-mini-rail"><Server size={14} /><Monitor size={14} /><Settings size={14} /></span>
    <span className="palette-mini-sidebar"><span className="palette-mini-selected">概览</span><span>监控</span><span>存储</span></span>
    <span className="palette-mini-content">
      <span className="palette-mini-title">主机概览<span className="palette-mini-action">刷新</span></span>
      <span className="palette-mini-gauges">
        {[{ label: "CPU", value: 32 }, { label: "内存", value: 68 }, { label: "磁盘", value: 87 }].map(({ label, value }) => <span key={label}>
          <ResourceRing value={value} label={label} valueText={`${value}%`}><strong>{value}</strong></ResourceRing><span>{label}</span>
        </span>)}
      </span>
      <ChartHost option={option} height={38} />
      <span className="palette-mini-progress"><span>进度</span><span><span /></span></span>
      <Meter value={68} showValue={false} segments={12} />
    </span>
  </span>;
}

export function PalettePreviews({ value, onChange }: { value: ColorPaletteId; onChange: (value: ColorPaletteId) => void }) {
  const name = useId();
  const mode = useThemeMode();
  return <div className="settings-palettes" role="radiogroup" aria-label="配色风格">
    {COLOR_PALETTES.map((palette) => <label key={palette.id} className="settings-palette" data-selected={value === palette.id || undefined}>
      <input type="radio" name={name} value={palette.id} checked={value === palette.id} onChange={() => onChange(palette.id)} />
      <span className="settings-palette-frame">
        <PaletteMiniature colors={palette[mode]} />
      </span>
      <span className="settings-palette-caption"><span className="settings-palette-name">{palette.name}{value === palette.id ? <span className="settings-palette-check" aria-hidden="true"><Check size={12} strokeWidth={2} /></span> : null}</span><span className="settings-palette-swatches" aria-hidden="true">
        {["--color-rail", "--color-accent", "--color-io-read", "--meter-ok", "--meter-warn"].map((token) => <span key={token} style={{ backgroundColor: palette[mode][token as `--${string}`] }} />)}
      </span></span>
    </label>)}
  </div>;
}
