import { useSyncExternalStore } from "react";
import { api } from "@/api";
import { ALL_ALERT_KINDS, type ResourceAlertKind } from "@/utils/alerts";

const STORAGE_KEY = "ipannel.settings.v1";

export const FONT_OPTIONS: { label: string; value: string }[] = [
  {
    label: "1Panel 默认",
    value:
      '"Helvetica Neue", Helvetica, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", Arial, sans-serif',
  },
  {
    label: "系统默认（SF Pro）",
    value:
      '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", "PingFang SC", sans-serif',
  },
  {
    label: "中文：苹方",
    value: '"PingFang SC", "Helvetica Neue", "Microsoft YaHei", sans-serif',
  },
  {
    label: "中文：微软雅黑",
    value: '"Microsoft YaHei", "PingFang SC", "Helvetica Neue", sans-serif',
  },
  {
    label: "等宽：Menlo",
    value: 'Menlo, Monaco, "SF Mono", "Courier New", monospace',
  },
];

export type AppearancePref = "light" | "dark" | "system";
export type ResolvedAppearance = "light" | "dark";

export type AlertContentKind = ResourceAlertKind | "app" | "cert";
export type NotifyContentField =
  | "hostName"
  | "metric"
  | "threshold"
  | "value"
  | "service";

export type AppSettings = {
  appearance: AppearancePref;
  fontFamily: string;
  fontSize: number;
  startupPage: "home" | "resume";
  notifyEnabled: boolean;
  wecomWebhook: string;
  systemNotifyEnabled: boolean;
  inAppNotifyEnabled: boolean;
  alertContentKinds: AlertContentKind[];
  notifyRecoverEnabled: boolean;
  notifyContentFields: NotifyContentField[];
  hostResourceNotifySubs: Record<string, ResourceAlertKind[]>;
  hostAppNotifySubs: Record<string, string[]>;
  hostCertNotifySubs: Record<string, boolean>;
};

export const SETTINGS_DEFAULTS: AppSettings = {
  appearance: "light",
  fontFamily: FONT_OPTIONS[0].value,
  fontSize: 14,
  startupPage: "home",
  notifyEnabled: false,
  wecomWebhook: "",
  systemNotifyEnabled: true,
  inAppNotifyEnabled: true,
  alertContentKinds: [...ALL_ALERT_KINDS, "app", "cert"],
  notifyRecoverEnabled: true,
  notifyContentFields: ["hostName", "metric", "threshold", "value", "service"],
  hostResourceNotifySubs: {},
  hostAppNotifySubs: {},
  hostCertNotifySubs: {},
};

let current = loadSettings();
const listeners = new Set<() => void>();
let mediaQuery: MediaQueryList | null = null;
let mediaListener: (() => void) | null = null;

function parseAppearance(value: unknown): AppearancePref {
  if (value === "light" || value === "dark" || value === "system") {
    return value;
  }
  return SETTINGS_DEFAULTS.appearance;
}

function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...SETTINGS_DEFAULTS };
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    return {
      ...SETTINGS_DEFAULTS,
      ...parsed,
      appearance: parseAppearance(parsed.appearance),
      alertContentKinds:
        parsed.alertContentKinds || SETTINGS_DEFAULTS.alertContentKinds,
      notifyContentFields:
        parsed.notifyContentFields || SETTINGS_DEFAULTS.notifyContentFields,
      hostResourceNotifySubs: parsed.hostResourceNotifySubs || {},
      hostAppNotifySubs: parsed.hostAppNotifySubs || {},
      hostCertNotifySubs: parsed.hostCertNotifySubs || {},
    };
  } catch {
    return { ...SETTINGS_DEFAULTS };
  }
}

export function resolveAppearance(pref: AppearancePref): ResolvedAppearance {
  if (pref === "light" || pref === "dark") {
    return pref;
  }
  if (typeof window === "undefined" || !window.matchMedia) {
    return "light";
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

/** 把偏好映射到原生窗口外观 API（跟随系统用 auto）。 */
export function appearanceToNativeMode(pref: AppearancePref): string {
  if (pref === "system") {
    return "auto";
  }
  return pref;
}

export function applyAppearanceToDocument(
  appearance: AppearancePref,
  fontFamily?: string,
  fontSize?: number,
) {
  const root = document.documentElement;
  const resolved = resolveAppearance(appearance);
  root.classList.remove("light", "dark");
  root.classList.add(resolved);
  root.style.colorScheme = resolved;
  root.style.background = "var(--color-canvas)";
  if (typeof fontFamily === "string" && fontFamily) {
    root.style.setProperty("--app-font-family", fontFamily);
    document.body.style.fontFamily = fontFamily;
  }
  if (typeof fontSize === "number" && Number.isFinite(fontSize)) {
    root.style.setProperty("--app-font-size", `${fontSize}px`);
    document.body.style.fontSize = `${fontSize}px`;
  }
}

function stopSystemAppearanceWatch() {
  if (mediaQuery && mediaListener) {
    mediaQuery.removeEventListener("change", mediaListener);
  }
  mediaQuery = null;
  mediaListener = null;
}

function syncSystemAppearanceWatch(pref: AppearancePref) {
  stopSystemAppearanceWatch();
  if (pref !== "system" || typeof window === "undefined" || !window.matchMedia) {
    return;
  }
  mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
  mediaListener = () => {
    applyAppearanceToDocument(
      current.appearance,
      current.fontFamily,
      current.fontSize,
    );
  };
  mediaQuery.addEventListener("change", mediaListener);
}

function applySettings(settings: AppSettings) {
  applyAppearanceToDocument(
    settings.appearance,
    settings.fontFamily,
    settings.fontSize,
  );
  syncSystemAppearanceWatch(settings.appearance);
}

function emit() {
  applySettings(current);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
  listeners.forEach((listener) => listener());
  void api
    .setThemeAppearance(appearanceToNativeMode(current.appearance))
    .catch(() => {});
  void api
    .setNotifySubs({
      fromDisk: true,
      notifyEnabled: current.notifyEnabled,
      wecomWebhook: current.wecomWebhook,
      systemNotifyEnabled: current.systemNotifyEnabled,
      inAppNotifyEnabled: current.inAppNotifyEnabled,
      alertContentKinds: current.alertContentKinds,
      notifyRecoverEnabled: current.notifyRecoverEnabled,
      notifyContentFields: current.notifyContentFields,
      hostResourceNotifySubs: current.hostResourceNotifySubs,
      hostAppNotifySubs: current.hostAppNotifySubs,
      hostCertNotifySubs: current.hostCertNotifySubs,
      certKindMigrated: true,
    })
    .catch(() => {});
}

export function updateSettings(patch: Partial<AppSettings>) {
  current = { ...current, ...patch };
  if (patch.appearance !== undefined) {
    current.appearance = parseAppearance(patch.appearance);
  }
  emit();
}

export function resetSettings() {
  current = { ...SETTINGS_DEFAULTS };
  emit();
}

export function readSettings(): AppSettings {
  return current;
}

export function useSettings() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => current,
  );
}

applySettings(current);
void api
  .setThemeAppearance(appearanceToNativeMode(current.appearance))
  .catch(() => {});
