import { useState } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import { usePolling } from "@/hooks/usePolling";
import type { monitor } from "@wailsjs/go/models";
import { LoadingState, ErrorState } from "@/components/overview/States";
import { Package } from "lucide-react";

interface Props {
  host: string;
}

export function PackagesTab({ host }: Props) {
  const [filter, setFilter] = useState("");
  // 软件包列表很大，初始不拉，点刷新再拉
  const { data, error, loading, refresh } = usePolling<monitor.AptPackage[]>(
    () => api.collectPackages(host),
    0,
    [host]
  );

  const filtered = (data || []).filter((p) =>
    filter ? p.name.toLowerCase().includes(filter.toLowerCase()) : true
  );

  return (
    <Card className="h-full overflow-hidden">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2">
          <Package className="h-4 w-4" />
          已安装软件包
          {data && (
            <span className="ml-1 text-[10px] font-normal text-muted-foreground">
              共 {data.length} 个
            </span>
          )}
          <Input
            placeholder="过滤包名..."
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="ml-auto h-7 max-w-xs text-xs"
          />
          <button
            onClick={refresh}
            className="text-[10px] font-normal text-muted-foreground hover:text-foreground"
          >
            刷新
          </button>
        </CardTitle>
      </CardHeader>
      <CardContent className="h-[calc(100%-3rem)] overflow-auto">
        {loading && !data && <LoadingState />}
        {error && !data && <ErrorState message={error} />}
        {data && (
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-card">
              <tr className="border-b border-border">
                <th className="px-2 py-2 text-left font-medium text-muted-foreground">
                  包名
                </th>
                <th className="px-2 py-2 text-left font-medium text-muted-foreground">
                  版本
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.slice(0, 1000).map((p) => (
                <tr
                  key={p.name}
                  className="border-b border-border/30 hover:bg-accent/40"
                >
                  <td className="px-2 py-1.5 font-mono text-[11px]">{p.name}</td>
                  <td className="px-2 py-1.5 font-mono text-[11px] text-muted-foreground">
                    {p.version}
                  </td>
                </tr>
              ))}
              {filtered.length > 1000 && (
                <tr>
                  <td colSpan={2} className="px-2 py-3 text-center text-[10px] text-muted-foreground">
                    只显示前 1000 条，请用过滤缩小范围
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
        {data?.length === 0 && (
          <div className="py-12 text-center text-xs text-muted-foreground">
            无软件包数据
          </div>
        )}
      </CardContent>
    </Card>
  );
}
