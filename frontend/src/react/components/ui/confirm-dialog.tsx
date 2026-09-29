import { AlertCircle, Info } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Button } from "@/react/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@/react/components/ui/dialog";
import { cn } from "@/react/lib/utils";

/*
  确认框 / 提示框（照 TDesign DialogPlugin.confirm / alert），替代系统原生弹窗。

  - confirmDialog({...}) 返回 Promise<boolean>：点确认为 true，取消 / Esc / 点遮罩为 false。
  - alertDialog({...}) 只有一个「知道了」，关闭后 resolve。
  - 需要在应用根部挂一个 <DialogHost />；同一时刻只显示一个，后来的排队。
*/

type Theme = "info" | "warning" | "danger";

type DialogRequest = {
  kind: "confirm" | "alert";
  theme: Theme;
  title: string;
  body?: ReactNode;
  confirmText: string;
  cancelText: string;
  resolve: (ok: boolean) => void;
};

type DialogOptions = {
  title: string;
  body?: ReactNode;
  theme?: Theme;
  confirmText?: string;
  cancelText?: string;
};

const queue: DialogRequest[] = [];
let notify: (() => void) | null = null;

function enqueue(request: DialogRequest) {
  queue.push(request);
  notify?.();
}

export function confirmDialog(options: DialogOptions): Promise<boolean> {
  return new Promise((resolve) => {
    enqueue({
      kind: "confirm",
      theme: options.theme ?? "warning",
      title: options.title,
      body: options.body,
      confirmText: options.confirmText ?? "确定",
      cancelText: options.cancelText ?? "取消",
      resolve,
    });
  });
}

export function alertDialog(options: DialogOptions): Promise<void> {
  return new Promise((resolve) => {
    enqueue({
      kind: "alert",
      theme: options.theme ?? "info",
      title: options.title,
      body: options.body,
      confirmText: options.confirmText ?? "知道了",
      cancelText: "",
      resolve: () => resolve(),
    });
  });
}

const THEME_ICON_CLASS: Record<Theme, string> = {
  info: "text-info",
  warning: "text-warn",
  danger: "text-danger",
};

export function DialogHost() {
  const [current, setCurrent] = useState<DialogRequest | null>(null);

  useEffect(() => {
    function pull() {
      setCurrent((prev) => {
        if (prev) return prev;
        return queue.shift() ?? null;
      });
    }
    notify = pull;
    pull();
    return () => {
      notify = null;
    };
  }, []);

  function close(ok: boolean) {
    if (!current) return;
    current.resolve(ok);
    setCurrent(queue.shift() ?? null);
  }

  if (!current) return null;

  let Icon = AlertCircle;
  if (current.theme === "info") {
    Icon = Info;
  }

  let confirmVariant: "primary" | "danger" = "primary";
  if (current.theme === "danger" && current.kind === "confirm") {
    confirmVariant = "danger";
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close(false);
      }}
    >
      <DialogContent className="w-[min(420px,calc(100vw-32px))]">
        <div className="flex gap-3">
          <Icon
            aria-hidden
            className={cn("mt-0.5 size-5 shrink-0", THEME_ICON_CLASS[current.theme])}
            strokeWidth={1.5}
          />
          <div className="min-w-0 flex-1">
            <DialogTitle>{current.title}</DialogTitle>
            {current.body ? (
              <DialogDescription className="mt-2 text-sm break-words whitespace-pre-line text-muted">
                {current.body}
              </DialogDescription>
            ) : null}
          </div>
        </div>
        <DialogFooter>
          {current.kind === "confirm" ? (
            <Button onClick={() => close(false)}>{current.cancelText}</Button>
          ) : null}
          <Button variant={confirmVariant} autoFocus onClick={() => close(true)}>
            {current.confirmText}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
