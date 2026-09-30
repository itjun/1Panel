import type { ReactNode } from "react";
import { usageTone, type UsageTone } from "@/react/lib/usage-tone";
import "./local.css";

/** 环色档位与 Meter 同阈值（DESIGN.md §4.7）；danger 入参强制危险档 */
function ringTone(pct: number, danger: boolean): UsageTone {
  if (danger) return "danger";
  return usageTone(pct);
}

/** SVG 环形占比图，悬停显示明细。概览大卡片专用；列表 / 表格内的占比一律用 <Meter> */
export function RingMeter({
  title,
  percent,
  danger = false,
  caption,
  children,
  center,
  showTitle = true,
}: {
  title: string;
  percent: number;
  danger?: boolean;
  caption?: ReactNode;
  children?: ReactNode;
  /** 环心文字。不传时显示整数百分比。 */
  center?: string;
  /** 卡片标题已在外面时，环内不再重复标题。 */
  showTitle?: boolean;
}) {
  const pct = Math.max(0, Math.min(100, Number(percent) || 0));
  const r = 42;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - pct / 100);
  const tone = ringTone(pct, danger);
  /* SVG 用 style 而非 stroke/fill 属性读 CSS 变量：presentation attribute 里的 var() 三端支持不一致 */
  const stroke = `var(--meter-${tone})`;
  const track = "var(--meter-off)";
  const centerFill = tone === "danger" ? "var(--color-danger)" : "var(--color-ink)";
  const centerText = center ?? `${pct.toFixed(0)}%`;

  return (
    <div className="local-ring">
      <div className="local-ring__wrap group relative">
        <svg viewBox="0 0 120 120" className="local-ring__svg" aria-hidden>
          <circle
            cx="60"
            cy="60"
            r={r}
            fill="none"
            style={{ stroke: track }}
            strokeWidth="10"
          />
          <circle
            cx="60"
            cy="60"
            r={r}
            fill="none"
            strokeWidth="10"
            strokeLinecap="round"
            strokeDasharray={c}
            strokeDashoffset={offset}
            transform="rotate(-90 60 60)"
            style={{
              stroke,
              transition:
                "stroke-dashoffset var(--duration-base, 200ms) var(--ease-standard, cubic-bezier(0.38, 0, 0.24, 1))",
            }}
            className="motion-ring-stroke"
          />
          {showTitle ? (
            <text
              x="60"
              y="56"
              textAnchor="middle"
              className="local-ring__title"
            >
              {title}
            </text>
          ) : null}
          <text
            x="60"
            y={showTitle ? 76 : 66}
            textAnchor="middle"
            className="local-ring__pct"
            style={{ fill: centerFill }}
          >
            {centerText}
          </text>
        </svg>
        {children ? (
          <div className="local-ring__pop pointer-events-none absolute left-1/2 top-full z-20 hidden w-max -translate-x-1/2 pt-2 group-hover:block">
            <div className="pointer-events-auto rounded-panel border border-line bg-surface px-3 py-2 text-left text-xs">
              {children}
            </div>
          </div>
        ) : null}
      </div>
      {caption ? <div className="local-ring__caption">{caption}</div> : null}
    </div>
  );
}
