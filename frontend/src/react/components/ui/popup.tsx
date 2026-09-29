import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { cn } from "@/react/lib/utils";

/** 浮层离视口边缘至少留这么多 */
const VIEWPORT_MARGIN = 8;

export type Placement = "bottom" | "top";

const HIDDEN_STYLE: CSSProperties = {
  position: "fixed",
  top: 0,
  left: 0,
  visibility: "hidden",
};

type AnchorPositionOptions = {
  /** 优先放在哪一侧；该侧放不下且另一侧更宽裕时翻过去 */
  prefer?: Placement;
  /** 浮层与触发器之间的间距（px） */
  gap?: number;
  /** start：左边与触发器对齐；center：水平居中于触发器 */
  align?: "start" | "center";
  /** 浮层最小宽度跟随触发器宽度 */
  matchAnchorWidth?: boolean;
};

type AnchorPosition = {
  style: CSSProperties;
  placement: Placement;
  /** 触发器水平中心相对浮层左边的距离，给 Tooltip 画箭头用 */
  arrowLeft: number;
};

/**
 * 把一个 fixed 浮层贴到触发器旁边（Popup / Tooltip 共用）。
 *
 * - 在绘制前（useLayoutEffect）算好位置，首帧就在正确位置，不会闪到左上角。
 * - 优先侧放不下时翻到另一侧；左右越界时往里挪，保留视口边距。
 * - 打开期间跟随窗口大小变化和任意滚动容器滚动重算。
 */
export function useAnchorPosition(
  open: boolean,
  anchor: HTMLElement | null,
  panel: HTMLElement | null,
  { prefer = "bottom", gap = 4, align = "start", matchAnchorWidth = false }: AnchorPositionOptions = {},
): AnchorPosition {
  // 一开始就 fixed 定位，否则作为 body 里的块级元素会被量成整个视口宽
  const [position, setPosition] = useState<AnchorPosition>({
    style: HIDDEN_STYLE,
    placement: prefer,
    arrowLeft: 0,
  });

  useLayoutEffect(() => {
    if (!open || !anchor || !panel) return;
    const anchorEl = anchor;
    const panelEl = panel;

    function update() {
      const rect = anchorEl.getBoundingClientRect();
      // 先把最小宽度写上再量尺寸，否则第一次量到的是内容宽
      if (matchAnchorWidth) {
        panelEl.style.minWidth = `${rect.width}px`;
      }
      const panelHeight = panelEl.offsetHeight;
      const panelWidth = panelEl.offsetWidth;
      const viewportHeight = window.innerHeight;
      const viewportWidth = window.innerWidth;

      const spaceBelow = viewportHeight - rect.bottom - VIEWPORT_MARGIN;
      const spaceAbove = rect.top - VIEWPORT_MARGIN;
      let placement: Placement = prefer;
      if (prefer === "bottom" && panelHeight + gap > spaceBelow && spaceAbove > spaceBelow) {
        placement = "top";
      }
      if (prefer === "top" && panelHeight + gap > spaceAbove && spaceBelow > spaceAbove) {
        placement = "bottom";
      }

      let top = rect.bottom + gap;
      if (placement === "top") {
        top = rect.top - gap - panelHeight;
      }

      let left = rect.left;
      if (align === "center") {
        left = rect.left + rect.width / 2 - panelWidth / 2;
      }
      if (left + panelWidth > viewportWidth - VIEWPORT_MARGIN) {
        left = viewportWidth - VIEWPORT_MARGIN - panelWidth;
      }
      if (left < VIEWPORT_MARGIN) {
        left = VIEWPORT_MARGIN;
      }

      const style: CSSProperties = {
        position: "fixed",
        top: Math.round(top),
        left: Math.round(left),
        visibility: "visible",
      };
      if (matchAnchorWidth) {
        style.minWidth = rect.width;
      }
      setPosition({
        style,
        placement,
        arrowLeft: Math.round(rect.left + rect.width / 2 - left),
      });
    }

    update();
    window.addEventListener("resize", update);
    // capture 阶段监听，任何滚动容器滚动都能触发
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open, anchor, panel, prefer, gap, align, matchAnchorWidth]);

  // 关闭后清掉上次的位置，下次打开先隐藏再定位，避免闪到旧位置
  useLayoutEffect(() => {
    if (!open) {
      setPosition({ style: HIDDEN_STYLE, placement: prefer, arrowLeft: 0 });
    }
  }, [open, prefer]);

  return position;
}

/**
 * 通用下拉浮层（Select / DateRangePicker 共用）。
 *
 * - 挂到 document.body，按触发器位置定位在下方 4px；下方空间不够时翻到上方。
 * - 点浮层外部、按 Esc 关闭；关闭后焦点还给触发器。
 * - 外观按 DESIGN.md §8.1：surface 底 + 1px line 描边 + panel 圆角，无阴影。
 */
export function Popup({
  open,
  anchorRef,
  onClose,
  className,
  matchAnchorWidth = false,
  children,
}: {
  open: boolean;
  /** 触发器元素，用来算位置、判断外点、归还焦点 */
  anchorRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  className?: string;
  /** 浮层最小宽度是否跟随触发器宽度（Select 需要，日期面板不需要） */
  matchAnchorWidth?: boolean;
  children: ReactNode;
}) {
  const [panel, setPanel] = useState<HTMLDivElement | null>(null);
  const { style, placement } = useAnchorPosition(open, anchorRef.current, panel, {
    matchAnchorWidth,
  });

  // onClose 走 ref，调用方传内联函数时不必反复重绑监听
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // 外点 / Esc 关闭
  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node | null;
      if (!target) return;
      if (panel?.contains(target)) return;
      if (anchorRef.current?.contains(target)) return;
      onCloseRef.current();
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      // 在 window 捕获阶段拦下，Esc 只关浮层，不会顺带关掉外层 Dialog
      event.stopPropagation();
      event.preventDefault();
      onCloseRef.current();
      anchorRef.current?.focus();
    }

    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open, panel, anchorRef]);

  if (!open) return null;

  // pointer-events-auto：Radix 模态 Dialog 打开时会把 body 设成 pointer-events: none，
  // 浮层挂在 body 上要自己放开；React 事件沿组件树冒泡，Dialog 不会把它当成外部点击。
  return createPortal(
    <div
      ref={setPanel}
      data-placement={placement}
      style={style}
      className={cn(
        "react-popup motion-axis-y-in pointer-events-auto z-50 box-border rounded-panel border border-line bg-surface text-sm text-ink",
        className,
      )}
    >
      {children}
    </div>,
    document.body,
  );
}
