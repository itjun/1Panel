import { RefreshCw } from "lucide-react";
import { Button } from "@/react/components/ui/button";

export function CurrentTextRefresh({ onRefresh, refreshing, disabled = false }: {
  onRefresh: () => void;
  refreshing: boolean;
  disabled?: boolean;
}) {
  return (
    <Button variant="ghost" size="sm" className="ml-auto w-7 px-0" onClick={onRefresh}
      disabled={disabled || refreshing} aria-label="刷新" aria-busy={refreshing}
      data-tip="刷新">
      <RefreshCw size={16} className={refreshing ? "animate-spin motion-reduce:animate-none" : ""} aria-hidden />
    </Button>
  );
}
