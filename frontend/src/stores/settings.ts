import { defineStore } from "pinia";
import { ref, watch } from "vue";
import { Events } from "@wailsio/runtime";
import { api } from "@/api";
import {
  ALL_ALERT_KINDS,
  isResourceAlertKind,
  type ResourceAlertKind,
} from "@/utils/alerts";
import {
  isWatchServiceName,
  type WatchServiceName,
} from "@/utils/watchServices";

export type ThemeKey = "light" | "dark" | "auto";

/** 平台探测：终端默认字号等 */
const isMacPlatform = /Mac|iPhone|iPad/.test(navigator.platform);
const isWinPlatform = /Win/i.test(navigator.platform);

/** 终端默认字号：macOS 14，Windows 16，其余 15 */
function defaultTerminalFontSize(): number {
  if (isMacPlatform) return 14;
  if (isWinPlatform) return 16;
  return 15;
}

/** 设置页左侧分组；仅进程内记忆，不写入 localStorage */
export type SettingsNavGroup =
  | "appearance"
  | "ui"
  | "terminal"
  | "session"
  | "app";

/** 设置二级栏 / 设置页共用的分组列表 */
export const SETTINGS_NAV_GROUPS: { id: SettingsNavGroup; label: string }[] = [
  { id: "appearance", label: "外观" },
  { id: "ui", label: "界面" },
  { id: "terminal", label: "终端" },
  { id: "session", label: "会话" },
  { id: "app", label: "应用" },
];

/** 主机资源告警中可单独开关的类型（单一来源见 utils/alerts.ts）；兼容旧名 */
export type WecomAlertKind = ResourceAlertKind;

export const ALL_WECOM_ALERT_KINDS: WecomAlertKind[] = [...ALL_ALERT_KINDS];

/** 全局内容类型总闸：资源四类 + 应用探活总类 */
export type AlertContentKind = ResourceAlertKind | "app";

export const ALL_ALERT_CONTENT_KINDS: AlertContentKind[] = [
  ...ALL_ALERT_KINDS,
  "app",
];

/** 通知正文可选字段 */
export type NotifyContentField =
  | "hostName"
  | "metric"
  | "threshold"
  | "value"
  | "service";

export const ALL_NOTIFY_CONTENT_FIELDS: NotifyContentField[] = [
  "hostName",
  "metric",
  "threshold",
  "value",
  "service",
];

export interface AppSettings {
  theme: ThemeKey;
  fontFamily: string;
  fontSize: number; // UI 字号 px 12~18
  terminalFontSize: number; // 终端字号 px 11~20
  terminalFontFamily: string;
  /** 同时后台挂起的主机会话数上限（4~24） */
  maxRunningHosts: number;
  /** 企微通知总开关（关则不推企业微信；系统/应用内通知仍受各主机订阅控制） */
  notifyEnabled: boolean;
  /** 企微机器人 Webhook 完整 URL 或 key */
  wecomWebhook: string;
  /** 系统通知（OS）总开关；缺省 true */
  systemNotifyEnabled: boolean;
  /** 应用内通知总开关；缺省 true */
  inAppNotifyEnabled: boolean;
  /**
   * 全局内容类型总闸（cpu/mem/disk/load/app）。
   * 缺字段时用旧 wecomAlertKinds 迁资源类型并补 app；再缺则全开。
   */
  alertContentKinds: AlertContentKind[];
  /** 是否发送恢复/up；缺省 true */
  notifyRecoverEnabled: boolean;
  /** 通知正文字段勾选；缺省全开 */
  notifyContentFields: NotifyContentField[];
  /**
   * 按主机订阅的资源告警类型（cpu/mem/disk/load）。
   * 未订该类型则企微 / 系统通知 / 应用内历史都不发。
   */
  hostResourceNotifySubs: Record<string, ResourceAlertKind[]>;
  /**
   * 按主机订阅的应用探活通知（服务名列表）。
   * 未订该服务则企微 / 系统通知 / 应用内历史都不发。
   */
  hostAppNotifySubs: Record<string, string[]>;
}

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
    label: "等宽：SF Mono",
    value: '"SF Mono", "JetBrains Mono", Menlo, Monaco, "Courier New", monospace',
  },
  {
    label: "等宽：Menlo",
    value: 'Menlo, Monaco, "SF Mono", "Courier New", monospace',
  },
  {
    label: "等宽：JetBrains Mono",
    value: '"JetBrains Mono", "SF Mono", Menlo, Monaco, monospace',
  },
  {
    label: "衬线：Songti / Times",
    value: '"Songti SC", "New York", "Times New Roman", serif',
  },
];

