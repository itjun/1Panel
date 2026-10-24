import type { ReactNode } from "react";
import { usageTone, type UsageTone } from "@/react/lib/usage-tone";
import "./resource-ring.css";

/** 概览连续圆环：与 Meter 共用占比阈值；未知或过期读数不显示有效弧。 */
export function ResourceRing({ value, label, valueText, children, tone }: {
  value?: number;
  label: string;
  valueText: string;
  children: ReactNode;
  tone?: UsageTone;
}) {
  const isKnown = typeof value === "number" && Number.isFinite(value) && value >= 0;
  const percent = isKnown ? Math.min(100, value) : 0;
  const color = `var(--meter-${tone || usageTone(percent)})`;
  return (
    <div className="resource-ring" role={isKnown ? "meter" : undefined}
      aria-label={label} aria-valuemin={isKnown ? 0 : undefined}
      aria-valuemax={isKnown ? 100 : undefined} aria-valuenow={isKnown ? percent : undefined}
      aria-valuetext={isKnown ? valueText : undefined}>
      <svg viewBox="0 0 128 128" aria-hidden="true">
        <circle cx="64" cy="64" r="52" fill="none" strokeWidth="7" strokeOpacity="0.65" style={{ stroke: "var(--meter-off)" }} />
        {isKnown && percent > 0 ? (
          <circle cx="64" cy="64" r="52" fill="none" strokeWidth="7" strokeLinecap="round"
            pathLength="100" strokeDasharray={`${percent} 100`} transform="rotate(-90 64 64)"
            style={{ stroke: color }} />
        ) : null}
      </svg>
      <div className="resource-ring-center">{children}</div>
    </div>
  );
}
