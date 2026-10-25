import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { applyColorPalette, paletteTokens, parseColorPalette, type PaletteMode } from "./color-palettes";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** 读取当前主题 CSS 变量（图表 / SVG 内联色用） */
export function readThemeColor(varName: string, fallback: string, mode?: PaletteMode): string {
  if (typeof document === "undefined") return fallback;
  if (mode && !document.documentElement.classList.contains("board-http")) {
    const id = parseColorPalette(document.documentElement.dataset.colorPalette);
    const color = paletteTokens(id, mode)[varName as `--${string}`];
    if (color) return color;
  }
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue(varName)
    .trim();
  return value || fallback;
}

/** 监控曲线按系列名取色：读/流入亮蓝，写/流出橙，其余蓝（下行/上行等旧名兼容） */
export function seriesColorByName(name: string, index = 0, mode?: PaletteMode): string {
  const key = name.trim();
  if (
    key === "读" ||
    key === "下行" ||
    key === "流入" ||
    key === "接收" ||
    key === "已用" ||
    /^(read|rx|download|in)$/i.test(key)
  ) {
    return readThemeColor("--color-io-read", "#1d8cf8", mode);
  }
  if (
    key === "写" ||
    key === "上行" ||
    key === "流出" ||
    key === "发送" ||
    key === "交换" ||
    /^(write|tx|upload|out)$/i.test(key)
  ) {
    return readThemeColor("--color-io-write", "#f08a24", mode);
  }
  const fallbacks = [
    readThemeColor("--color-chart-1", "#0052d9", mode),
    readThemeColor("--color-io-read", "#1d8cf8", mode),
    readThemeColor("--color-io-write", "#f08a24", mode),
    readThemeColor("--color-chart-3", "#f08a24", mode),
  ];
  return fallbacks[index % fallbacks.length];
}

/** 多系列图的 color 数组，顺序与 series 一致 */
export function seriesColorList(names: string[], mode?: PaletteMode): string[] {
  return names.map((name, i) => seriesColorByName(name, i, mode));
}

/** 与设置页共用同一份本地配置，预览窗沿用已选主题、字体和字号。 */
export function applySavedFont(isBoard = false) {
  try {
    const raw = localStorage.getItem("ipannel.settings.v1");
    const parsed = JSON.parse(raw || "{}") as {
      appearance?: unknown;
      colorPalette?: unknown;
      fontFamily?: unknown;
      monoFontFamily?: unknown;
      fontSize?: unknown;
    };
    const appearance =
      parsed.appearance === "light" ||
      parsed.appearance === "dark" ||
      parsed.appearance === "system"
        ? parsed.appearance
        : "system";
    const root = document.documentElement;
    const resolved = isBoard ? "dark" :
      appearance === "system"
        ? window.matchMedia("(prefers-color-scheme: dark)").matches
          ? "dark"
          : "light"
        : appearance;
    root.classList.remove("light", "dark");
    root.classList.add(resolved);
    root.style.colorScheme = resolved;
    if (isBoard) {
      // HTTP 看板沿用 board.css 的原始深色值，不注入应用色系及其派生色。
      for (const name of Object.keys(paletteTokens("classic", "dark"))) {
        root.style.removeProperty(name);
        root.style.removeProperty(`--board-${name.slice(2)}`);
      }
      root.dataset.colorPalette = "classic";
    } else {
      applyColorPalette(root, parseColorPalette(parsed.colorPalette), resolved);
    }
    root.style.background = "var(--color-canvas)";
    if (typeof parsed.fontFamily === "string" && parsed.fontFamily) {
      root.style.setProperty("--app-font-family", parsed.fontFamily);
    }
    if (typeof parsed.monoFontFamily === "string" && parsed.monoFontFamily) {
      root.style.setProperty("--app-font-mono", parsed.monoFontFamily);
    }
    if (typeof parsed.fontSize === "number" && Number.isFinite(parsed.fontSize)) {
      root.style.setProperty("--app-font-size", `${parsed.fontSize}px`);
    }
  } catch {
    /* 配置损坏时用默认字体 */
  }
}
