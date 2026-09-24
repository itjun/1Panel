import type { HTMLAttributes } from "react";
import { cn } from "@/react/lib/utils";

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
