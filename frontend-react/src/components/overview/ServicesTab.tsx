import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { api } from "@/lib/api";
import { usePolling } from "@/hooks/usePolling";
import type { monitor } from "@wailsjs/go/models";
import { LoadingState, ErrorState } from "@/components/overview/States";
import { CheckCircle2 } from "lucide-react";

interface Props {
  host: string;
}

export function ServicesTab({ host }: Props) {
  const { data, error, loading } = usePolling<monitor.Service[]>(
    () => api.collectServices(host),
    30_000,
    [host]
  );
  if (loading && !data) return <LoadingState />;
  if (error && !data) return <ErrorState message={error} />;

  return (
    <Card className="h-full overflow-hidden">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4" />
          正在运行的 systemd 服务
          <span className="ml-auto text-[10px] font-normal text-muted-foreground">
            {(data || []).length} 个
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="h-[calc(100%-3rem)] overflow-auto">
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-3">
          {(data || []).map((s) => (
            <div
              key={s.name}
              className="flex items-center gap-2 rounded-md border border-border/60 px-2.5 py-1.5"
            >
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-success" />
              <span
                className="flex-1 truncate text-xs font-medium"
                title={s.name}
              >
                {s.name}
              </span>
              <Badge variant="outline" className="h-4 px-1 text-[9px]">
                {s.sub}
              </Badge>
            </div>
          ))}
        </div>
        {data?.length === 0 && (
          <div className="py-12 text-center text-xs text-muted-foreground">
            未采集到 systemd 服务（目标机可能不是 systemd）
          </div>
        )}
      </CardContent>
    </Card>
  );
}
