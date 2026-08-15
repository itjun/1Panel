import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

export type ThemeKey =
  | "dark"
  | "light"
  | "midnight"
  | "forest"
  | "sakura"
  | "auto";

export interface Settings {
  theme: ThemeKey;
  fontFamily: string;
  fontSize: number; // px
  zoom: number; // 百分比 80~140
}

const DEFAULT_SETTINGS: Settings = {
  // 默认跟随系统外观自动切换亮（1Panel 白蓝）/暗
  theme: "auto",
  fontFamily:
    '"Helvetica Neue", Helvetica, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", Arial, sans-serif',
  fontSize: 14,
  zoom: 100,
};

const STORAGE_KEY = "serverpanel.settings";

// 字体选项（macOS 上常见且稳定的字体）
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
    label: "等宽：SF Mono",
    value:
      '"SF Mono", "JetBrains Mono", Menlo, Monaco, "Courier New", monospace',
  },
  {
    label: "等宽：JetBrains Mono",
    value:
      '"JetBrains Mono", "SF Mono", Menlo, Monaco, "Courier New", monospace',
  },
  {
    label: "等宽：Fira Code",
    value: '"Fira Code", "SF Mono", Menlo, Monaco, monospace',
  },
  {
    label: "衬线：New York",
    value: '"New York", "Times New Roman", "Songti SC", serif',
  },
  {
    label: "中文：苹方",
    value: '"PingFang SC", "Helvetica Neue", "Microsoft YaHei", sans-serif',
  },
  {
    label: "中文：思源黑体",
    value:
      '"Source Han Sans SC", "Source Han Sans CN", "PingFang SC", sans-serif',
  },
];

// 主题元信息（用于设置面板的卡片预览）
export const THEME_OPTIONS: {
  key: ThemeKey;
  name: string;
  description: string;
  // 预览色板（背景 + 主色）
  swatch: { bg: string; fg: string; accent: string };
}[] = [
  {
    key: "light",
    name: "明亮",
    description: "1Panel 白蓝：#f4f4f4 底 + #005eeb 主色",
    swatch: { bg: "#f4f4f4", fg: "#1f2329", accent: "#005eeb" },
  },
  {
    key: "dark",
    name: "暗黑",
    description: "1Panel 风深色，蓝灰底 + 亮蓝强调",
    swatch: { bg: "#242633", fg: "#e3e6f3", accent: "#3d8eff" },
  },
  {
    key: "auto",
    name: "跟随系统（推荐）",
    description: "根据系统外观自动切换亮/暗",
    swatch: {
      bg: "linear-gradient(135deg, #f4f4f4 50%, #242633 50%)",
      fg: "#888",
      accent: "#005eeb",
    },
  },
  {
    key: "midnight",
    name: "墨蓝",
    description: "深蓝背景，冰蓝点缀，开发者友好",
    swatch: { bg: "#0a1628", fg: "#dbeafe", accent: "#38bdf8" },
  },
  {
    key: "forest",
    name: "墨绿",
    description: "深墨绿背景，翡翠点缀",
    swatch: { bg: "#0f1a14", fg: "#d1f5e0", accent: "#34d399" },
  },
  {
    key: "sakura",
    name: "樱花",
    description: "粉调暖系，柔和不刺眼",
    swatch: { bg: "#fdf2f6", fg: "#7f1d3a", accent: "#ec4899" },
  },
];

interface SettingsContextValue {
  settings: Settings;
  updateSettings: (patch: Partial<Settings>) => void;
  resetSettings: () => void;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_SETTINGS, ...parsed };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

// resolveAutoTheme 仅处理 "auto" 主题：根据系统的 prefers-color-scheme 解析成 dark 或 light
// 其它主题（dark/light/midnight/forest/sakura）在 CSS 里都有对应的 [data-theme="..."] 定义，
// 应原样使用，不能映射成 dark，否则午夜/墨绿等自定义主题不会生效
function resolveAutoTheme(): "dark" | "light" {
  if (
    typeof window !== "undefined" &&
    window.matchMedia &&
    window.matchMedia("(prefers-color-scheme: light)").matches
  ) {
    return "light";
  }
  return "dark";
}

// applySettingsToDom 把设置应用到 :root 的 CSS 变量
function applySettingsToDom(s: Settings) {
  const root = document.documentElement;
  // auto → 根据系统解析；其它主题原样写入 data-theme
  const actual = s.theme === "auto" ? resolveAutoTheme() : s.theme;
  root.setAttribute("data-theme", actual);
  root.style.setProperty("--app-font-family", s.fontFamily);
  root.style.setProperty("--app-font-size", `${s.fontSize}px`);
  root.style.setProperty("--app-zoom", String(s.zoom));
}

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(() => loadSettings());

  // 设置变化时持久化 + 应用到 DOM
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    applySettingsToDom(settings);
  }, [settings]);

  // 监听系统主题变化（仅当 theme == auto 时实际生效）
  useEffect(() => {
    if (settings.theme !== "auto") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => applySettingsToDom(settings);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [settings]);

  const updateSettings = (patch: Partial<Settings>) =>
    setSettings((prev) => ({ ...prev, ...patch }));
  const resetSettings = () => setSettings(DEFAULT_SETTINGS);

  return (
    <SettingsContext.Provider value={{ settings, updateSettings, resetSettings }}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings() {
  const ctx = useContext(SettingsContext);
  if (!ctx)
    throw new Error("useSettings must be used within SettingsProvider");
  return ctx;
}
