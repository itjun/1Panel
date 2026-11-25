import { useLayoutEffect, useRef, useState, type RefObject } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";

/** 隐藏滚动条后，用上下箭头提示主机列表还有内容。 */
export function HostScrollHint({ viewport, content, isDragging }: {
  viewport: RefObject<HTMLDivElement | null>;
  content: RefObject<HTMLDivElement | null>;
  isDragging: boolean;
}) {
  const [isMoreAbove, setIsMoreAbove] = useState(false);
  const [isMoreBelow, setIsMoreBelow] = useState(false);
  const upButtonRef = useRef<HTMLButtonElement>(null);
  const downButtonRef = useRef<HTMLButtonElement>(null);

  useLayoutEffect(() => {
    const scroller = viewport.current;
    const rack = content.current;
    if (!scroller || !rack) return;
    const measure = () => {
      const isScrollable = scroller.clientHeight > 0 && scroller.scrollHeight - scroller.clientHeight > 1;
      const isAbove = isScrollable && scroller.scrollTop > 1;
      const isBelow = isScrollable
        && scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop > 1;
      if ((!isAbove && document.activeElement === upButtonRef.current)
        || (!isBelow && document.activeElement === downButtonRef.current)) {
        scroller.focus({ preventScroll: true });
      }
      setIsMoreAbove(isAbove);
      setIsMoreBelow(isBelow);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(scroller);
    observer.observe(rack);
    scroller.addEventListener("scroll", measure, { passive: true });
    return () => {
      observer.disconnect();
      scroller.removeEventListener("scroll", measure);
    };
  }, [viewport, content]);

  function scrollToRow(direction: "up" | "down") {
    const scroller = viewport.current;
    if (!scroller) return;
    const bounds = scroller.getBoundingClientRect();
    const isUp = direction === "up";
    let nextTop = isUp ? -Infinity : Infinity;
    // 滚动到卡片时为分组标题预留空间。
    for (const card of content.current?.querySelectorAll<HTMLElement>("[data-host-row]") ?? []) {
      const rect = card.getBoundingClientRect();
      if (isUp && rect.top < bounds.top && rect.bottom < bounds.bottom - 48) {
        nextTop = Math.max(nextTop, scroller.scrollTop + rect.top - bounds.top - 48);
      } else if (!isUp && rect.bottom > bounds.bottom && rect.top > bounds.top + 48) {
        nextTop = Math.min(nextTop, scroller.scrollTop + rect.top - bounds.top - 48);
      }
    }
    scroller.scrollTo({
      top: Number.isFinite(nextTop) ? nextTop : scroller.scrollTop + scroller.clientHeight * (isUp ? -0.8 : 0.8),
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth",
    });
  }

  if (isDragging) return null;
  return (
    <>
      {isMoreAbove ? (
        <button
          ref={upButtonRef}
          type="button"
          className="host-home-scroll-hint"
          data-direction="up"
          aria-label="向上查看更多主机"
          title="向上查看更多主机"
          onClick={() => scrollToRow("up")}
        >
          <ChevronUp size={20} aria-hidden="true" />
        </button>
      ) : null}
      {isMoreBelow ? (
        <button
          ref={downButtonRef}
          type="button"
          className="host-home-scroll-hint"
          aria-label="向下查看更多主机"
          title="向下查看更多主机"
          onClick={() => scrollToRow("down")}
        >
          <ChevronDown size={20} aria-hidden="true" />
        </button>
      ) : null}
    </>
  );
}
