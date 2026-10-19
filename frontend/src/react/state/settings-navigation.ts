import { useSyncExternalStore } from "react";
import type { SettingsSection } from "@/react/state/session";

// Reading position is transient UI state. It must not add entries to page history.
let active: SettingsSection | null = null;
const listeners = new Set<() => void>();
const requests = new Set<(section: SettingsSection) => void>();

export function setSettingsReadingSection(section: SettingsSection | null) {
  if (active === section) return;
  active = section;
  listeners.forEach((listener) => listener());
}

export function useSettingsReadingSection(fallback: SettingsSection) {
  return useSyncExternalStore(
    (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    () => active ?? fallback,
  );
}

/** An explicit request also handles clicking the already-selected history entry. */
export function requestSettingsSection(section: SettingsSection) {
  requests.forEach((request) => request(section));
}

export function subscribeSettingsNavigation(request: (section: SettingsSection) => void) {
  requests.add(request);
  return () => { requests.delete(request); };
}
