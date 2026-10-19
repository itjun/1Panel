import { Check } from "lucide-react";
import { useId } from "react";
import type { AppOs } from "@/react/lib/platform";
import type { AppearancePref } from "@/react/state/settings";

const APPEARANCES: { value: AppearancePref; label: string }[] = [
  { value: "light", label: "浅色" },
  { value: "dark", label: "深色" },
  { value: "system", label: "跟随系统" },
];

export function AppearancePreviews({ os, value, onChange }: {
  os: AppOs; value: AppearancePref; onChange: (value: AppearancePref) => void;
}) {
  const name = useId();
  return <div className="settings-appearances" role="radiogroup" aria-label="主题外观">
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
