import { X } from "lucide-react";
import { type ReactNode, useEffect } from "react";
import { cn } from "@/lib/utils";

interface DialogProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  className?: string;
  width?: string;
}

export function Dialog({
  open,
  onClose,
  title,
  children,
  className,
  width = "560px",
}: DialogProps) {
  // 按 Esc 关闭
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className={cn(
          "max-h-[90vh] overflow-auto rounded-xl border border-border bg-card shadow-2xl",
          className
        )}
        style={{ width }}
        onClick={(e) => e.stopPropagation()}
      >
        {title && (
          <div className="sticky top-0 flex items-center justify-between border-b border-border bg-card/95 px-5 py-3 backdrop-blur">
            <div className="text-sm font-semibold">{title}</div>
            <button
              onClick={onClose}
              className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}
