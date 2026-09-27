import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** 读取当前主题 CSS 变量（图表 / SVG 内联色用） */
export function readThemeColor(varName: string, fallback: string): string {
  if (typeof document === "undefined") return fallback;
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue(varName)
    .trim();
  return value || fallback;
}

/** 监控曲线按系列名取色：读/下行绿，写/上行橙，其余蓝 */
export function seriesColorByName(name: string, index = 0): string {
  const key = name.trim();
  if (
    key === "读" ||
    key === "下行" ||
    key === "接收" ||
    /^(read|rx|download|in)$/i.test(key)
  ) {
    return readThemeColor("--color-io-read", "#15803d");
  }
  if (
    key === "写" ||
    key === "上行" ||
    key === "发送" ||
    /^(write|tx|upload|out)$/i.test(key)
  ) {
    return readThemeColor("--color-io-write", "#ea580c");
  }
  const fallbacks = [
    readThemeColor("--color-chart-1", "#005eeb"),
    readThemeColor("--color-io-read", "#15803d"),
    readThemeColor("--color-io-write", "#ea580c"),
    readThemeColor("--color-chart-3", "#ea580c"),
  ];
  return fallbacks[index % fallbacks.length];
}

/** 多系列图的 color 数组，顺序与 series 一致 */
export function seriesColorList(names: string[]): string[] {
  return names.map((name, i) => seriesColorByName(name, i));
}

/** 与设置页共用同一份本地配置，预览窗沿用已选主题、字体和字号。 */
export function applySavedFont() {
  try {
    const raw = localStorage.getItem("ipannel.settings.v1");
    if (!raw) return;
    const parsed = JSON.parse(raw) as {
      appearance?: unknown;
      fontFamily?: unknown;
      fontSize?: unknown;
    };
    const appearance =
      parsed.appearance === "light" ||
      parsed.appearance === "dark" ||
      parsed.appearance === "system"
        ? parsed.appearance
        : "light";
    const root = document.documentElement;
    const resolved =
      appearance === "system"
        ? window.matchMedia("(prefers-color-scheme: dark)").matches
          ? "dark"
          : "light"
        : appearance;
    root.classList.remove("light", "dark");
    root.classList.add(resolved);
    root.style.colorScheme = resolved;
    root.style.background = "var(--color-canvas)";
    if (typeof parsed.fontFamily === "string" && parsed.fontFamily) {
      root.style.setProperty("--app-font-family", parsed.fontFamily);
    }
    if (typeof parsed.fontSize === "number" && Number.isFinite(parsed.fontSize)) {
      root.style.setProperty("--app-font-size", `${parsed.fontSize}px`);
    }
  } catch {
    /* 配置损坏时用默认字体 */
  }
}
