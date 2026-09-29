import { Loader2 } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/react/lib/utils";

/**
 * 开关（照 TDesign Switch medium）：表示「开 / 关」这类立即生效的状态。
 *
 * - 36×20 胶囊轨道，16px 白色圆钮；关 = line-strong，开 = accent；圆钮位移走 --duration-base。
 * - loading 时圆钮里转圈并禁止切换；disabled 半透明。
 * - 传 children 时在右侧显示文字，点文字同样切换。
 */
export function Switch({
  checked,
  onChange,
  disabled = false,
  loading = false,
  className,
  children,
  "aria-label": ariaLabel,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  loading?: boolean;
  className?: string;
  children?: ReactNode;
  "aria-label"?: string;
}) {
  const inactive = disabled || loading;

  const button = (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      aria-busy={loading || undefined}
      disabled={inactive}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full motion-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent-focus",
        checked ? "bg-accent" : "bg-line-strong",
        inactive ? "cursor-not-allowed" : "cursor-pointer",
        disabled && "opacity-50",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "motion-switch-knob absolute top-0.5 left-0.5 flex size-4 items-center justify-center rounded-full bg-white",
          checked && "translate-x-4",
        )}
      >
        {loading ? (
          <Loader2
            className={cn("size-3 animate-spin", checked ? "text-accent" : "text-muted")}
            strokeWidth={2}
          />
        ) : null}
      </span>
    </button>
  );

  if (!children) {
    return <span className={cn("inline-flex", className)}>{button}</span>;
  }

  return (
    <label
      className={cn(
        "inline-flex items-center gap-2 text-sm text-ink select-none",
        inactive ? "cursor-not-allowed" : "cursor-pointer",
        className,
      )}
    >
      {button}
      <span>{children}</span>
    </label>
  );
}
