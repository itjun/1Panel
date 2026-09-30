import { usageTone, type UsageTone } from "@/react/lib/usage-tone";
import { cn } from "@/react/lib/utils";

/**
 * LED 分段条（DESIGN.md §4.7）：所有「资源占比」统一用它，不再用细线进度条。
 * 8 格 4px 高、间隔 2px、圆角 1px；亮格颜色只走 --meter-ok / warn / danger，
 * 未亮格 --meter-off。无动画（颜色过渡走 .meter-cell 的 motion token）。
 */

export type MeterTone = "auto" | "ok" | "warn" | "danger";

export type MeterProps = {
  /** 百分比 0–100；NaN / undefined 视为无数据，全部显示未亮格 */
  value: number | undefined;
  /** 分段数，默认 8 */
  segments?: number;
  /** 右侧是否显示数值文字，默认 true（一位小数 + %） */
  showValue?: boolean;
  /** 自定义右侧文字（如负载 "0.17 / 8"）；传了就不再显示百分比 */
  valueText?: string;
  /** 颜色档：auto 按阈值自动（<60 ok，60–85 warn，≥85 danger） */
  tone?: MeterTone;
  className?: string;
  title?: string;
};

function resolveTone(value: number, tone: MeterTone): UsageTone {
  if (tone !== "auto") return tone;
  return usageTone(value);
}

function litCount(value: number, segments: number): number {
  if (value <= 0) return 0;
  let n = Math.round((value / 100) * segments);
  // 有值但不足一格时至少亮 1 格，避免「有负载却全灭」
  if (n < 1) n = 1;
  if (n > segments) n = segments;
  return n;
}

export function Meter({
  value,
  segments = 8,
  showValue = true,
  valueText,
  tone = "auto",
  className,
  title,
}: MeterProps) {
  const hasValue = typeof value === "number" && Number.isFinite(value);
  let percent = 0;
  if (hasValue) {
    percent = Math.min(100, Math.max(0, value));
  }

  const lit = hasValue ? litCount(percent, segments) : 0;
  const litColor = `var(--meter-${resolveTone(percent, tone)})`;

  let text: string | null = null;
  if (valueText !== undefined) {
    text = valueText;
  } else if (showValue) {
    text = hasValue ? `${percent.toFixed(1)}%` : "—";
  }

  const cells = [];
  for (let i = 0; i < segments; i++) {
    const on = i < lit;
    cells.push(
      <span
        key={i}
        className="meter-cell"
        style={{ backgroundColor: on ? litColor : "var(--meter-off)" }}
      />,
    );
  }

  return (
    <span
      className={cn("meter", className)}
      role="meter"
      aria-valuenow={hasValue ? percent : undefined}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuetext={text ?? undefined}
      data-tip={title}
    >
      <span className="meter-track" aria-hidden="true">
        {cells}
      </span>
      {text !== null ? (
        <span className="meter-value font-mono text-xs text-muted tabular-nums">{text}</span>
      ) : null}
    </span>
  );
}