const TERM_FONT_SF_MONO =
  '"SF Mono", "JetBrains Mono", Menlo, Monaco, monospace';
const TERM_FONT_CONSOLAS =
  'Consolas, "Cascadia Mono", "Courier New", monospace';

export const TERMINAL_FONT_OPTIONS: { label: string; value: string }[] = [
  {
    label: "SF Mono（macOS 推荐）",
    value: TERM_FONT_SF_MONO,
  },
  {
    label: "Consolas（Windows 推荐）",
    value: TERM_FONT_CONSOLAS,
  },
  {
    label: "Maple Mono NF CN",
    value: '"Maple Mono NF CN", "SF Mono", Menlo, monospace',
  },
  {
    label: "Menlo",
    value: 'Menlo, Monaco, "SF Mono", monospace',
  },
  {
    label: "JetBrains Mono",
    value: '"JetBrains Mono", "SF Mono", Menlo, Monaco, monospace',
  },
  {
    label: "Courier New",
    value: '"Courier New", Courier, monospace',
  },
  {
    label: "跟随界面字体",
    value: "inherit",
  },
];

function defaultTerminalFontFamily(): string {
  return isWinPlatform ? TERM_FONT_CONSOLAS : TERM_FONT_SF_MONO;
}

export const THEME_OPTIONS: {
  key: ThemeKey;
  name: string;
  description: string;
  swatch: { bg: string; fg: string; accent: string };
}[] = [
  {
    key: "light",
    name: "明亮",
    description: "M3 亮色方案",
    swatch: { bg: "#f4f4f4", fg: "#1f2329", accent: "#005eeb" },
  },
  {
    key: "dark",
    name: "暗黑",
    description: "M3 深色方案，护眼",
    swatch: { bg: "#141820", fg: "#e4e7ed", accent: "#669ef3" },
  },
  {
    key: "auto",
    name: "跟随系统",
    description: "按系统亮/暗自动切换",
    swatch: {
      bg: "linear-gradient(135deg, #f4f4f4 50%, #141820 50%)",
      fg: "#888",
      accent: "#005eeb",
    },
  },
];

export const WECOM_WEBHOOK_PREFIX =
  "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=";

