type VisibleGroup = { element: HTMLElement; rect: DOMRect };

function visibleGroups(root: HTMLElement, viewport: HTMLElement): VisibleGroup[] {
  const bounds = viewport.getBoundingClientRect();
  const top = Math.max(0, bounds.top);
  const bottom = Math.min(window.innerHeight, bounds.bottom);
  return Array.from(root.querySelectorAll<HTMLElement>("[data-drop-group]"))
    .map(element => ({ element, rect: element.getBoundingClientRect() }))
    .filter(({ rect }) => rect.height > 0 && rect.bottom > top && rect.top < bottom &&
      rect.right > bounds.left && rect.left < bounds.right)
    .sort((a, b) => a.rect.top - b.rect.top || a.rect.left - b.rect.left);
}

/** 分组作为整体短距离滑入，卡片之间保持原有相对位置。 */
export function revealHostGroups(root: HTMLElement, viewport: HTMLElement): Animation[] {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return [];
  return visibleGroups(root, viewport).flatMap(({ element }, index) => {
    if (typeof element.animate !== "function") return [];
    return [element.animate([
      { opacity: 0, transform: "translateY(14px)" },
      { opacity: 1, transform: "translateY(0)" },
    ], {
      duration: 300,
      delay: Math.min(index * 45, 120),
      easing: "cubic-bezier(0.22, 1, 0.36, 1)",
      fill: "backwards",
    })];
  });
}

/** 请求前保留旧画面，成功后与新画面原位交叉淡化；失败、离页和用户操作会清理。 */
export function captureHostRackRefresh(root: HTMLElement, viewport: HTMLElement) {
  const overlay = document.createElement("div");
  overlay.dataset.rackRefreshSnapshot = "";
  overlay.setAttribute("aria-hidden", "true");
  overlay.inert = true;
  const bounds = viewport.getBoundingClientRect();
  Object.assign(overlay.style, {
    position: "absolute", top: `${viewport.scrollTop}px`, left: `${viewport.scrollLeft}px`,
    width: `${viewport.clientWidth}px`, height: `${viewport.clientHeight}px`,
    overflow: "hidden", pointerEvents: "none", zIndex: "1",
  });
  const isReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!isReduced) {
    for (const { element, rect } of visibleGroups(root, viewport)) {
      const clone = element.cloneNode(true) as HTMLElement;
      for (const node of [clone, ...clone.querySelectorAll<HTMLElement>("[id], [data-drop-group], [data-host-sort]")]) {
        node.removeAttribute("id");
        node.removeAttribute("data-drop-group");
        node.removeAttribute("data-host-sort");
      }
      Object.assign(clone.style, {
        position: "absolute", left: `${rect.left - bounds.left}px`, top: `${rect.top - bounds.top}px`,
        width: `${rect.width}px`, height: `${rect.height}px`, margin: "0", transform: "none", opacity: "1",
      });
      overlay.append(clone);
    }
  }
  let frame = 0;
  let isDisposed = false;
  let animations: Animation[] = [];
  const dispose = () => {
    isDisposed = true;
    cancelAnimationFrame(frame);
    animations.forEach(animation => animation.cancel());
    animations = [];
    overlay.remove();
    overlay.replaceChildren();
    viewport.removeEventListener("scroll", dispose);
    viewport.removeEventListener("pointerdown", dispose);
    window.removeEventListener("resize", dispose);
  };
  viewport.addEventListener("scroll", dispose, { passive: true });
  viewport.addEventListener("pointerdown", dispose, { passive: true });
  window.addEventListener("resize", dispose);
  return {
    dispose,
    play() {
      if (isDisposed) return;
      if (isReduced || !overlay.childElementCount) { dispose(); return; }
      frame = requestAnimationFrame(() => {
        if (isDisposed) return;
        if (!root.isConnected || !viewport.isConnected ||
          window.matchMedia("(prefers-reduced-motion: reduce)").matches) { dispose(); return; }
        viewport.append(overlay);
        const timing = { duration: 220, easing: "ease-in-out" };
        animations = [
          overlay.animate([{ opacity: 1 }, { opacity: 0 }], timing),
          ...visibleGroups(root, viewport).map(({ element }) =>
            element.animate([{ opacity: 0 }, { opacity: 1 }], timing)),
        ];
        void Promise.all(animations.map(animation => animation.finished.catch(() => {}))).then(dispose);
      });
    },
  };
}
