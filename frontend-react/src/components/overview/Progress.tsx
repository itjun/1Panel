import { cn } from "@/lib/utils";

interface ProgressProps {
  value: number; // 0-100
  className?: string;
  colorClass?: string; // 自定义前景色，覆盖默认
  indicatorClassName?: string;
}

export function Progress({
  value,
  className,
  colorClass,
}: ProgressProps) {
  const v = Math.max(0, Math.min(100, value));
  return (
    <div
      className={cn(
        // 1Panel 进度条：浅底 + 主色条
        "relative h-2 w-full overflow-hidden rounded-full bg-primary-soft",
        className
      )}
    >
      <div
        className={cn(
          "h-full rounded-full bg-primary transition-all duration-300 ease-out",
          colorClass
        )}
        style={{ width: `${v}%` }}
      />
    </div>
  );
}
