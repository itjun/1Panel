import { useSyncExternalStore } from "react";
import { api } from "@/api";
import {
  ALL_ALERT_KINDS,
  normalizeAlertLevels,
  type AlertStartLevel,
  type LoadWindow,
  type ResourceAlertKind,
} from "@/utils/alerts";

const STORAGE_KEY = "ipannel.settings.v1";

/**
 * 字体值的约定见 lib/fonts.ts：空串 = 系统默认（不写覆盖变量，globals.css 回落到 --font-sans / --font-mono）。
 * 下面两串是历史版本的「默认」选项值，读取旧配置时视为「从未改过字体」，迁到空串。
 */
const LEGACY_DEFAULT_FONT =
  '"Helvetica Neue", Helvetica, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", Arial, sans-serif';
const LEGACY_SYSTEM_FONT =
  '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", "PingFang SC", sans-serif';

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
  /** 界面字体：菜单、侧栏、按钮、主机名、表格普通文字等；空串 = 系统默认 */
  fontFamily: string;
  /** 等宽字体：IP、版本号、数值、路径、日志、配置编辑器；空串 = 系统默认 */
  monoFontFamily: string;
  fontSize: number;
  startupPage: "home" | "resume";
  notifyEnabled: boolean;
  wecomWebhook: string;
  systemNotifyEnabled: boolean;
  inAppNotifyEnabled: boolean;
  alertContentKinds: AlertContentKind[];
  notifyRecoverEnabled: boolean;
  /** 每类资源指标订阅的档位（可同时订阅警告和危险）；两档都订时，升到危险档再推一次 */
  alertLevels: Record<ResourceAlertKind, AlertStartLevel[]>;
  /** 连续几次采样都达到该档才推送（回落同理），每次 5 秒 */
  alertSustain: number;
  /** 告警未回落时每隔几分钟重复提醒；0 = 不重复 */
  alertRepeatMinutes: number;
  /** 负载告警取哪个平均窗口 */
  alertLoadWindow: LoadWindow;
  notifyContentFields: NotifyContentField[];
  hostResourceNotifySubs: Record<string, ResourceAlertKind[]>;
  hostAppNotifySubs: Record<string, string[]>;
  hostCertNotifySubs: Record<string, boolean>;
  /** 首页主机列表的分组排布：每排一组 group id，从上到下、从左到右 */
  hostHomeRows: string[][];
  /** Windows 终端打开方式：tab=最近使用的 Terminal 窗口新标签页（默认），window=新窗口 */
  terminalOpenMode: "tab" | "window";
};

export const SETTINGS_DEFAULTS: AppSettings = {
  appearance: "light",
  fontFamily: "",
  monoFontFamily: "",
  fontSize: 14,
  startupPage: "home",
  notifyEnabled: false,
  wecomWebhook: "",
  systemNotifyEnabled: true,
  inAppNotifyEnabled: true,
  alertContentKinds: [...ALL_ALERT_KINDS, "app", "cert"],
  notifyRecoverEnabled: true,
  alertLevels: {
    cpu: ["danger"],
    mem: ["danger"],
    disk: ["danger"],
    load: ["danger"],
    net: ["danger"],
    diskio: ["danger"],
  },
  alertSustain: 1,
  alertRepeatMinutes: 0,
  alertLoadWindow: "load1",
  notifyContentFields: ["hostName", "metric", "threshold", "value", "service"],
  hostResourceNotifySubs: {},
  hostAppNotifySubs: {},
  hostCertNotifySubs: {},
  hostHomeRows: [],
  terminalOpenMode: "tab",
};

export const ALERT_SUSTAIN_RANGE = { min: 1, max: 12 } as const;
export const ALERT_REPEAT_RANGE = { min: 0, max: 1440 } as const;

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

function parseHostHomeRows(value: unknown): string[][] {
  if (!Array.isArray(value)) return [];
  const rows: string[][] = [];
  for (const row of value) {
    if (!Array.isArray(row)) continue;
    rows.push(row.filter((id): id is string => typeof id === "string"));
  }
  return rows;
}

function parseAlertLevels(value: unknown): AppSettings["alertLevels"] {
  const out = { ...SETTINGS_DEFAULTS.alertLevels };
  if (!value || typeof value !== "object") return out;
  const raw = value as Record<string, unknown>;
  for (const kind of ALL_ALERT_KINDS) out[kind] = normalizeAlertLevels(raw[kind]);
  return out;
}

function clampInt(value: unknown, range: { min: number; max: number }, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(Math.max(Math.round(value), range.min), range.max);
}

function parseLoadWindow(value: unknown): LoadWindow {
  return value === "load5" || value === "load15" ? value : "load1";
}

