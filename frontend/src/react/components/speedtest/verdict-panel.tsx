import { Tag } from "@/react/components/ui/tag";
import { cn } from "@/react/lib/utils";
import { GRADE_TONE, type Grade, type PointTone, type Verdict } from "./verdict";

export const GRADE_TEXT: Record<Grade, string> = {
  great: "text-success-text",
  good: "text-info",
  fair: "text-warn",
  poor: "text-danger",
};

const DOT: Record<PointTone, string> = {
  ok: "bg-success",
  info: "bg-info",
  warn: "bg-warn",
  danger: "bg-danger",
};

/** 测速结论：大字等级 + 一句换算 + 逐条大白话解释 */
export function VerdictPanel({ verdict }: { verdict: Verdict }) {
  return (
    <div className="motion-fade-in flex flex-col gap-3 rounded-panel bg-raised p-4">
      <div className="flex min-w-0 items-baseline gap-3">
        <span className={cn("shrink-0 text-xl font-semibold", GRADE_TEXT[verdict.grade])}>{verdict.label}</span>
        <span className="min-w-0 text-sm text-ink">{verdict.headline}</span>
      </div>
      <ul className="flex flex-col gap-1.5">
        {verdict.points.map((p) => (
          <li key={p.text} className="flex items-start gap-2 text-sm text-ink">
            <span aria-hidden className={cn("mt-[0.45em] size-1.5 shrink-0 rounded-full", DOT[p.tone])} />
            <span className="min-w-0">{p.text}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** 表格 / 矩阵里的等级小标签 */
export function GradeTag({ verdict }: { verdict: Verdict | null }) {
  if (!verdict) return null;
  return (
    <Tag tone={GRADE_TONE[verdict.grade]} title={verdict.headline}>
      {verdict.label}
    </Tag>
  );
}
