import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";
import { cn } from "@/react/lib/utils";

const buttonVariants = cva(
  "inline-flex box-border items-center justify-center gap-2 whitespace-nowrap rounded-control text-sm font-normal leading-none motion-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        /* 主操作才用 primary，字重 600；其余 400（DESIGN.md §3.3 只用 400 / 600） */
        primary:
          "bg-accent font-semibold text-white hover:bg-accent-hover active:bg-accent-active",
        secondary: "bg-raised text-ink hover:bg-line",
        /* 没有 danger-hover token，hover 用整体透明度而非 bg-danger/90（后者会生成 color-mix） */
        danger: "bg-danger text-white hover:opacity-90 active:opacity-100",
        ghost: "text-ink hover:bg-raised",
      },
      size: {
        /* 默认 32px / 小 28px */
        default: "h-8 px-3",
        sm: "h-7 px-2 text-xs",
      },
    },
    defaultVariants: {
      variant: "secondary",
      size: "default",
    },
  },
);

export function Button({
  className,
  variant,
  size,
  asChild = false,
  type = "button",
  ...props
}: ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "button";
  // data-variant 供 globals.css 在顶栏（canvas 底）里单独提亮 secondary / ghost
  return (
    <Comp
      type={asChild ? undefined : type}
      data-variant={variant ?? "secondary"}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  );
}
