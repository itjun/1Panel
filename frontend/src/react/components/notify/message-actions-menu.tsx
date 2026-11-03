import { Fragment, useEffect, useRef } from "react";
import { Popup } from "@/react/components/ui/popup";
import { cn } from "@/react/lib/utils";

export type MessageAction = {
  label: string;
  isDisabled?: boolean;
  isDanger?: boolean;
  isSeparated?: boolean;
  run: () => void;
};

export type MessageMenuTarget = {
  incidentId: string;
  anchor: HTMLElement;
  point?: { x: number; y: number };
};

/** 右键、行内按钮与详情共用菜单；操作对象由消息 ID 决定。 */
export function MessageActionsMenu({ target, label, items, onClose }: {
  target: MessageMenuTarget;
  label: string;
  items: MessageAction[];
  onClose: () => void;
}) {
  const anchorRef = useRef<HTMLElement | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  if (!target.point) anchorRef.current = target.anchor;

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      panelRef.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [target]);

  function close() {
    onClose();
    if (target.anchor.isConnected) target.anchor.focus({ preventScroll: true });
  }

  return (
    <>
      {target.point ? (
        <span
          ref={(node) => { anchorRef.current = node; }}
          aria-hidden
          className="pointer-events-none fixed size-0"
          style={{ left: target.point.x, top: target.point.y }}
        />
      ) : null}
      <Popup open anchorRef={anchorRef} onClose={close} className="max-h-[calc(100vh-16px)] overflow-y-auto py-1">
        <div
          ref={panelRef}
          role="menu"
          aria-label={label}
          onContextMenu={(event) => event.preventDefault()}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === "Tab") {
              close();
              return;
            }
            if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
            event.preventDefault();
            const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
            const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
            let next = (index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
            if (event.key === "Home") next = 0;
            if (event.key === "End") next = buttons.length - 1;
            buttons[next]?.focus();
          }}
        >
          {items.map((item, index) => (
            <Fragment key={item.label}>
              {item.isSeparated && index > 0 ? <div role="separator" className="my-1 border-t border-line" /> : null}
              <button
                type="button"
                role="menuitem"
                className={cn("notify-menu-item", item.isDanger && "text-danger")}
                disabled={item.isDisabled}
                onClick={() => {
                  close();
                  item.run();
                }}
              >
                {item.label}
              </button>
            </Fragment>
          ))}
        </div>
      </Popup>
    </>
  );
}
