import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { applyColorPalette, paletteTokens, type PaletteMode } from "./color-palettes";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** 读取当前主题 CSS 变量（图表 / SVG 内联色用） */
export function readThemeColor(varName: string, fallback: string, mode?: PaletteMode): string {
  if (typeof document === "undefined") return fallback;
  if (mode && !document.documentElement.classList.contains("board-http")) {
    const color = paletteTokens(mode)[varName as `--${string}`];
    if (color) return color;
  }
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue(varName)
    .trim();
  return value || fallback;
}

/** 与设置页共用同一份本地配置，预览窗沿用已选主题、字体和字号。 */
export function applySavedFont(isBoard = false) {
  let parsed: Record<string, unknown> = {};
  try {
    const raw = localStorage.getItem("ipannel.settings.v1");
    const stored: unknown = raw ? JSON.parse(raw) : null;
    if (stored && typeof stored === "object" && !Array.isArray(stored)) {
      parsed = stored as Record<string, unknown>;
    }
  } catch {
    // 配置损坏或不可读取时，仍应用窗口的默认主题。
  }
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
  applyColorPalette(root, resolved);
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
}
