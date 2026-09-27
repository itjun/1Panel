import type { ReactNode } from "react";
import { cn } from "@/react/lib/utils";

export function Page({
  title,
  actions,
  children,
  dark = false,
  flush = false,
}: {
  title?: string;
  actions?: ReactNode;
  children: ReactNode;
  dark?: boolean;
  /** 左右分栏等需要贴边铺满时关掉内边距 */
  flush?: boolean;
}) {
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col text-ink">
      {title || actions ? (
        <div className="shell-top shell-toolbar drag-region flex shrink-0 items-center gap-3 px-5">
          {title ? <h1 className="text-base font-semibold leading-none">{title}</h1> : null}
          <div className="ml-auto flex items-center gap-2">{actions}</div>
        </div>
      ) : (
        <div className="shell-top shell-toolbar drag-region shrink-0" />
      )}
      <div
        className={cn(
          "content-float flex min-w-0 flex-1 flex-col",
          dark && "bg-graphite text-graphite-text",
          !flush && !dark && "gap-3 p-4",
        )}
      >
        {children}
      </div>
    </div>
  );
}

export function Meter({
  label,
  value,
  text,
}: {
  label: string;
  value: number;
  text?: string;
}) {
  const width = Math.max(0, Math.min(100, value || 0));
  return (
    <div className="min-w-[140px] flex-1">
      <div className="mb-1 flex items-baseline justify-between gap-3">
        <span className="text-sm text-muted">{label}</span>
        <span className="text-sm font-medium">{text || `${width.toFixed(1)}%`}</span>
      </div>
      <div className="h-1 overflow-hidden rounded-full bg-line">
        <div
          className="motion-width h-full bg-accent"
          style={{ width: `${width}%` }}
        />
      </div>
    </div>
  );
}

export function Notice({
  text,
  tone = "error",
}: {
  text: string;
  tone?: "error" | "warn";
}) {
  return (
    <p
      className={
        tone === "warn"
          ? "motion-notice-in shrink-0 rounded-control bg-warn-soft px-4 py-2 text-sm text-warn"
          : "motion-notice-in shrink-0 rounded-control bg-danger-soft px-4 py-2 text-sm text-danger"
      }
    >
      {text}
    </p>
  );
}
