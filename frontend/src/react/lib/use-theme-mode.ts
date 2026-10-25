import { useSyncExternalStore } from "react";
import { parseColorPalette, type PaletteMode } from "./color-palettes";

export function readThemeSignature(): string {
  if (typeof document === "undefined") return "light:classic";
  const root = document.documentElement;
  const mode = root.classList.contains("dark") ? "dark" : "light";
  return `${mode}:${parseColorPalette(root.dataset.colorPalette)}`;
}

function subscribe(listener: () => void) {
  const observer = new MutationObserver(listener);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "data-color-palette"] });
  return () => observer.disconnect();
}

/** 图表读取 CSS 色值后会缓存 option；明暗或色系变化都必须重新构建。 */
export function useThemeSignature(): string {
  return useSyncExternalStore(subscribe, readThemeSignature, () => "light:classic");
}

export function useThemeMode(): PaletteMode {
  return useThemeSignature().startsWith("dark:") ? "dark" : "light";
}
