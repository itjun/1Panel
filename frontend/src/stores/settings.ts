import { defineStore } from "pinia";
import { ref, watch } from "vue";

export type ThemeKey = "light" | "dark" | "auto";

/** 设置页左侧分组；仅进程内记忆，不写入 localStorage */
export type SettingsNavGroup =
  | "appearance"
  | "ui"
  | "terminal"
  | "session"
  | "notify"
  | "app";

export interface AppSettings {
  theme: ThemeKey;
  fontFamily: string;
  fontSize: number; // UI 字号 px 12~18
  terminalFontSize: number; // 终端字号 px 11~20
  terminalFontFamily: string;
  /** 同时后台挂起的主机会话数上限（4~24） */
  maxRunningHosts: number;
  /** 企微通知总开关（关则不下发、不发企微；应用内/系统通知仍发） */
  notifyEnabled: boolean;
  /** 企微机器人 Webhook 完整 URL 或 key */
  wecomWebhook: string;
  /** 已订阅企微的主机名列表（点「订阅」写入；CPU 等告警仅对这些主机发企微） */
  wecomSubscribedHosts: string[];
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

const DEFAULTS: AppSettings = {
  theme: "auto",
  fontFamily: FONT_OPTIONS[0].value,
  fontSize: 14,
  terminalFontSize: 13,
  terminalFontFamily: TERMINAL_FONT_OPTIONS[0].value,
  maxRunningHosts: 12,
  notifyEnabled: true,
  wecomWebhook: "",
  wecomSubscribedHosts: [],
};

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
      wecomSubscribedHosts: Array.isArray(parsed.wecomSubscribedHosts)
        ? parsed.wecomSubscribedHosts.filter(
            (h): h is string => typeof h === "string" && !!h.trim()
          )
        : DEFAULTS.wecomSubscribedHosts,
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
  const wecomSubscribedHosts = ref<string[]>([...initial.wecomSubscribedHosts]);
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
      wecomSubscribedHosts: [...wecomSubscribedHosts.value],
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    localStorage.setItem("ipannel.theme", theme.value);
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
    document.documentElement.className = actual;
    document.documentElement.setAttribute("data-theme", actual);
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
    maxRunningHosts.value = clamp(v, 4, 24);
    persist();
  }

  function setNotifyEnabled(v: boolean) {
    notifyEnabled.value = v;
    persist();
  }

  function setWecomWebhook(v: string) {
    wecomWebhook.value = expandWecomWebhook(v);
    webhookDraft.value = wecomWebhook.value;
    persist();
  }

  /** 下发到 agent 时实际写入的 webhook（总开关关则空） */
  function effectiveWecomWebhook(): string {
    if (!notifyEnabled.value) return "";
    return expandWecomWebhook(wecomWebhook.value);
  }

  /** 该主机是否已订阅企微（资源告警才推群） */
  function isWecomSubscribed(host: string): boolean {
    const name = (host || "").trim();
    if (!name) return false;
    return wecomSubscribedHosts.value.includes(name);
  }

  function subscribeWecomHost(host: string) {
    const name = (host || "").trim();
    if (!name || wecomSubscribedHosts.value.includes(name)) return;
    wecomSubscribedHosts.value = [...wecomSubscribedHosts.value, name];
    persist();
  }

  function unsubscribeWecomHost(host: string) {
    const name = (host || "").trim();
    if (!name) return;
    const next = wecomSubscribedHosts.value.filter((h) => h !== name);
    if (next.length === wecomSubscribedHosts.value.length) return;
    wecomSubscribedHosts.value = next;
    persist();
  }

  function resetSettings() {
    theme.value = DEFAULTS.theme;
    fontFamily.value = DEFAULTS.fontFamily;
    fontSize.value = DEFAULTS.fontSize;
    terminalFontSize.value = DEFAULTS.terminalFontSize;
    terminalFontFamily.value = DEFAULTS.terminalFontFamily;
    maxRunningHosts.value = DEFAULTS.maxRunningHosts;
    notifyEnabled.value = DEFAULTS.notifyEnabled;
    wecomWebhook.value = DEFAULTS.wecomWebhook;
    wecomSubscribedHosts.value = [...DEFAULTS.wecomSubscribedHosts];
    webhookDraft.value = "";
    webhookTested.value = "";
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
    fontFamily,
    fontSize,
    terminalFontSize,
    terminalFontFamily,
    maxRunningHosts,
    notifyEnabled,
    wecomWebhook,
    wecomSubscribedHosts,
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
    setWecomWebhook,
    effectiveWecomWebhook,
    isWecomSubscribed,
    subscribeWecomHost,
    unsubscribeWecomHost,
    resetSettings,
    applyAll,
  };
});
