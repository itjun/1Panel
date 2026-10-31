import { SETTINGS_SECTIONS } from "@/react/lib/settings-model";
import { useSession } from "@/react/state/session";

export function SettingsNavigation() {
  const session = useSession();
  const active = session.settingsSection;
  return <nav className="settings-navigation" aria-label="设置目录">
    {SETTINGS_SECTIONS.map((item) => <button
      type="button" key={item.id}
      data-rail-key={`settings:${item.id}`}
      aria-current={active === item.id ? "page" : undefined}
      aria-controls={active === item.id ? `settings-${item.id}` : undefined}
      onClick={() => session.setSettingsSection(item.id)}
    >{item.label}</button>)}
  </nav>;
}
