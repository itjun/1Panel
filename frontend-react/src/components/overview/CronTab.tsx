import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { api } from "@/lib/api";
import { usePolling } from "@/hooks/usePolling";
import type { monitor } from "@wailsjs/go/models";
import { LoadingState, ErrorState } from "@/components/overview/States";
import { ScrollText } from "lucide-react";

interface Props {
  host: string;
}

const SOURCE_LABEL: Record<string, string> = {
  user: "用户",
  "etc-crontab": "系统主表",
  "etc-cron.d": "扩展",
};

export function CronTab({ host }: Props) {
  const { data, error, loading, refresh } = usePolling<monitor.Cron[]>(
    () => api.collectCrons(host),
    0, // 不自动刷新，避免每次都触发
    [host]
  );

  if (loading && !data) return <LoadingState />;
  if (error && !data) return <ErrorState message={error} />;

  return (
    <Card className="h-full overflow-hidden">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2">
          <ScrollText className="h-4 w-4" />
          定时任务
          <button
            onClick={refresh}
            className="ml-auto text-[10px] font-normal text-muted-foreground hover:text-foreground"
          >
            刷新
          </button>
        </CardTitle>
      </CardHeader>
      <CardContent className="h-[calc(100%-3rem)] overflow-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-card">
            <tr className="border-b border-border">
              <th className="px-2 py-2 text-left font-medium text-muted-foreground">
                来源
              </th>
              <th className="px-2 py-2 text-left font-medium text-muted-foreground">
                用户
              </th>
              <th className="px-2 py-2 text-left font-medium text-muted-foreground">
                调度
              </th>
              <th className="px-2 py-2 text-left font-medium text-muted-foreground">
                命令
              </th>
            </tr>
          </thead>
          <tbody>
            {(data || []).map((c, idx) => {
              const fields = c.line.split(/\s+/);
              const isSystem = c.source !== "user";
              const schedule = fields.slice(0, isSystem ? 5 : 5).join(" ");
              const cmd = isSystem ? fields.slice(6).join(" ") : fields.slice(5).join(" ");
              return (
                <tr
                  key={idx}
                  className="border-b border-border/40 hover:bg-accent/40"
                >
                  <td className="px-2 py-1.5">
                    <Badge variant="secondary" className="h-4 px-1.5 text-[9px]">
                      {SOURCE_LABEL[c.source] || c.source}
                    </Badge>
                  </td>
                  <td className="px-2 py-1.5 text-muted-foreground">
                    {c.user || "—"}
                  </td>
                  <td className="px-2 py-1.5 font-mono text-[11px]">
                    {schedule}
                  </td>
                  <td className="px-2 py-1.5 font-mono text-[11px] text-foreground/80">
                    <span className="block max-w-[640px] truncate" title={cmd}>
                      {cmd}
                    </span>
                  </td>
                </tr>
              );
            })}
            {data?.length === 0 && (
              <tr>
                <td colSpan={4} className="py-12 text-center text-xs text-muted-foreground">
                  未发现定时任务
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}
