import type { ReactNode } from "react";
import { readThemeColor } from "@/react/lib/utils";
import "./local.css";

/** SVG 环形占比图，悬停显示明细 */
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
  const stroke = danger
    ? readThemeColor("--color-danger", "#d64545")
    : readThemeColor("--color-accent", "#005eeb");
  const track = readThemeColor("--color-line", "#dfe3e8");
  const centerFill = danger
    ? readThemeColor("--color-danger", "#d64545")
    : readThemeColor("--color-ink", "#20252b");
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
            stroke={track}
            strokeWidth="10"
          />
          <circle
            cx="60"
            cy="60"
            r={r}
            fill="none"
            stroke={stroke}
            strokeWidth="10"
            strokeLinecap="round"
            strokeDasharray={c}
            strokeDashoffset={offset}
            transform="rotate(-90 60 60)"
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
            fill={centerFill}
          >
            {centerText}
          </text>
        </svg>
        {children ? (
          <div className="local-ring__pop pointer-events-none absolute left-1/2 top-full z-20 hidden w-max -translate-x-1/2 pt-2 group-hover:block">
            <div className="pointer-events-auto rounded-surface border border-line bg-surface px-3 py-2 text-left text-xs shadow-md">
              {children}
            </div>
          </div>
        ) : null}
      </div>
      {caption ? <div className="local-ring__caption">{caption}</div> : null}
    </div>
  );
}
