import type { MouseEvent as ReactMouseEvent, ReactNode } from "react";
import { cn } from "@/react/lib/utils";

/**
 * 小标签 / 状态胶囊（DESIGN.md §8.2）：--radius-tag 3px、高 20px、12px 字，
 * 浅底 + 对应功能文字色，无描边。颜色只表达状态，装饰性用途一律 neutral。
 */

export type TagTone = "neutral" | "ok" | "warn" | "danger" | "info" | "accent";

export type TagProps = {
  tone?: TagTone;
  className?: string;
  children: ReactNode;
  title?: string;
  onClick?: (event: ReactMouseEvent<HTMLSpanElement>) => void;
};

const TONE_CLASS: Record<TagTone, string> = {
  neutral: "bg-raised text-muted",
  ok: "bg-success-soft text-success-text",
  warn: "bg-warn-soft text-warn",
  danger: "bg-danger-soft text-danger",
  info: "bg-info-soft text-info",
  accent: "bg-accent-soft text-accent",
};

export function Tag({ tone = "neutral", className, children, title, onClick }: TagProps) {
  return (
    <span
      className={cn(
        "inline-flex h-5 max-w-full items-center whitespace-nowrap rounded-tag px-1.5 text-xs leading-none",
        TONE_CLASS[tone],
        onClick ? "cursor-pointer" : null,
        className,
      )}
      data-tip={title}
      onClick={onClick}
    >
      <span className="truncate">{children}</span>
    </span>
  );
}
