import { RefreshCw, Plus, Server } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useApp } from "@/store/app";

export function TopBar() {
  const { refresh, loading } = useApp();
  return (
    <div className="drag-region flex h-12 shrink-0 items-center justify-between border-b border-border bg-background/80 px-4 backdrop-blur">
      <div className="flex items-center gap-2">
        <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
          <Server className="h-4 w-4" />
        </div>
        <span className="text-sm font-semibold tracking-tight">ServerPanel</span>
        <span className="ml-2 rounded-md bg-secondary px-1.5 py-0.5 text-[10px] font-medium text-secondary-foreground">
          local
        </span>
      </div>
      <div className="no-drag flex items-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={refresh}
          disabled={loading}
          className="h-8 gap-1.5 text-xs"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          刷新
        </Button>
        <Button variant="default" size="sm" className="h-8 gap-1.5 text-xs">
          <Plus className="h-3.5 w-3.5" />
          添加主机
        </Button>
      </div>
    </div>
  );
}
