import { Badge } from "@/components/ui/badge";

// LoadBadge 根据 load1 与 CPU 核数比值显示负载状态徽章
// 阈值（按 grilling 决策不做告警，仅做颜色提示）：
//   - load1 / cpus < 0.7   → success（轻松）
//   - 0.7 .. 1.0           → secondary（正常）
//   - 1.0 .. 2.0           → warning（吃紧）
//   - > 2.0                → destructive（过载）
export function LoadBadge({ value, cpus }: { value: number; cpus: number }) {
  const ratio = cpus > 0 ? value / cpus : value;
  let variant: "success" | "secondary" | "warning" | "destructive" = "secondary";
  let label = "正常";
  if (ratio < 0.7) {
    variant = "success";
    label = "轻松";
  } else if (ratio <= 1.0) {
    variant = "secondary";
    label = "正常";
  } else if (ratio <= 2.0) {
    variant = "warning";
    label = "吃紧";
  } else {
    variant = "destructive";
    label = "过载";
  }
  return (
    <Badge variant={variant} className="mt-1 h-4 px-1.5 text-[9px]">
      {label}
    </Badge>
  );
}
