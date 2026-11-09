import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Popup } from "@/react/components/ui/popup";

/** 概览的点击详情：沿用浮层定位、外点和 Esc 关闭，不在悬停时遮挡读数。 */
export function OverviewDetails({ label, trigger, children, className = "", popupClassName = "" }: {
  label: string;
  trigger: ReactNode;
  children: ReactNode;
  className?: string;
  popupClassName?: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const id = useId();

  useEffect(() => {
    if (!isOpen) return;
    const frame = requestAnimationFrame(() => content.current?.focus({ preventScroll: true }));
    function closeOnFocusOutside(event: FocusEvent) {
      const target = event.target as Node | null;
      if (target && !anchor.current?.contains(target) && !content.current?.contains(target)) setIsOpen(false);
    }
    window.addEventListener("focusin", closeOnFocusOutside);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("focusin", closeOnFocusOutside);
    };
  }, [isOpen]);

  return <>
    <button ref={anchor} type="button" className={`local-summary-trigger ${className}`}
      aria-label={label} aria-expanded={isOpen} aria-haspopup="dialog" aria-controls={isOpen ? id : undefined}
      onClick={() => setIsOpen(value => !value)}>
      {trigger}
    </button>
    <Popup open={isOpen} anchorRef={anchor} onClose={() => setIsOpen(false)} prefer="right" className={`local-summary-popup ${popupClassName}`}>
      <div ref={content} id={id} role="dialog" aria-label={label} tabIndex={-1}
        className="local-summary-details" onKeyDown={event => {
          if (event.key === "Tab") {
            const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], [tabindex="0"]'));
            const isAtStart = document.activeElement === event.currentTarget || document.activeElement === controls[0];
            const isAtEnd = !controls.length || document.activeElement === controls[controls.length - 1];
            if ((event.shiftKey && isAtStart) || (!event.shiftKey && isAtEnd)) {
              if (event.shiftKey) event.preventDefault();
              setIsOpen(false);
              anchor.current?.focus();
            }
          }
        }}>
        {children}
      </div>
    </Popup>
  </>;
}

export function DetailFact({ label, children }: { label: string; children: ReactNode }) {
  return <div className="local-summary-fact"><dt>{label}</dt><dd>{children}</dd></div>;
}
