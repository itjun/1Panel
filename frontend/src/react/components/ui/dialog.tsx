import * as DialogPrimitive from "@radix-ui/react-dialog";
import type { ComponentProps } from "react";
import { cn } from "@/react/lib/utils";

export function Dialog(props: ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root {...props} />;
}

export function DialogTrigger(
  props: ComponentProps<typeof DialogPrimitive.Trigger>,
) {
  return <DialogPrimitive.Trigger {...props} />;
}

export function DialogContent({
  className,
  children,
  ...props
}: ComponentProps<typeof DialogPrimitive.Content>) {
  return (
    <DialogPrimitive.Portal container={document.body}>
      <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center p-4">
        <DialogPrimitive.Overlay className="motion-dialog-overlay pointer-events-auto absolute inset-0 bg-scrim" />
        <DialogPrimitive.Content
          className={cn(
            "motion-dialog-content pointer-events-auto relative z-10 max-h-[calc(100vh-64px)] w-[min(480px,calc(100vw-32px))] overflow-auto rounded-panel border border-line bg-surface px-8 py-6 text-ink focus:outline-none",
            className,
          )}
          {...props}
        >
          {children}
        </DialogPrimitive.Content>
      </div>
    </DialogPrimitive.Portal>
  );
}

export function DialogTitle(
  props: ComponentProps<typeof DialogPrimitive.Title>,
) {
  return (
    <DialogPrimitive.Title
      className="text-base font-semibold text-ink"
      {...props}
    />
  );
}

/** 底栏按钮固定同一行、右对齐，高度与字号跟页面按钮一致。 */
export function DialogFooter({
  className,
  ...props
}: ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "mt-6 flex flex-nowrap items-center justify-end gap-2 [&_button]:shrink-0",
        className,
      )}
      {...props}
    />
  );
}

export function DialogDescription(
  props: ComponentProps<typeof DialogPrimitive.Description>,
) {
  return (
    <DialogPrimitive.Description
      className="mt-2 text-sm text-muted"
      {...props}
    />
  );
}
