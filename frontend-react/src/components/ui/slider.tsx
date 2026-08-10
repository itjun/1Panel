import { cn } from "@/lib/utils";

interface SliderProps {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  className?: string;
}

export function Slider({
  value,
  min,
  max,
  step = 1,
  onChange,
  className,
}: SliderProps) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <input
      type="range"
      value={value}
      min={min}
      max={max}
      step={step}
      onChange={(e) => onChange(Number(e.target.value))}
      className={cn(
        "h-1.5 w-full cursor-pointer appearance-none rounded-full bg-secondary outline-none",
        // 用 background gradient 表示当前值
        "[&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary [&::-webkit-slider-thumb]:shadow [&::-webkit-slider-thumb]:cursor-pointer",
        className
      )}
      style={{
        background: `linear-gradient(to right, hsl(var(--primary)) ${pct}%, hsl(var(--secondary)) ${pct}%)`,
      }}
    />
  );
}
