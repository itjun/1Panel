import type { HTMLAttributes } from "react";
import { cn } from "@/react/lib/utils";

/** 扁平表面：落在磨砂上，用发丝边托出，不加阴影 */
export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-surface border border-line bg-surface p-5 text-ink shadow-none",
        className,
      )}
      {...props}
    />
  );
}
