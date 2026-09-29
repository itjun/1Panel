import {
  cloneElement,
  useEffect,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { useAnchorPosition } from "@/react/components/ui/popup";
import { cn } from "@/react/lib/utils";

/*
  文字提示（照 TDesign Tooltip 默认主题），替代浏览器原生 title。

  用法：在元素上写 data-tip="说明"（或用下面的 <Tooltip> / <Ellipsis>），
  全局只挂一个 <TooltipLayer />，用事件委托统一处理，不用给每个元素包一层。

  - 鼠标移入 / 键盘聚焦当帧显示，0 延迟、无入场动画；移开当帧隐藏。
  - 带 data-tip-overflow 的元素只在文字被截断时才提示（省略号看全名）。
  - pointer-events: none，不挡鼠标；层级高于对话框。
*/

/** 当前是否真的被截断（单行省略号） */
function isOverflowing(el: HTMLElement): boolean {
  return el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1;
}

/** 从事件目标往上找带 data-tip 的元素；需要截断才提示的，没截断就当没有 */
function findTipTarget(node: EventTarget | null): HTMLElement | null {
  if (!(node instanceof Element)) return null;
  const el = node.closest<HTMLElement>("[data-tip]");
  if (!el) return null;
  if (!el.dataset.tip) return null;
  if (el.hasAttribute("data-tip-overflow") && !isOverflowing(el)) return null;
  return el;
}

export function TooltipLayer() {
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const [text, setText] = useState("");
  const [bubble, setBubble] = useState<HTMLDivElement | null>(null);
  const { style, placement, arrowLeft } = useAnchorPosition(target !== null, target, bubble, {
    prefer: "top",
    gap: 8,
    align: "center",
  });

  useEffect(() => {
    function show(el: HTMLElement | null) {
      setTarget(el);
      setText(el?.dataset.tip ?? "");
    }

    function onPointerOver(event: PointerEvent) {
      show(findTipTarget(event.target));
    }

    function onPointerOut(event: PointerEvent) {
      // 移到窗口外 / 移到不带提示的元素上：relatedTarget 为空时也隐藏
      if (!findTipTarget(event.relatedTarget)) show(null);
    }

    function onFocusIn(event: FocusEvent) {
      const el = findTipTarget(event.target);
      // 只响应键盘聚焦，鼠标点击产生的聚焦不弹
      if (el && el.matches(":focus-visible")) show(el);
    }

    function hide() {
      show(null);
    }

    document.addEventListener("pointerover", onPointerOver, true);
    document.addEventListener("pointerout", onPointerOut, true);
    document.addEventListener("focusin", onFocusIn, true);
    document.addEventListener("focusout", hide, true);
    // 点下去就收起（TDesign 同样行为），避免挡住随后弹出的菜单
    document.addEventListener("pointerdown", hide, true);
    window.addEventListener("blur", hide);
    return () => {
      document.removeEventListener("pointerover", onPointerOver, true);
      document.removeEventListener("pointerout", onPointerOut, true);
      document.removeEventListener("focusin", onFocusIn, true);
      document.removeEventListener("focusout", hide, true);
      document.removeEventListener("pointerdown", hide, true);
      window.removeEventListener("blur", hide);
    };
  }, []);

  // 悬停期间提示文字变了（如「复制」→「已复制」）要跟着换；元素被移除就收起
  useEffect(() => {
    if (!target) return;
    const el = target;
    const observer = new MutationObserver(() => {
      if (!el.isConnected || !el.dataset.tip) {
        setTarget(null);
        return;
      }
      setText(el.dataset.tip);
    });
    observer.observe(el, { attributes: true, attributeFilter: ["data-tip"] });
    if (el.parentNode) {
      observer.observe(el.parentNode, { childList: true });
    }
    return () => observer.disconnect();
  }, [target]);

  if (!target || !text) return null;

  return createPortal(
    <div
      ref={setBubble}
      role="tooltip"
      style={style}
      className="react-popup pointer-events-none z-[1000] max-w-80 whitespace-pre-line break-words rounded-control bg-tooltip px-2 py-1 text-xs leading-5 text-tooltip-text"
    >
      {text}
      <span
        aria-hidden
        style={{ left: arrowLeft }}
        className={cn(
          "absolute size-2 -translate-x-1/2 rotate-45 bg-tooltip",
          placement === "top" ? "-bottom-1" : "-top-1",
        )}
      />
    </div>,
    document.body,
  );
}

/**
 * 给单个子元素加文字提示：<Tooltip content="刷新"><button … /></Tooltip>。
 * 等价于直接在子元素上写 data-tip，适合子元素是组件、不方便传属性的场合。
 */
export function Tooltip({
  content,
  children,
}: {
  content: string;
  children: ReactElement<{ "data-tip"?: string }>;
}) {
  return cloneElement(children, { "data-tip": content });
}

/**
 * 单行省略号文本，只有真的被截断时鼠标移上去才显示全名（照 TDesign Typography ellipsis）。
 */
export function Ellipsis({
  text,
  as: Tag = "span",
  className,
  children,
}: {
  /** 提示里显示的全文，默认就是 children（为字符串时） */
  text: string;
  as?: "span" | "code" | "div" | "p";
  className?: string;
  children?: ReactNode;
}) {
  return (
    <Tag data-tip={text} data-tip-overflow="" className={cn("truncate", className)}>
      {children ?? text}
    </Tag>
  );
}
