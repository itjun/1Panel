import { ChevronDown } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "@/react/components/ui/button";
import { Popup } from "@/react/components/ui/popup";

/** A keyboard-accessible action/column panel; existing actions keep their own handlers. */
export function ActionPopover({ label, children, closeOnAction = false }: {
  label: string;
  children: ReactNode;
  closeOnAction?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const id = requestAnimationFrame(() => panel.current?.querySelector<HTMLElement>("button:not(:disabled), input:not(:disabled)")?.focus());
    return () => cancelAnimationFrame(id);
  }, [open]);
  return <>
    <Button ref={anchor} size="sm" aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen(!open)}>
      {label}<ChevronDown size={14} />
    </Button>
    <Popup open={open} anchorRef={anchor} onClose={() => setOpen(false)} className="max-h-[70vh] min-w-44 overflow-auto p-2">
      <div ref={panel} role="dialog" aria-label={label} className="workbench-action-panel"
        onClick={e => {
          if (closeOnAction && (e.target as HTMLElement).closest("button")) {
            setOpen(false);
            anchor.current?.focus();
          }
        }}
        onKeyDown={e => {
          if (e.key !== "Tab") return;
          const controls = Array.from(e.currentTarget.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled)"));
          if ((e.shiftKey && document.activeElement === controls[0]) || (!e.shiftKey && document.activeElement === controls[controls.length - 1])) {
            e.preventDefault();
            setOpen(false);
            anchor.current?.focus();
          }
        }}>
        {children}
      </div>
    </Popup>
  </>;
}
