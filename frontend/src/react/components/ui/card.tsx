import type { HTMLAttributes } from "react";
import { cn } from "@/react/lib/utils";

/** 悬浮表面：统一直角白底，落在磨砂上 */
export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("surface-float p-5 text-ink", className)}
      {...props}
    />
  );
}
