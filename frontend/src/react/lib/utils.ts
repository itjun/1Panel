import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** 与 Vue 设置页共用同一份本地配置，预览窗沿用已选字体和字号。 */
export function applySavedFont() {
  try {
    const raw = localStorage.getItem("ipannel.settings.v1");
    if (!raw) return;
    const parsed = JSON.parse(raw) as {
      fontFamily?: unknown;
      fontSize?: unknown;
    };
    const root = document.documentElement;
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
