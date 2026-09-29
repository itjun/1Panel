import { Minus, Plus } from "lucide-react";
import { useEffect, useState, type KeyboardEvent } from "react";
import { cn } from "@/react/lib/utils";

/**
 * 数字输入框（照 TDesign InputNumber theme="row"）：[-] 数值 [+]。
 *
 * - 外框沿用 `.motion-field`；中间是普通文本框（inputMode=numeric），没有系统上下箭头。
 * - 输入时只接受数字；失焦 / Enter / 点 +- / ↑↓ 键时按 min、max 夹住并通过 onCommit 提交。
 * - 到达上下限时对应按钮禁用。
 */
export function InputNumber({
  value,
  onCommit,
  min = Number.MIN_SAFE_INTEGER,
  max = Number.MAX_SAFE_INTEGER,
  step = 1,
  disabled = false,
  className,
  "aria-label": ariaLabel,
}: {
  value: number;
  /** 值确定下来（失焦、回车、步进）时调用，拿到的已是夹好的整数 */
  onCommit: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  className?: string;
  "aria-label"?: string;
}) {
  const [text, setText] = useState(String(value));

  // 外部值变了（如保存后回写）同步到输入框
  useEffect(() => {
    setText(String(value));
  }, [value]);

  function commit(next: number) {
    const clamped = Math.min(Math.max(next, min), max);
    setText(String(clamped));
    onCommit(clamped);
  }

  function commitText() {
    const parsed = Number.parseInt(text, 10);
    if (Number.isNaN(parsed)) {
      setText(String(value));
      return;
    }
    commit(parsed);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      commitText();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      commit(value + step);
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      commit(value - step);
    }
  }

  const stepButton =
    "flex w-8 shrink-0 items-center justify-center text-muted motion-colors hover:text-accent disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:text-muted";

  return (
    <div
      className={cn(
        "motion-field inline-flex h-8 w-32 items-stretch overflow-hidden rounded-control text-sm",
        disabled && "opacity-50",
        className,
      )}
    >
      <button
        type="button"
        tabIndex={-1}
        aria-label="减少"
        disabled={disabled || value <= min}
        onClick={() => commit(value - step)}
        className={stepButton}
      >
        <Minus className="size-4" strokeWidth={1.5} />
      </button>
      <input
        type="text"
        inputMode="numeric"
        aria-label={ariaLabel}
        role="spinbutton"
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        disabled={disabled}
        value={text}
        onChange={(event) => setText(event.target.value.replace(/[^\d-]/g, ""))}
        onBlur={commitText}
        onKeyDown={onKeyDown}
        className="min-w-0 flex-1 bg-transparent text-center text-ink tabular-nums outline-none"
      />
      <button
        type="button"
        tabIndex={-1}
        aria-label="增加"
        disabled={disabled || value >= max}
        onClick={() => commit(value + step)}
        className={stepButton}
      >
        <Plus className="size-4" strokeWidth={1.5} />
      </button>
    </div>
  );
}
