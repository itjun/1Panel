import { useSyncExternalStore } from "react";
import type { PaletteMode } from "./color-palettes";

export function readThemeSignature(): PaletteMode {
  if (typeof document === "undefined") return "light";
  const root = document.documentElement;
  return root.classList.contains("dark") ? "dark" : "light";
}

function subscribe(listener: () => void) {
  const observer = new MutationObserver(listener);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  return () => observer.disconnect();
}

/** 图表读取 CSS 色值后会缓存 option；明暗变化都必须重新构建。 */
export function useThemeSignature(): PaletteMode {
  return useSyncExternalStore(subscribe, readThemeSignature, () => "light" as const);
}