function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...SETTINGS_DEFAULTS };
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    let fontFamily = SETTINGS_DEFAULTS.fontFamily;
    if (
      typeof parsed.fontFamily === "string" &&
      parsed.fontFamily !== LEGACY_DEFAULT_FONT &&
      parsed.fontFamily !== LEGACY_SYSTEM_FONT
    ) {
      // 用户自己选过的字体照旧尊重；不在当前系统列表里时设置页显示为「自定义」
      fontFamily = parsed.fontFamily;
    }
    let monoFontFamily = SETTINGS_DEFAULTS.monoFontFamily;
    if (typeof parsed.monoFontFamily === "string") {
      monoFontFamily = parsed.monoFontFamily;
    }
    return {
      ...SETTINGS_DEFAULTS,
      ...parsed,
      fontFamily,
      monoFontFamily,
      appearance: parseAppearance(parsed.appearance),
      alertContentKinds:
        parsed.alertContentKinds || SETTINGS_DEFAULTS.alertContentKinds,
      notifyContentFields:
        parsed.notifyContentFields || SETTINGS_DEFAULTS.notifyContentFields,
      alertLevels: parseAlertLevels(parsed.alertLevels),
      alertSustain: clampInt(parsed.alertSustain, ALERT_SUSTAIN_RANGE, SETTINGS_DEFAULTS.alertSustain),
      alertRepeatMinutes: clampInt(
        parsed.alertRepeatMinutes,
        ALERT_REPEAT_RANGE,
        SETTINGS_DEFAULTS.alertRepeatMinutes,
      ),
      alertLoadWindow: parseLoadWindow(parsed.alertLoadWindow),
      hostResourceNotifySubs: parsed.hostResourceNotifySubs || {},
      hostAppNotifySubs: parsed.hostAppNotifySubs || {},
      hostCertNotifySubs: parsed.hostCertNotifySubs || {},
      hostHomeRows: parseHostHomeRows(parsed.hostHomeRows),
      terminalOpenMode:
        parsed.terminalOpenMode === "window" ? "window" : "tab",
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
  monoFontFamily?: string,
  forcedResolved?: ResolvedAppearance,
) {
  const root = document.documentElement;
  const resolved = forcedResolved ?? resolveAppearance(appearance);
  root.classList.remove("light", "dark");
  root.classList.add(resolved);
  root.style.colorScheme = resolved;
  root.style.background = root.dataset.windowMaterial === "acrylic" ? "transparent" : "var(--color-canvas)";
  if (typeof fontFamily === "string") {
    if (fontFamily) {
      root.style.setProperty("--app-font-family", fontFamily);
      document.body.style.fontFamily = fontFamily;
    } else {
      // 系统默认：清掉覆盖，让 .react-root 回落到 var(--font-sans)
      root.style.removeProperty("--app-font-family");
      document.body.style.fontFamily = "";
    }
  }
  if (typeof monoFontFamily === "string") {
    if (monoFontFamily) {
      root.style.setProperty("--app-font-mono", monoFontFamily);
    } else {
      // 系统默认：清掉覆盖，--font-mono 回落到系统等宽栈
      root.style.removeProperty("--app-font-mono");
    }
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
      current.monoFontFamily,
    );
  };
  mediaQuery.addEventListener("change", mediaListener);
}

function applySettings(settings: AppSettings) {
  applyAppearanceToDocument(
    settings.appearance,
    settings.fontFamily,
    settings.fontSize,
    settings.monoFontFamily,
  );
  syncSystemAppearanceWatch(settings.appearance);
}

/** Linux：WebKitGTK 不派发 prefers-color-scheme 的 matchMedia change 事件，
 * Go 侧监听桌面门户后发 system-appearance-changed，这里按事件值重铺主题。 */
export function applySystemAppearanceHint(dark: boolean) {
  if (current.appearance !== "system") return;
  applyAppearanceToDocument(
    current.appearance,
    current.fontFamily,
    current.fontSize,
    current.monoFontFamily,
    dark ? "dark" : "light",
  );
}

function syncNativeAppearance() {
  void api
    .setThemeAppearance(appearanceToNativeMode(current.appearance))
    // Linux 的后端在这次调用里按桌面门户纠正 GTK 深浅色偏好；WebKitGTK 的
    // matchMedia 值随查随新但不发变更事件，返回后重读一次，避免停留在旧值。
    .then(() =>
      applyAppearanceToDocument(
        current.appearance,
        current.fontFamily,
        current.fontSize,
        current.monoFontFamily,
      ),
    )
    .catch(() => {});
}

function emit() {
  applySettings(current);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
  listeners.forEach((listener) => listener());
  syncNativeAppearance();
  void api
    .setNotifySubs({
      fromDisk: true,
      notifyEnabled: current.notifyEnabled,
      wecomWebhook: current.wecomWebhook,
      systemNotifyEnabled: current.systemNotifyEnabled,
      inAppNotifyEnabled: current.inAppNotifyEnabled,
      alertContentKinds: current.alertContentKinds,
      notifyRecoverEnabled: current.notifyRecoverEnabled,
      alertLevels: current.alertLevels,
      alertSustain: current.alertSustain,
      alertRepeatMinutes: current.alertRepeatMinutes,
      alertLoadWindow: current.alertLoadWindow,
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
  // 首页分组排布属于用户整理的布局，不随「恢复默认」清空
  const hostHomeRows = current.hostHomeRows;
  current = { ...SETTINGS_DEFAULTS };
  current.hostHomeRows = hostHomeRows;
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
syncNativeAppearance();
