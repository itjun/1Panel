import type { HTMLAttributes } from "react";
import { cn } from "@/react/lib/utils";

/** 区块（DESIGN.md §8.2）：扁平化后无圆角、无阴影，与内容平面同色；悬停 / 聚焦也不显示边框 */
export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("surface-float p-5 text-ink", className)}
      {...props}
    />
  );
}
