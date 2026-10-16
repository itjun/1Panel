import { useLayoutEffect, useRef, type RefObject } from "react";
import { MOTION_MS } from "@/react/lib/motion";

/** Keep a spatial reference when saved group/host order changes after a drop. */
export function useHostRackMotion(root: RefObject<HTMLElement | null>, layoutKey: string, enabled: boolean, collapseKey: string) {
  const previous = useRef(new Map<string, { x: number; y: number }>());
  const animations = useRef<Animation[]>([]);

  useLayoutEffect(() => {
    // Collapse is already animated by CSS. Its old positions must not be used
    // by a later reorder after the transition has finished.
    previous.current.clear();
    animations.current.forEach((animation) => animation.cancel());
  }, [collapseKey]);

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
        if (!enabled || reduced || typeof element.animate !== "function") continue;
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
    // Measure every child before moving any parent, or its transform is counted twice.
    animations.current = changes.map(({ element, frames }) => element.animate(frames, {
      duration: MOTION_MS.moderate,
      easing: "cubic-bezier(0.38, 0, 0.24, 1)",
    }));
    return () => { animations.current.forEach((animation) => animation.cancel()); };
  }, [root, layoutKey, enabled]);
}
