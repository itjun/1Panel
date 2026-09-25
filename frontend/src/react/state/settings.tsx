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

export type AlertContentKind = ResourceAlertKind | "app" | "cert";
export type NotifyContentField =
  | "hostName"
  | "metric"
  | "threshold"
  | "value"
  | "service";

export type AppSettings = {
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

function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...SETTINGS_DEFAULTS };
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    return {
      ...SETTINGS_DEFAULTS,
      ...parsed,
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

function applyTypography(settings: AppSettings) {
  const root = document.documentElement;
  root.classList.remove("dark");
  root.classList.add("light");
  root.style.colorScheme = "light";
  root.style.background = "var(--color-canvas)";
  root.style.setProperty("--app-font-family", settings.fontFamily);
  root.style.setProperty("--app-font-size", `${settings.fontSize}px`);
  document.body.style.fontFamily = settings.fontFamily;
  document.body.style.fontSize = `${settings.fontSize}px`;
}

function emit() {
  applyTypography(current);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
  listeners.forEach((listener) => listener());
  void api.setThemeAppearance("light").catch(() => {});
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

applyTypography(current);
void api.setThemeAppearance("light").catch(() => {});
