import { useEffect, useState } from "react";

/** 桌面端 TDesign 时长（毫秒），与 globals.css token 对齐。 */
export const MOTION_MS = {
  base: 200,
  moderate: 240,
  slow: 280,
} as const;

/** 操作成功提示条停留时长（毫秒），到点后用 MOTION_MS.base 淡出（DESIGN.md §5.2）。 */
export const TOAST_DISMISS_MS = 3000;

/**
 * 开合时保留挂载，好跑入场/离场动画。
 * 打开：先挂载（visible=false），下一帧再 visible=true。
 * 关闭：先 visible=false，等 durationMs 后再卸载。
 */
export function usePresence(open: boolean, durationMs: number = MOTION_MS.slow) {
  const [mounted, setMounted] = useState(open);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (open) {
      setMounted(true);
      setVisible(false);
      const id = requestAnimationFrame(() => {
        requestAnimationFrame(() => setVisible(true));
      });
      return () => cancelAnimationFrame(id);
    }
    setVisible(false);
    const timer = window.setTimeout(() => setMounted(false), durationMs);
    return () => window.clearTimeout(timer);
  }, [open, durationMs]);

  return { mounted, visible };
}
