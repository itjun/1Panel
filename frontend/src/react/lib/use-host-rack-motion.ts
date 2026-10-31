import { useLayoutEffect, useRef, type RefObject } from "react";
import { MOTION_MS } from "@/react/lib/motion";
import { revealHostGroups } from "@/react/lib/host-rack-reveal";

/** Keep a spatial reference when saved group/host order changes after a drop. */
export function useHostRackMotion({ root, viewport, layoutKey, isEnabled, resetKey, revealKey }: {
  root: RefObject<HTMLElement | null>;
  viewport: RefObject<HTMLElement | null>;
  layoutKey: string;
  isEnabled: boolean;
  resetKey: string;
  revealKey: string;
}) {
  const previous = useRef(new Map<string, { x: number; y: number }>());
  const animations = useRef<Animation[]>([]);
  const lastReveal = useRef<string | null>(null);

  useLayoutEffect(() => {
    // 首次测量列数、窗口重排与筛选使用统一显现，不能从旧布局飞入。
    // 折叠已有 CSS 动画，也不能把过渡前的位置留给下一次排序。
    previous.current.clear();
    animations.current.forEach((animation) => animation.cancel());
  }, [resetKey]);

  useLayoutEffect(() => {
    const rack = root.current;
    if (!rack || typeof ResizeObserver === "undefined") return;
    let width = rack.getBoundingClientRect().width;
    const observer = new ResizeObserver(() => {
      const nextWidth = rack.getBoundingClientRect().width;
      if (nextWidth === width) return;
      width = nextWidth;
      previous.current.clear();
      animations.current.forEach((animation) => animation.cancel());
    });
    observer.observe(rack);
    return () => observer.disconnect();
  }, [root]);

  useLayoutEffect(() => {
    animations.current.forEach((animation) => animation.cancel());
    animations.current = [];
    const rack = root.current;
    if (!rack) return;
    const next = new Map<string, { x: number; y: number }>();
    const changes: { element: HTMLElement; frames: Keyframe[] }[] = [];
    const isReveal = lastReveal.current !== revealKey;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const rackRect = rack.getBoundingClientRect();
    for (const section of rack.querySelectorAll<HTMLElement>("[data-drop-group]")) {
      const sectionRect = section.getBoundingClientRect();
      const id = section.dataset.dropGroup!;
      const elements = [{ element: section, key: `group:${id}`, origin: rackRect },
        ...Array.from(section.querySelectorAll<HTMLElement>("[data-host-sort]")).map((element) => ({
          element, key: `host:${id}:${element.dataset.hostSort}`, origin: sectionRect,
        }))];
      for (const { element, key, origin } of elements) {
        const rect = element.getBoundingClientRect();
        const point = { x: rect.left - origin.left, y: rect.top - origin.top };
        next.set(key, point);
        const before = previous.current.get(key);
        if (!isEnabled || isReveal || reduced || typeof element.animate !== "function") continue;
        if (!before) {
          if (previous.current.size > 0 && key.startsWith("host:")) {
            changes.push({ element, frames: [{ opacity: 0 }, { opacity: 1 }] });
          }
          continue;
        }
        const dx = before.x - point.x;
        const dy = before.y - point.y;
        if (Math.abs(dx) + Math.abs(dy) < 1) continue;
        changes.push({ element, frames: [
          { transform: `translate(${dx}px, ${dy}px)` },
          { transform: "translate(0, 0)" },
        ] });
      }
    }
    previous.current = next;
    // 等列数测量和当前提交完成，整屏只播放一次；轮询更新不会重播。
    if (isReveal && isEnabled) {
      const frame = requestAnimationFrame(() => {
        if (!viewport.current) return;
        if (!rack.querySelector("[data-host-sort]")) {
          // 空筛选也记下轮次，清空筛选后仍可显现；首次加载空列表则继续等待。
          if (lastReveal.current) lastReveal.current = revealKey;
          return;
        }
        animations.current = revealHostGroups(rack, viewport.current);
        lastReveal.current = revealKey;
      });
      return () => {
        cancelAnimationFrame(frame);
        animations.current.forEach((animation) => animation.cancel());
      };
    }
    // Measure every child before moving any parent, or its transform is counted twice.
    animations.current = changes.map(({ element, frames }) => element.animate(frames, {
      duration: MOTION_MS.moderate,
      easing: "cubic-bezier(0.38, 0, 0.24, 1)",
    }));
    return () => { animations.current.forEach((animation) => animation.cancel()); };
  }, [root, viewport, layoutKey, isEnabled, revealKey]);
}
