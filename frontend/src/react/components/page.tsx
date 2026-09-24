import type { ReactNode } from "react";
import { cn } from "@/react/lib/utils";

export function Page({
  title,
  actions,
  children,
  dark = false,
}: {
  title?: string;
  actions?: ReactNode;
  children: ReactNode;
  dark?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex h-full min-h-0 min-w-0 flex-col",
        dark ? "bg-graphite text-graphite-text" : "bg-canvas text-ink",
      )}
    >
      {title || actions ? (
        <div className="flex min-h-14 shrink-0 flex-wrap items-center gap-3 border-b border-line px-4">
          {title ? <h1 className="text-base font-medium">{title}</h1> : null}
          <div className="ml-auto flex flex-wrap items-center gap-2">{actions}</div>
        </div>
      ) : null}
      <div className="flex min-h-0 flex-1 flex-col overflow-auto bg-surface">{children}</div>
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
        <div className="h-full bg-accent" style={{ width: `${width}%` }} />
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
          ? "shrink-0 border-b border-[#b97814]/30 bg-[#b97814]/10 px-4 py-2 text-sm text-[#76500f]"
          : "shrink-0 border-b border-[#d64545]/30 bg-[#d64545]/10 px-4 py-2 text-sm text-[#a83232]"
      }
    >
      {text}
    </p>
  );
}