/** 只填 key 时补成完整 URL，便于完整展示和发送 */
export function expandWecomWebhook(raw: string): string {
  const v = (raw || "").trim();
  if (!v) return "";
  if (/^https?:\/\//i.test(v)) return v;
  return WECOM_WEBHOOK_PREFIX + v;
}

const STORAGE_KEY = "ipannel.settings.v1";

/** 终端默认字号按平台：只纠正仍停在旧默认（13/15）的用户 */
const TERM_FONT_MIGRATION_KEY = "ipannel.terminalFontSize.byPlatform.migrated";

/** Windows 终端默认字体改为 Consolas */
const TERM_FAMILY_WIN_MIGRATION_KEY =
  "ipannel.terminalFontFamily.winConsolas.migrated";
const MAX_RUNNING_HOSTS_V16_KEY = "ipannel.maxRunningHosts.v16.migrated";

const DEFAULTS: AppSettings = {
  theme: "auto",
  fontFamily: FONT_OPTIONS[0].value,
  fontSize: 14,
  terminalFontSize: defaultTerminalFontSize(),
  terminalFontFamily: defaultTerminalFontFamily(),
  // 同时后台会话数：默认 16，设置里可调到 32。
  maxRunningHosts: 16,
  notifyEnabled: false,
  wecomWebhook: "",
  systemNotifyEnabled: true,
  inAppNotifyEnabled: true,
  alertContentKinds: [...ALL_ALERT_CONTENT_KINDS],
  notifyRecoverEnabled: true,
  notifyContentFields: [...ALL_NOTIFY_CONTENT_FIELDS],
  hostResourceNotifySubs: {},
  hostAppNotifySubs: {},
};

/** 主机 → 合法服务名列表；非法项丢弃。空数组主机键保留（曾配置、当前 0）。 */
function loadHostAppNotifySubs(v: unknown): Record<string, string[]> {
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  const out: Record<string, string[]> = {};
  for (const [host, list] of Object.entries(v as Record<string, unknown>)) {
    const name = (host || "").trim();
    if (!name || !Array.isArray(list)) continue;
    const services = [
      ...new Set(
        list.filter(isWatchServiceName) as WatchServiceName[]
      ),
    ];
    out[name] = services;
  }
  return out;
}

/** 主机 → 合法资源告警类型；#28 之前的 wecomSubscribedHosts 迁成四条全订 */
function loadHostResourceNotifySubs(
  v: unknown,
  legacyHosts?: unknown
): Record<string, ResourceAlertKind[]> {
  if (v && typeof v === "object" && !Array.isArray(v)) {
    const out: Record<string, ResourceAlertKind[]> = {};
    for (const [host, list] of Object.entries(v as Record<string, unknown>)) {
      const name = (host || "").trim();
      if (!name || !Array.isArray(list)) continue;
      const kinds = [
        ...new Set(list.filter(isResourceAlertKind)),
      ] as ResourceAlertKind[];
      if (kinds.length) out[name] = kinds;
    }
    return out;
  }
  if (!Array.isArray(legacyHosts)) return {};
  const out: Record<string, ResourceAlertKind[]> = {};
  for (const h of legacyHosts) {
    if (typeof h !== "string") continue;
    const name = h.trim();
    if (!name) continue;
    out[name] = [...ALL_ALERT_KINDS];
  }
  return out;
}

function isAlertContentKind(k: unknown): k is AlertContentKind {
  return ALL_ALERT_CONTENT_KINDS.includes(k as AlertContentKind);
}

function isNotifyContentField(k: unknown): k is NotifyContentField {
  return ALL_NOTIFY_CONTENT_FIELDS.includes(k as NotifyContentField);
}

/**
 * alertContentKinds 缺省：用旧 wecomAlertKinds 迁资源类型并补 app；再缺则全开。
 * 显式空数组表示用户关光，不回退。
 */
function loadAlertContentKinds(
  v: unknown,
  legacyWecomKinds?: unknown
): AlertContentKind[] {
  if (Array.isArray(v)) {
    return [...new Set(v.filter(isAlertContentKind))];
  }
  if (Array.isArray(legacyWecomKinds)) {
    const resources = legacyWecomKinds.filter(
      isResourceAlertKind
    ) as ResourceAlertKind[];
    if (resources.length) {
      return [...new Set<AlertContentKind>([...resources, "app"])];
    }
  }
  return [...ALL_ALERT_CONTENT_KINDS];
}

/** 缺字段全开；合法数组按枚举过滤（可为空） */
function loadNotifyContentFields(v: unknown): NotifyContentField[] {
  if (!Array.isArray(v)) return [...ALL_NOTIFY_CONTENT_FIELDS];
  return [...new Set(v.filter(isNotifyContentField))];
}

function loadBoolDefaultTrue(v: unknown): boolean {
  if (typeof v === "boolean") return v;
  return true;
}

function load(): AppSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      // 兼容旧版仅 theme 键
      const oldTheme = localStorage.getItem("ipannel.theme") as ThemeKey | null;
      if (oldTheme && ["light", "dark", "auto"].includes(oldTheme)) {
        return { ...DEFAULTS, theme: oldTheme };
      }
      return { ...DEFAULTS };
    }
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    if (!localStorage.getItem(TERM_FONT_MIGRATION_KEY)) {
      localStorage.setItem(TERM_FONT_MIGRATION_KEY, "1");
      const n = Number(parsed.terminalFontSize);
      // 13 为最初默认，15 为上一轮全平台默认；显式改过的其它值保留
      if (n === 13 || n === 15) {
        parsed.terminalFontSize = defaultTerminalFontSize();
      }
    }
    if (isWinPlatform && !localStorage.getItem(TERM_FAMILY_WIN_MIGRATION_KEY)) {
      localStorage.setItem(TERM_FAMILY_WIN_MIGRATION_KEY, "1");
      const fam = parsed.terminalFontFamily;
      if (!fam || fam === TERM_FONT_SF_MONO) {
        parsed.terminalFontFamily = TERM_FONT_CONSOLAS;
      }
    }
    if (!localStorage.getItem(MAX_RUNNING_HOSTS_V16_KEY)) {
      localStorage.setItem(MAX_RUNNING_HOSTS_V16_KEY, "1");
      const n = Number(parsed.maxRunningHosts);
      // 仅抬升旧默认 8 / 12；用户显式改过的其它值保留
      if (n === 8 || n === 12) {
        parsed.maxRunningHosts = DEFAULTS.maxRunningHosts;
      }
    }
    return {
      theme: (parsed.theme as ThemeKey) || DEFAULTS.theme,
      fontFamily: parsed.fontFamily || DEFAULTS.fontFamily,
      fontSize: clamp(Number(parsed.fontSize) || DEFAULTS.fontSize, 11, 20),
      terminalFontSize: clamp(
        Number(parsed.terminalFontSize) || DEFAULTS.terminalFontSize,
        10,
        22
      ),
      terminalFontFamily:
        parsed.terminalFontFamily || DEFAULTS.terminalFontFamily,
      maxRunningHosts: clamp(
        Number(parsed.maxRunningHosts) || DEFAULTS.maxRunningHosts,
        4,
        32
      ),
      notifyEnabled:
        typeof parsed.notifyEnabled === "boolean"
          ? parsed.notifyEnabled
          : DEFAULTS.notifyEnabled,
      wecomWebhook:
        typeof parsed.wecomWebhook === "string"
          ? parsed.wecomWebhook
          : DEFAULTS.wecomWebhook,
      systemNotifyEnabled: loadBoolDefaultTrue(
        (parsed as { systemNotifyEnabled?: unknown }).systemNotifyEnabled
      ),
      inAppNotifyEnabled: loadBoolDefaultTrue(
        (parsed as { inAppNotifyEnabled?: unknown }).inAppNotifyEnabled
      ),
      alertContentKinds: loadAlertContentKinds(
        (parsed as { alertContentKinds?: unknown }).alertContentKinds,
        (parsed as { wecomAlertKinds?: unknown }).wecomAlertKinds
      ),
      notifyRecoverEnabled: loadBoolDefaultTrue(
        (parsed as { notifyRecoverEnabled?: unknown }).notifyRecoverEnabled
      ),
      notifyContentFields: loadNotifyContentFields(
        (parsed as { notifyContentFields?: unknown }).notifyContentFields
      ),
      hostResourceNotifySubs: loadHostResourceNotifySubs(
        (parsed as { hostResourceNotifySubs?: unknown }).hostResourceNotifySubs,
        (parsed as { wecomSubscribedHosts?: unknown }).wecomSubscribedHosts
      ),
      hostAppNotifySubs: loadHostAppNotifySubs(
        (parsed as { hostAppNotifySubs?: unknown }).hostAppNotifySubs
      ),
    };
  } catch {
    return { ...DEFAULTS };
  }
}

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Math.round(n)));
}

