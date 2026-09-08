import { defineStore } from "pinia";
import { ref, watch } from "vue";
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

/** 磨砂窗口材质仅 macOS 支持；Windows 等平台无系统磨砂，默认关闭 */
const isMacPlatform = /Mac|iPhone|iPad/.test(navigator.platform);

/** 设置页左侧分组；仅进程内记忆，不写入 localStorage */
export type SettingsNavGroup =
  | "appearance"
  | "ui"
  | "terminal"
  | "session"
  | "notify"
  | "app";

/** 主机资源告警中可单独开关企微推送的类型（单一来源见 utils/alerts.ts） */
export type WecomAlertKind = ResourceAlertKind;

export const ALL_WECOM_ALERT_KINDS: WecomAlertKind[] = [...ALL_ALERT_KINDS];

export interface AppSettings {
  theme: ThemeKey;
  /** 侧栏/通栏磨砂半透明；默认：macOS 开，其余平台关 */
  frostedChrome: boolean;
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
  /** 哪些资源告警类型推企微；缺字段时按四条全开迁移 */
  wecomAlertKinds: WecomAlertKind[];
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

export const TERMINAL_FONT_OPTIONS: { label: string; value: string }[] = [
  {
    label: "SF Mono（推荐）",
    value: '"SF Mono", "JetBrains Mono", Menlo, Monaco, monospace',
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

/** 磨砂默认值迁移标记：见 load() 中的一次性迁移 */
const FROSTED_MIGRATION_KEY = "ipannel.frostedDefaultByPlatform.migrated";

const DEFAULTS: AppSettings = {
  theme: "auto",
  frostedChrome: isMacPlatform,
  fontFamily: FONT_OPTIONS[0].value,
  fontSize: 14,
  terminalFontSize: 13,
  terminalFontFamily: TERMINAL_FONT_OPTIONS[0].value,
  maxRunningHosts: 12,
  notifyEnabled: false,
  wecomWebhook: "",
  wecomAlertKinds: [...ALL_WECOM_ALERT_KINDS],
  hostResourceNotifySubs: {},
  hostAppNotifySubs: {},
};

/** 主机 → 合法服务名列表；非法项丢弃 */
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
    if (services.length) out[name] = services;
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

function isWecomAlertKind(k: unknown): k is WecomAlertKind {
  return isResourceAlertKind(k);
}

/** 缺字段或非法类型时四条全开；合法数组则按内容过滤（可为空） */
function loadWecomAlertKinds(v: unknown): WecomAlertKind[] {
  if (!Array.isArray(v)) return [...ALL_WECOM_ALERT_KINDS];
  return v.filter(isWecomAlertKind);
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
    // 一次性迁移：磨砂默认值曾全平台为 true，改为仅 macOS 后，把存量
    // 非 mac 用户被旧默认顺带持久化的 true 纠正为 false；标记落地后
    // 不再干预，此后设置页的显式选择照常生效。
    if (!isMacPlatform && !localStorage.getItem(FROSTED_MIGRATION_KEY)) {
      localStorage.setItem(FROSTED_MIGRATION_KEY, "1");
      if (parsed.frostedChrome === true) parsed.frostedChrome = false;
    }
    return {
      theme: (parsed.theme as ThemeKey) || DEFAULTS.theme,
      frostedChrome:
        typeof parsed.frostedChrome === "boolean"
          ? parsed.frostedChrome
          : DEFAULTS.frostedChrome,
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
        24
      ),
      notifyEnabled:
        typeof parsed.notifyEnabled === "boolean"
          ? parsed.notifyEnabled
          : DEFAULTS.notifyEnabled,
      wecomWebhook:
        typeof parsed.wecomWebhook === "string"
          ? parsed.wecomWebhook
          : DEFAULTS.wecomWebhook,
      wecomAlertKinds: loadWecomAlertKinds(parsed.wecomAlertKinds),
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
  const frostedChrome = ref(initial.frostedChrome);
  const fontFamily = ref(initial.fontFamily);
  const fontSize = ref(initial.fontSize);
  const terminalFontSize = ref(initial.terminalFontSize);
  const terminalFontFamily = ref(initial.terminalFontFamily);
  const maxRunningHosts = ref(initial.maxRunningHosts);
  const notifyEnabled = ref(initial.notifyEnabled);
  const wecomWebhook = ref(initial.wecomWebhook);
  const wecomAlertKinds = ref<WecomAlertKind[]>([...initial.wecomAlertKinds]);
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
      frostedChrome: frostedChrome.value,
      fontFamily: fontFamily.value,
      fontSize: fontSize.value,
      terminalFontSize: terminalFontSize.value,
      terminalFontFamily: terminalFontFamily.value,
      maxRunningHosts: maxRunningHosts.value,
      notifyEnabled: notifyEnabled.value,
      wecomWebhook: wecomWebhook.value,
      wecomAlertKinds: [...wecomAlertKinds.value],
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
      wecomAlertKinds: [...wecomAlertKinds.value],
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
        wecomAlertKinds.value = loadWecomAlertKinds(d.wecomAlertKinds);
        hostResourceNotifySubs.value = loadHostResourceNotifySubs(
          d.hostResourceNotifySubs
        );
        hostAppNotifySubs.value = loadHostAppNotifySubs(d.hostAppNotifySubs);
        persist();
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
    // className 赋值后由 applyFrosted 统一管理 frosted class；
    // setTheme 单独调用时也补一次，避免主题切换把 frosted 清掉
    root.className = actual;
    applyFrostedClass();
    root.setAttribute("data-theme", actual);
  }

  /** 仅切 html.frosted class（不动窗口材质）；applyTheme 重建 className 后须重放 */
  function applyFrostedClass() {
    document.documentElement.classList.toggle("frosted", frostedChrome.value);
  }

  function applyFrosted() {
    applyFrostedClass();
    void api.setFrostedChrome(frostedChrome.value).catch((err) => {
      console.warn("setFrostedChrome failed", err);
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
    applyFrosted();
    applyTypography();
  }

  function setTheme(t: ThemeKey) {
    theme.value = t;
    applyTheme(t);
    persist();
  }

  function setFrostedChrome(v: boolean) {
    frostedChrome.value = v;
    applyFrosted();
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
    maxRunningHosts.value = clamp(v, 4, 24);
    persist();
  }

  function setNotifyEnabled(v: boolean) {
    notifyEnabled.value = v;
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
      const map = { ...hostAppNotifySubs.value };
      if (next.length) map[name] = next;
      else delete map[name];
      hostAppNotifySubs.value = map;
    }
    persistNotify();
  }

  /** 有应用订阅的主机名（全局探活轮询用） */
  function hostsWithAppNotifySubs(): string[] {
    return Object.keys(hostAppNotifySubs.value).filter(
      (h) => (hostAppNotifySubs.value[h] || []).length > 0
    );
  }

  /** 主机改名时带走订阅，避免生产机订阅丢到旧别名 */
  function renameNotifyHost(oldName: string, newName: string) {
    const from = (oldName || "").trim();
    const to = (newName || "").trim();
    if (!from || !to || from === to) return;
    let changed = false;

    const appFrom = hostAppNotifySubs.value[from];
    if (appFrom?.length) {
      const map = { ...hostAppNotifySubs.value };
      const merged = [
        ...new Set([...(map[to] || []), ...appFrom]),
      ].filter(isWatchServiceName);
      if (merged.length) map[to] = merged;
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

  /** 该资源告警类型是否推企微（须该主机已订阅该类型；系统/应用内通知由订阅决定） */
  function isWecomKindEnabled(kind: string): boolean {
    if (!isWecomAlertKind(kind)) return false;
    return wecomAlertKinds.value.includes(kind);
  }

  function setWecomKindEnabled(kind: WecomAlertKind, on: boolean) {
    const has = wecomAlertKinds.value.includes(kind);
    if (on) {
      if (has) return;
      wecomAlertKinds.value = [...wecomAlertKinds.value, kind];
    } else {
      if (!has) return;
      wecomAlertKinds.value = wecomAlertKinds.value.filter((k) => k !== kind);
    }
    persistNotify();
  }

  /** 仅重置外观/界面/终端/会话；通知相关配置保留 */
  function resetSettings() {
    theme.value = DEFAULTS.theme;
    frostedChrome.value = DEFAULTS.frostedChrome;
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
  }

  watch(theme, (t) => applyTheme(t));

  return {
    theme,
    frostedChrome,
    fontFamily,
    fontSize,
    terminalFontSize,
    terminalFontFamily,
    maxRunningHosts,
    notifyEnabled,
    wecomWebhook,
    wecomAlertKinds,
    hostResourceNotifySubs,
    hostAppNotifySubs,
    webhookDraft,
    webhookTested,
    lastNavGroup,
    setLastNavGroup,
    setTheme,
    setFrostedChrome,
    cycleTheme,
    setFontFamily,
    setFontSize,
    setTerminalFontSize,
    setTerminalFontFamily,
    setMaxRunningHosts,
    setNotifyEnabled,
    setWecomWebhook,
    effectiveWecomWebhook,
    listResourceNotifySubs,
    isResourceNotifySubscribed,
    setResourceNotifySubscribed,
    listAppNotifySubs,
    isAppNotifySubscribed,
    setAppNotifySubscribed,
    hostsWithAppNotifySubs,
    hydrateNotifySubs,
    renameNotifyHost,
    isWecomKindEnabled,
    setWecomKindEnabled,
    resetSettings,
    applyAll,
  };
});
