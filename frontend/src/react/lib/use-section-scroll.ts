import { useLayoutEffect, useRef, type RefObject } from "react";
import { sectionReadingPosition } from "@/react/lib/section-scroll";

type SectionScrollOptions<Section extends string> = {
  attribute: `data-${string}`;
  firstSection: Section;
  setReadingSection: (section: Section | null) => void;
  subscribeNavigation: (request: (section: Section) => void) => () => void;
};

export function useSectionScroll<Section extends string>(
  documentRef: RefObject<HTMLDivElement | null>,
  section: Section,
  { attribute, firstSection, setReadingSection, subscribeNavigation }: SectionScrollOptions<Section>,
) {
  const navigateRef = useRef<(section: Section, smooth: boolean) => void>(() => {});
  const initialSection = useRef(section);

  useLayoutEffect(() => {
    const document = documentRef.current;
    const viewport = document?.parentElement;
    if (!document || !viewport) return;
    let frame = 0;
    let pointer: number | null = null;
    let target: { section: Section; top: number; until: number } | null = null;
    let pinned: { section: Section; top: number } | null = null;
    const sections = () => Array.from(document.querySelectorAll<HTMLElement>(`[${attribute}]`))
      .filter((element) => element.getClientRects().length > 0);
    const offsets = () => {
      const origin = viewport.getBoundingClientRect().top;
      return sections().map((element) => ({
        id: element.getAttribute(attribute) as Section,
        top: element.getBoundingClientRect().top - origin + viewport.scrollTop,
      }));
    };
    const update = () => {
      cancelAnimationFrame(frame);
      if (target) {
        if (Math.abs(viewport.scrollTop - target.top) > 2 && performance.now() < target.until) {
          frame = requestAnimationFrame(update);
          return;
        }
        setReadingSection(target.section);
        target = null;
        return;
      }
      // Short final sections cannot always align with the viewport top. Keep an
      // explicit anchor selected through the browser's final smooth-scroll event.
      if (pinned) { setReadingSection(pinned.section); return; }
      setReadingSection(sectionReadingPosition(offsets(), viewport.scrollTop, viewport.clientHeight, viewport.scrollHeight, pointer, firstSection));
    };
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(update); };
    const navigate = (next: Section, smooth: boolean) => {
      const position = offsets().find((item) => item.id === next);
      if (!position) return;
      pointer = null;
      const top = next === firstSection ? 0 : Math.max(0, Math.min(position.top - 24, viewport.scrollHeight - viewport.clientHeight));
      target = { section: next, top, until: performance.now() + 1500 };
      pinned = { section: next, top };
      setReadingSection(next);
      viewport.scrollTo({ top, behavior: smooth && !window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "smooth" : "auto" });
      schedule();
    };
    const interrupt = (event?: Event) => {
      if (event?.target instanceof Element && event.target.closest("nav")) return;
      target = null;
      pinned = null;
      schedule();
    };
    const onScroll = () => {
      if (!target && pinned && Math.abs(viewport.scrollTop - pinned.top) > 2) pinned = null;
      schedule();
    };
    const onPointerMove = (event: PointerEvent) => {
      if (event.target instanceof Element && event.target.closest("nav")) return;
      pointer = event.clientY - viewport.getBoundingClientRect().top;
      if (!target) { pinned = null; schedule(); }
    };
    const onPointerLeave = () => { pointer = null; if (!target) schedule(); };
    navigateRef.current = navigate;
    const unsubscribe = subscribeNavigation((next) => navigate(next, true));
    viewport.addEventListener("scroll", onScroll, { passive: true });
    viewport.addEventListener("pointermove", onPointerMove, { passive: true });
    viewport.addEventListener("pointerleave", onPointerLeave);
    viewport.addEventListener("wheel", interrupt, { passive: true });
    viewport.addEventListener("touchstart", interrupt, { passive: true });
    viewport.addEventListener("pointerdown", interrupt);
    const onKey = (event: KeyboardEvent) => {
      if (["PageDown", "PageUp", "Home", "End", "ArrowDown", "ArrowUp", " "].includes(event.key)) interrupt();
    };
    viewport.addEventListener("keydown", onKey);
    const resize = new ResizeObserver(schedule);
    resize.observe(viewport);
    resize.observe(document);
    navigate(initialSection.current, false);
    return () => {
      unsubscribe();
      cancelAnimationFrame(frame);
      resize.disconnect();
      viewport.removeEventListener("scroll", onScroll);
      viewport.removeEventListener("pointermove", onPointerMove);
      viewport.removeEventListener("pointerleave", onPointerLeave);
      viewport.removeEventListener("wheel", interrupt);
      viewport.removeEventListener("touchstart", interrupt);
      viewport.removeEventListener("pointerdown", interrupt);
      viewport.removeEventListener("keydown", onKey);
      navigateRef.current = () => {};
      setReadingSection(null);
    };
  }, [documentRef, attribute, firstSection, setReadingSection, subscribeNavigation]);

  // Back/forward navigation remains supported, independently of passive reading.
  useLayoutEffect(() => { navigateRef.current(section, true); }, [section]);
}
