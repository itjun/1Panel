import { SETTINGS_SECTIONS } from "@/react/lib/settings-model";
import { useSession } from "@/react/state/session";
import { requestSettingsSection, useSettingsReadingSection } from "@/react/state/settings-navigation";

export function SettingsNavigation() {
  const session = useSession();
  const active = useSettingsReadingSection(session.settingsSection);
  return <nav className="settings-navigation" aria-label="设置目录">
    {SETTINGS_SECTIONS.map((item) => <button
      type="button" key={item.id}
      aria-current={active === item.id ? "location" : undefined}
      aria-controls={`settings-${item.id}`}
      onClick={() => {
        session.setSettingsSection(item.id);
        requestSettingsSection(item.id);
      }}
    >{item.label}</button>)}
  </nav>;
}
