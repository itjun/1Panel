import type { RefObject } from "react";
import type { SettingsSection } from "@/react/state/session";
import { useSectionScroll } from "@/react/lib/use-section-scroll";
import { setSettingsReadingSection, subscribeSettingsNavigation } from "@/react/state/settings-navigation";

const settingsScroll = {
  attribute: "data-settings-section",
  firstSection: "look",
  setReadingSection: setSettingsReadingSection,
  subscribeNavigation: subscribeSettingsNavigation,
} as const;

export function useSettingsScroll(documentRef: RefObject<HTMLDivElement | null>, section: SettingsSection) {
  useSectionScroll(documentRef, section, settingsScroll);
}
