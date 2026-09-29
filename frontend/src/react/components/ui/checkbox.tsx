import { Check, Minus } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/react/lib/utils";

/**
 * 多选框（照 TDesign Checkbox）。
 *
 * - 16px 方框、3px 圆角（--radius-tag）、1px line-strong 边；选中 / 半选为 accent 实底 + 白色图形。
 * - 悬停整行时边框变 accent；键盘聚焦显示 2px accent-focus 外环。
 * - 内部保留视觉隐藏的原生 input，键盘空格切换、表单语义都不丢。
 */
export function Checkbox({
  checked,
  onChange,
  indeterminate = false,
  disabled = false,
  className,
  children,
  "aria-label": ariaLabel,
  "data-tip": dataTip,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** 半选：部分子项被选中时用；显示横线，点击后按 checked 取反 */
  indeterminate?: boolean;
  disabled?: boolean;
  className?: string;
  /** 右侧文字，可不传（如表格格子里只要一个框） */
  children?: ReactNode;
  "aria-label"?: string;
  "data-tip"?: string;
}) {
  const filled = checked || indeterminate;

  let boxClass = "border-line-strong bg-surface group-hover:border-accent";
  if (filled) {
    boxClass = "border-accent bg-accent text-white";
  }

  return (
    <label
      data-tip={dataTip}
      className={cn(
        "group inline-flex items-center gap-2 text-sm text-ink select-none",
        disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer",
        className,
      )}
    >
      <input
        type="checkbox"
        className="peer sr-only"
        checked={checked}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-checked={indeterminate ? "mixed" : checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span
        aria-hidden
        className={cn(
          "flex size-4 shrink-0 items-center justify-center rounded-tag border motion-colors peer-focus-visible:outline-2 peer-focus-visible:outline-offset-1 peer-focus-visible:outline-accent-focus",
          boxClass,
        )}
      >
        {indeterminate ? <Minus className="size-3" strokeWidth={3} /> : null}
        {!indeterminate && checked ? <Check className="size-3" strokeWidth={3} /> : null}
      </span>
      {children ? <span className="min-w-0">{children}</span> : null}
    </label>
  );
}
