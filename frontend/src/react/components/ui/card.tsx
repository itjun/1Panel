import type { HTMLAttributes } from "react";
import { cn } from "@/react/lib/utils";

/** 扁平表面：靠画布灰底托出，不描边、不加阴影 */
export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-surface bg-surface p-5 text-ink shadow-none",
        className,
      )}
      {...props}
    />
  );
}
