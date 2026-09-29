import { useEffect, useState } from "react";

function readThemeMode(): "light" | "dark" {
  if (typeof document === "undefined") return "light";
  if (document.documentElement.classList.contains("dark")) return "dark";
  return "light";
}

/**
 * 当前生效的亮 / 暗主题（看 <html> 上的 dark class，含「跟随系统」切换）。
 * 图表等把 CSS 变量读成字面色值的地方，用它作依赖在切主题后重算。
 */
export function useThemeMode(): "light" | "dark" {
  const [mode, setMode] = useState(readThemeMode);
  useEffect(() => {
    const observer = new MutationObserver(() => setMode(readThemeMode()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);
  return mode;
}
