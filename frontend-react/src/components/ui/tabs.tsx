import * as React from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import { cn } from "@/lib/utils";

const Tabs = TabsPrimitive.Root;

type TabsListVariant = "outline" | "solid";

const TabsListVariantContext = React.createContext<TabsListVariant>("outline");

const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List> & {
    /** outline: 1Panel 应用商店顶栏（蓝框选中）；solid: 流量/磁盘 分段实心 */
    variant?: TabsListVariant;
  }
>(({ className, variant = "outline", ...props }, ref) => (
  <TabsListVariantContext.Provider value={variant}>
    <TabsPrimitive.List
      ref={ref}
      data-variant={variant}
      className={cn(
        variant === "solid"
          ? // 分段实心组
            "inline-flex h-[30px] items-center justify-center overflow-hidden rounded border border-input bg-card text-muted-foreground"
          : // 1Panel 应用商店：独立标签，间距，选中蓝框
            "inline-flex flex-wrap items-center gap-2",
        className
      )}
      {...props}
    />
  </TabsListVariantContext.Provider>
));
TabsList.displayName = TabsPrimitive.List.displayName;

const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => {
  const variant = React.useContext(TabsListVariantContext);

  return (
    <TabsPrimitive.Trigger
      ref={ref}
      className={cn(
        "inline-flex items-center justify-center gap-1.5 whitespace-nowrap text-[13px] font-normal transition-all focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50",
        variant === "solid"
          ? // 实心分段：激活主色底白字
            "h-full border-r border-input px-3.5 last:border-r-0 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=inactive]:bg-card data-[state=inactive]:text-muted-foreground data-[state=inactive]:hover:text-primary"
          : // 蓝框选中（应用商店「全部 / 已安装」）
            // 未选：1px 透明边；选中：2px 主色边，避免跳动用固定 2px 透明/主色
            "h-[38px] rounded border-2 border-transparent bg-card px-5 text-muted-foreground hover:text-primary data-[state=active]:border-primary data-[state=active]:bg-card data-[state=active]:text-primary data-[state=inactive]:border-transparent",
        className
      )}
      {...props}
    />
  );
});
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName;

const TabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn(
      "mt-3 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
      className
    )}
    {...props}
  />
));
TabsContent.displayName = TabsPrimitive.Content.displayName;

export { Tabs, TabsList, TabsTrigger, TabsContent };
