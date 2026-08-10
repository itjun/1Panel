import { AlertCircle, Loader2 } from "lucide-react";

export function LoadingState() {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="flex flex-col items-center gap-2 text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin" />
        <span className="text-xs">加载中...</span>
      </div>
    </div>
  );
}

export function ErrorState({ message }: { message: string }) {
  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="flex max-w-md flex-col items-center gap-3 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10">
          <AlertCircle className="h-6 w-6 text-destructive" />
        </div>
        <div>
          <div className="text-sm font-medium text-foreground">连接失败</div>
          <div className="mt-1 text-xs text-muted-foreground">
            {message}
          </div>
        </div>
        <div className="text-[10px] text-muted-foreground">
          将在 30 秒后自动重试
        </div>
      </div>
    </div>
  );
}
