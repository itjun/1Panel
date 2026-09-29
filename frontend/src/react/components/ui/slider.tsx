import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { cn } from "@/react/lib/utils";

/**
 * 滑块（照 TDesign Slider）。
 *
 * - 4px 轨道：未选段 line、已选段 accent；16px 圆钮 = surface 底 + 2px accent 边。
 * - 悬停 / 拖动 / 键盘聚焦时，圆钮上方即时显示当前值（与 Tooltip 同款气泡）。
 * - 点轨道直接跳到该值；方向键 ±step，PageUp / PageDown ±10 步，Home / End 到两端。
 */
export function Slider({
  value,
  onChange,
  min = 0,
  max = 100,
  step = 1,
  formatTip,
  disabled = false,
  className,
  "aria-label": ariaLabel,
}: {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  /** 气泡里的文字，默认显示数字本身 */
  formatTip?: (value: number) => string;
  disabled?: boolean;
  className?: string;
  "aria-label"?: string;
}) {
  const railRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const [hovering, setHovering] = useState(false);
  const [focused, setFocused] = useState(false);

  const percent = ((clamp(value, min, max) - min) / (max - min)) * 100;
  let tipText = String(value);
  if (formatTip) {
    tipText = formatTip(value);
  }
  const showTip = !disabled && (dragging || hovering || focused);

  function emit(next: number) {
    const snapped = clamp(Math.round((next - min) / step) * step + min, min, max);
    if (snapped !== value) onChange(snapped);
  }

  function valueFromPointer(clientX: number): number {
    const rail = railRef.current;
    if (!rail) return value;
    const rect = rail.getBoundingClientRect();
    const ratio = clamp((clientX - rect.left) / rect.width, 0, 1);
    return min + ratio * (max - min);
  }

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (disabled || event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
    emit(valueFromPointer(event.clientX));
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    if (!dragging) return;
    emit(valueFromPointer(event.clientX));
  }

  function onPointerUp(event: PointerEvent<HTMLDivElement>) {
    if (!dragging) return;
    event.currentTarget.releasePointerCapture(event.pointerId);
    setDragging(false);
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (disabled) return;
    let next: number | null = null;
    if (event.key === "ArrowRight" || event.key === "ArrowUp") next = value + step;
    if (event.key === "ArrowLeft" || event.key === "ArrowDown") next = value - step;
    if (event.key === "PageUp") next = value + step * 10;
    if (event.key === "PageDown") next = value - step * 10;
    if (event.key === "Home") next = min;
    if (event.key === "End") next = max;
    if (next === null) return;
    event.preventDefault();
    emit(next);
  }

  return (
    <div
      ref={railRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onPointerEnter={() => setHovering(true)}
      onPointerLeave={() => setHovering(false)}
      className={cn(
        "relative flex h-4 w-48 touch-none items-center",
        disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer",
        className,
      )}
    >
      <div className="h-1 w-full rounded-full bg-line">
        <div className="h-full rounded-full bg-accent" style={{ width: `${percent}%` }} />
      </div>
      <div
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label={ariaLabel}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-valuetext={tipText}
        aria-disabled={disabled || undefined}
        onKeyDown={onKeyDown}
        onFocus={(event) => setFocused(event.currentTarget.matches(":focus-visible"))}
        onBlur={() => setFocused(false)}
        style={{ left: `${percent}%` }}
        className="absolute top-0 size-4 -translate-x-1/2 rounded-full border-2 border-accent bg-surface outline-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent-focus"
      >
        {showTip ? (
          <span className="pointer-events-none absolute bottom-full left-1/2 mb-2 -translate-x-1/2 rounded-control bg-tooltip px-2 py-1 text-xs leading-5 whitespace-nowrap text-tooltip-text tabular-nums">
            {tipText}
            <span
              aria-hidden
              className="absolute -bottom-1 left-1/2 size-2 -translate-x-1/2 rotate-45 bg-tooltip"
            />
          </span>
        ) : null}
      </div>
    </div>
  );
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(Math.max(n, lo), hi);
}
