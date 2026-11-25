import { Check, Monitor, Server, Settings } from "lucide-react";
import { useId, type CSSProperties } from "react";
import type { AppOs } from "@/react/lib/platform";
import type { AppearancePref } from "@/react/state/settings";
import { paletteTokens, type ColorTokens } from "@/react/lib/color-palettes";

const APPEARANCES: { value: AppearancePref; label: string }[] = [
  { value: "system", label: "跟随系统" },
  { value: "light", label: "浅色" },
  { value: "dark", label: "深色" },
];

export function AppearancePreviews({ os, value, onChange }: {
  os: AppOs; value: AppearancePref; onChange: (value: AppearancePref) => void;
}) {
  const name = useId();
  const light = paletteTokens("light");
  const dark = paletteTokens("dark");
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

/** 明暗模式缩略图：只展示壳层结构，颜色来自当前唯一配色。 */
function PaletteMiniature({ colors }: { colors: ColorTokens }) {
  return <span className="palette-miniature" style={colors as CSSProperties} aria-hidden="true">
    <span className="palette-mini-toolbar"><span className="palette-mini-traffic"><i /><i /><i /></span><span className="palette-mini-navigation" /></span>
    <span className="palette-mini-body">
    <span className="palette-mini-rail"><Server size={10} /><Monitor size={10} /><Settings size={10} /></span>
    <span className="palette-mini-sidebar"><span className="palette-mini-selected" /><span /><span /></span>
    <span className="palette-mini-content">
      <span className="palette-mini-title">概览<span className="palette-mini-action" /></span>
    </span>
    </span>
  </span>;
}