export const useSettingsStore = defineStore("settings", () => {
  const initial = load();
  const theme = ref<ThemeKey>(initial.theme);
  const fontFamily = ref(initial.fontFamily);
  const fontSize = ref(initial.fontSize);
  const terminalFontSize = ref(initial.terminalFontSize);
  const terminalFontFamily = ref(initial.terminalFontFamily);
  const maxRunningHosts = ref(initial.maxRunningHosts);
  const notifyEnabled = ref(initial.notifyEnabled);
  const wecomWebhook = ref(initial.wecomWebhook);
  const systemNotifyEnabled = ref(initial.systemNotifyEnabled);
  const inAppNotifyEnabled = ref(initial.inAppNotifyEnabled);
  const alertContentKinds = ref<AlertContentKind[]>([
    ...initial.alertContentKinds,
  ]);
  const notifyRecoverEnabled = ref(initial.notifyRecoverEnabled);
  const notifyContentFields = ref<NotifyContentField[]>([
    ...initial.notifyContentFields,
  ]);
  const hostResourceNotifySubs = ref<Record<string, ResourceAlertKind[]>>({
    ...initial.hostResourceNotifySubs,
  });
  const hostAppNotifySubs = ref<Record<string, string[]>>({
    ...initial.hostAppNotifySubs,
  });
  /** 设置页草稿：离开页面不丢，未点保存不写入 localStorage */
  const webhookDraft = ref(expandWecomWebhook(initial.wecomWebhook));
  const webhookTested = ref("");
  const lastNavGroup = ref<SettingsNavGroup>("appearance");
  function setLastNavGroup(g: SettingsNavGroup) {
    lastNavGroup.value = g;
  }

  function persist() {
    const data: AppSettings = {
      theme: theme.value,
      fontFamily: fontFamily.value,
      fontSize: fontSize.value,
      terminalFontSize: terminalFontSize.value,
      terminalFontFamily: terminalFontFamily.value,
      maxRunningHosts: maxRunningHosts.value,
      notifyEnabled: notifyEnabled.value,
      wecomWebhook: wecomWebhook.value,
      systemNotifyEnabled: systemNotifyEnabled.value,
      inAppNotifyEnabled: inAppNotifyEnabled.value,
      alertContentKinds: [...alertContentKinds.value],
      notifyRecoverEnabled: notifyRecoverEnabled.value,
      notifyContentFields: [...notifyContentFields.value],
      hostResourceNotifySubs: { ...hostResourceNotifySubs.value },
      hostAppNotifySubs: { ...hostAppNotifySubs.value },
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    localStorage.setItem("ipannel.theme", theme.value);
  }

  function notifyDiskPayload() {
    return {
      fromDisk: true,
      notifyEnabled: notifyEnabled.value,
      wecomWebhook: wecomWebhook.value,
      systemNotifyEnabled: systemNotifyEnabled.value,
      inAppNotifyEnabled: inAppNotifyEnabled.value,
      alertContentKinds: [...alertContentKinds.value],
      notifyRecoverEnabled: notifyRecoverEnabled.value,
      notifyContentFields: [...notifyContentFields.value],
      hostResourceNotifySubs: { ...hostResourceNotifySubs.value },
      hostAppNotifySubs: { ...hostAppNotifySubs.value },
    };
  }

  function persistNotifyDisk() {
    void api.setNotifySubs(notifyDiskPayload()).catch(() => {});
  }

  function persistNotify() {
    persist();
    persistNotifyDisk();
  }

  /** 从本机应用数据目录恢复订阅；文件不存在则把当前 localStorage 迁过去。 */
  async function hydrateNotifySubs() {
    try {
      const d = await api.getNotifySubs();
      if (d.fromDisk) {
        notifyEnabled.value = !!d.notifyEnabled;
        wecomWebhook.value =
          typeof d.wecomWebhook === "string" ? d.wecomWebhook : "";
        webhookDraft.value = expandWecomWebhook(wecomWebhook.value);
        systemNotifyEnabled.value = loadBoolDefaultTrue(d.systemNotifyEnabled);
        inAppNotifyEnabled.value = loadBoolDefaultTrue(d.inAppNotifyEnabled);
        alertContentKinds.value = loadAlertContentKinds(
          d.alertContentKinds,
          (d as { wecomAlertKinds?: unknown }).wecomAlertKinds
        );
        notifyRecoverEnabled.value = loadBoolDefaultTrue(
          d.notifyRecoverEnabled
        );
        notifyContentFields.value = loadNotifyContentFields(
          d.notifyContentFields
        );
        hostResourceNotifySubs.value = loadHostResourceNotifySubs(
          d.hostResourceNotifySubs
        );
        hostAppNotifySubs.value = loadHostAppNotifySubs(d.hostAppNotifySubs);
        persist();
        // 磁盘仍可能带旧 wecomAlertKinds；写回一次去掉并补齐新字段
        persistNotifyDisk();
        return;
      }
      persistNotifyDisk();
    } catch {
      /* 落盘不可用时继续用 localStorage */
    }
  }

  function applyTheme(t: ThemeKey) {
    let actual: "light" | "dark" = "light";
    if (t === "auto") {
      actual = window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light";
    } else {
      actual = t;
    }
    const root = document.documentElement;
    root.className = actual;
    root.setAttribute("data-theme", actual);
    root.style.colorScheme = actual;
    // 同步原生窗口 Aqua/DarkAqua
    void api.setThemeAppearance(t).catch((err) => {
      console.warn("setThemeAppearance failed", err);
    });
  }

  function applyTypography() {
    const root = document.documentElement;
    root.style.setProperty("--app-font-family", fontFamily.value);
    root.style.setProperty("--app-font-size", `${fontSize.value}px`);
    root.style.setProperty(
      "--app-terminal-font-size",
      `${terminalFontSize.value}px`
    );
    const termFont =
      terminalFontFamily.value === "inherit"
        ? fontFamily.value
        : terminalFontFamily.value;
    root.style.setProperty("--app-terminal-font-family", termFont);
    // 同步 body / #app（index.scss 会引用变量）
    document.body.style.fontFamily = fontFamily.value;
    document.body.style.fontSize = `${fontSize.value}px`;
  }

  function applyAll() {
    applyTheme(theme.value);
    applyTypography();
  }

  function setTheme(t: ThemeKey) {
    theme.value = t;
    applyTheme(t);
    persist();
  }

  function cycleTheme() {
    const order: ThemeKey[] = ["light", "dark", "auto"];
    const i = order.indexOf(theme.value);
    setTheme(order[(i + 1) % order.length]);
  }

  function setFontFamily(v: string) {
    fontFamily.value = v;
    applyTypography();
    persist();
  }

  function setFontSize(v: number) {
    fontSize.value = clamp(v, 11, 20);
    applyTypography();
    persist();
  }

  function setTerminalFontSize(v: number) {
    terminalFontSize.value = clamp(v, 10, 22);
    applyTypography();
    persist();
  }

  function setTerminalFontFamily(v: string) {
    terminalFontFamily.value = v;
    applyTypography();
    persist();
  }

  function setMaxRunningHosts(v: number) {
    maxRunningHosts.value = clamp(v, 4, 32);
    persist();
  }

  function setNotifyEnabled(v: boolean) {
    notifyEnabled.value = v;
    persistNotify();
  }

  function setSystemNotifyEnabled(v: boolean) {
    systemNotifyEnabled.value = v;
    persistNotify();
  }

  function setInAppNotifyEnabled(v: boolean) {
    inAppNotifyEnabled.value = v;
    persistNotify();
  }

  function setNotifyRecoverEnabled(v: boolean) {
    notifyRecoverEnabled.value = v;
    persistNotify();
  }

  function setWecomWebhook(v: string) {
    wecomWebhook.value = expandWecomWebhook(v);
    webhookDraft.value = wecomWebhook.value;
    persistNotify();
  }

  /** 下发到 agent 时实际写入的 webhook（总开关关则空） */
  function effectiveWecomWebhook(): string {
    if (!notifyEnabled.value) return "";
    return expandWecomWebhook(wecomWebhook.value);
  }

  function listResourceNotifySubs(host: string): ResourceAlertKind[] {
    const name = (host || "").trim();
    if (!name) return [];
    return [...(hostResourceNotifySubs.value[name] || [])];
  }

  function isResourceNotifySubscribed(host: string, kind: string): boolean {
    const name = (host || "").trim();
    if (!name || !isResourceAlertKind(kind)) return false;
    return (hostResourceNotifySubs.value[name] || []).includes(kind);
  }

  function setResourceNotifySubscribed(
    host: string,
    kind: ResourceAlertKind,
    on: boolean
  ) {
    const name = (host || "").trim();
    if (!name || !isResourceAlertKind(kind)) return;
    const cur = hostResourceNotifySubs.value[name] || [];
    const has = cur.includes(kind);
    if (on) {
      if (has) return;
      hostResourceNotifySubs.value = {
        ...hostResourceNotifySubs.value,
        [name]: [...cur, kind],
      };
    } else {
      if (!has) return;
      const next = cur.filter((k) => k !== kind);
      const map = { ...hostResourceNotifySubs.value };
      if (next.length) map[name] = next;
      else delete map[name];
      hostResourceNotifySubs.value = map;
    }
    persistNotify();
  }

  function listAppNotifySubs(host: string): string[] {
    const name = (host || "").trim();
    if (!name) return [];
    return [...(hostAppNotifySubs.value[name] || [])];
  }

  /** 通知页曾配置过应用探活订阅（含当前为 0 的空列表） */
  function hasAppNotifyConfig(host: string): boolean {
    const name = (host || "").trim();
    if (!name) return false;
    return Object.prototype.hasOwnProperty.call(
      hostAppNotifySubs.value,
      name
    );
  }

  function isAppNotifySubscribed(host: string, service: string): boolean {
    const name = (host || "").trim();
    const svc = (service || "").trim();
    if (!name || !svc) return false;
    return (hostAppNotifySubs.value[name] || []).includes(svc);
  }

  function setAppNotifySubscribed(
    host: string,
    service: string,
    on: boolean
  ) {
    const name = (host || "").trim();
    const svc = (service || "").trim();
    if (!name || !isWatchServiceName(svc)) return;
    const cur = hostAppNotifySubs.value[name] || [];
    const has = cur.includes(svc);
    if (on) {
      if (has) return;
      hostAppNotifySubs.value = {
        ...hostAppNotifySubs.value,
        [name]: [...cur, svc],
      };
    } else {
      if (!has) return;
      const next = cur.filter((s) => s !== svc);
      hostAppNotifySubs.value = {
        ...hostAppNotifySubs.value,
        [name]: next,
      };
    }
    persistNotify();
  }

  /**
   * 整表替换单机订阅（不落盘）。
   * 资源：空数组删除该主机 key；应用：空数组仍保留 name: []（与 setAppNotifySubscribed 关空一致）。
   */
  function replaceHostNotifySubsInMemory(
    host: string,
    resourceKinds: ResourceAlertKind[],
    appServices: string[]
  ) {
    const name = (host || "").trim();
    if (!name) return;

    const kinds = [
      ...new Set(resourceKinds.filter(isResourceAlertKind)),
    ] as ResourceAlertKind[];
    const resMap = { ...hostResourceNotifySubs.value };
    if (kinds.length) resMap[name] = kinds;
    else delete resMap[name];
    hostResourceNotifySubs.value = resMap;

    const services = [
      ...new Set(
        appServices.filter(isWatchServiceName) as WatchServiceName[]
      ),
    ];
    hostAppNotifySubs.value = {
      ...hostAppNotifySubs.value,
      [name]: services,
    };
  }

  /** 整表替换单机订阅并立即 persistNotify */
  function replaceHostNotifySubs(
    host: string,
    resourceKinds: ResourceAlertKind[],
    appServices: string[]
  ) {
    replaceHostNotifySubsInMemory(host, resourceKinds, appServices);
    persistNotify();
  }

  /** 多机整表替换，最后只 persistNotify 一次 */
  function applyNotifySubsToHosts(
    hosts: string[],
    resourceKinds: ResourceAlertKind[],
    appServices: string[]
  ) {
    const names = [
      ...new Set(
        (hosts || [])
          .map((h) => (h || "").trim())
          .filter(Boolean)
      ),
    ];
    for (const name of names) {
      replaceHostNotifySubsInMemory(name, resourceKinds, appServices);
    }
    if (names.length) persistNotify();
  }

  /** 有应用订阅的主机名（全局探活轮询用） */
  function hostsWithAppNotifySubs(): string[] {
    return Object.keys(hostAppNotifySubs.value).filter(
      (h) => (hostAppNotifySubs.value[h] || []).length > 0
    );
  }

  /** 有资源告警订阅的主机名（全局资源轮询用） */
  function hostsWithResourceNotifySubs(): string[] {
    return Object.keys(hostResourceNotifySubs.value).filter(
      (h) => (hostResourceNotifySubs.value[h] || []).length > 0
    );
  }

  /** 主机改名时带走订阅，避免生产机订阅丢到旧别名 */
  function renameNotifyHost(oldName: string, newName: string) {
    const from = (oldName || "").trim();
    const to = (newName || "").trim();
    if (!from || !to || from === to) return;
    let changed = false;

    const appFrom = hostAppNotifySubs.value[from];
    if (Object.prototype.hasOwnProperty.call(hostAppNotifySubs.value, from)) {
      const map = { ...hostAppNotifySubs.value };
      const merged = [
        ...new Set([...(map[to] || []), ...(appFrom || [])]),
      ].filter(isWatchServiceName);
      map[to] = merged;
      delete map[from];
      hostAppNotifySubs.value = map;
      changed = true;
    }

    const resFrom = hostResourceNotifySubs.value[from];
    if (resFrom?.length) {
      const map = { ...hostResourceNotifySubs.value };
      const merged = [
        ...new Set([...(map[to] || []), ...resFrom]),
      ].filter(isResourceAlertKind);
      if (merged.length) map[to] = merged;
      else delete map[to];
      delete map[from];
      hostResourceNotifySubs.value = map;
      changed = true;
    }

    if (changed) persistNotify();
  }

  function isContentKindEnabled(kind: string): boolean {
    if (!isAlertContentKind(kind)) return false;
    return alertContentKinds.value.includes(kind);
  }

  function setContentKindEnabled(kind: AlertContentKind, on: boolean) {
    if (!isAlertContentKind(kind)) return;
    const has = alertContentKinds.value.includes(kind);
    if (on) {
      if (has) return;
      alertContentKinds.value = [...alertContentKinds.value, kind];
    } else {
      if (!has) return;
      alertContentKinds.value = alertContentKinds.value.filter((k) => k !== kind);
    }
    persistNotify();
  }

  function isNotifyContentFieldEnabled(field: string): boolean {
    if (!isNotifyContentField(field)) return false;
    return notifyContentFields.value.includes(field);
  }

  function setNotifyContentFieldEnabled(
    field: NotifyContentField,
    on: boolean
  ) {
    if (!isNotifyContentField(field)) return;
    const has = notifyContentFields.value.includes(field);
    if (on) {
      if (has) return;
      notifyContentFields.value = [...notifyContentFields.value, field];
    } else {
      if (!has) return;
      notifyContentFields.value = notifyContentFields.value.filter(
        (f) => f !== field
      );
    }
    persistNotify();
  }

  /** 兼容旧设置页：资源类型是否在全局内容总闸中开启 */
  function isWecomKindEnabled(kind: string): boolean {
    if (!isResourceAlertKind(kind)) return false;
    return isContentKindEnabled(kind);
  }

  function setWecomKindEnabled(kind: WecomAlertKind, on: boolean) {
    if (!isResourceAlertKind(kind)) return;
    setContentKindEnabled(kind, on);
  }

  /** 仅重置外观/界面/终端/会话；通知相关配置保留 */
  function resetSettings() {
    theme.value = DEFAULTS.theme;
    fontFamily.value = DEFAULTS.fontFamily;
    fontSize.value = DEFAULTS.fontSize;
    terminalFontSize.value = DEFAULTS.terminalFontSize;
    terminalFontFamily.value = DEFAULTS.terminalFontFamily;
    maxRunningHosts.value = DEFAULTS.maxRunningHosts;
    applyAll();
    persist();
  }

  // 启动时应用
  applyAll();

  if (typeof window !== "undefined") {
    window
      .matchMedia("(prefers-color-scheme: dark)")
      .addEventListener("change", () => {
        if (theme.value === "auto") applyTheme("auto");
      });

    // 原生系统外观变化（WKWebView 上 matchMedia 有时不触发）
    Events.On(
      "system-appearance-changed",
      (ev: { data?: { dark?: boolean } }) => {
        if (theme.value !== "auto") return;
        const dark = Boolean(ev?.data?.dark);
        const root = document.documentElement;
        root.className = dark ? "dark" : "light";
        root.setAttribute("data-theme", dark ? "dark" : "light");
        root.style.colorScheme = dark ? "dark" : "light";
      }
    );
  }

  watch(theme, (t) => applyTheme(t));

  return {
    theme,
    fontFamily,
    fontSize,
    terminalFontSize,
    terminalFontFamily,
    maxRunningHosts,
    notifyEnabled,
    wecomWebhook,
    systemNotifyEnabled,
    inAppNotifyEnabled,
    alertContentKinds,
    notifyRecoverEnabled,
    notifyContentFields,
    hostResourceNotifySubs,
    hostAppNotifySubs,
    webhookDraft,
    webhookTested,
    lastNavGroup,
    setLastNavGroup,
    setTheme,
    cycleTheme,
    setFontFamily,
    setFontSize,
    setTerminalFontSize,
    setTerminalFontFamily,
    setMaxRunningHosts,
    setNotifyEnabled,
    setSystemNotifyEnabled,
    setInAppNotifyEnabled,
    setNotifyRecoverEnabled,
    setWecomWebhook,
    effectiveWecomWebhook,
    listResourceNotifySubs,
    isResourceNotifySubscribed,
    setResourceNotifySubscribed,
    listAppNotifySubs,
    hasAppNotifyConfig,
    isAppNotifySubscribed,
    setAppNotifySubscribed,
    replaceHostNotifySubs,
    applyNotifySubsToHosts,
    hostsWithAppNotifySubs,
    hostsWithResourceNotifySubs,
    hydrateNotifySubs,
    renameNotifyHost,
    isContentKindEnabled,
    setContentKindEnabled,
    isNotifyContentFieldEnabled,
    setNotifyContentFieldEnabled,
    isWecomKindEnabled,
    setWecomKindEnabled,
    resetSettings,
    applyAll,
  };
});
