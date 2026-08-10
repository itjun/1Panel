import { useMemo, useState } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { api } from "@/lib/api";
import { usePolling } from "@/hooks/usePolling";
import type { monitor } from "@wailsjs/go/models";
import { LoadingState, ErrorState } from "@/components/overview/States";
import { Package, ArrowDown, ArrowUp, Search, RefreshCw, Upload } from "lucide-react";
import { cn } from "@/lib/utils";
import { useApp } from "@/store/app";

interface Props {
  host: string;
}

type SortKey = "name" | "version" | "depends";
type SortDir = "asc" | "desc";

export function PackagesTab({ host }: Props) {
  const { activeTabId, setSubTab, sendTerminalCmd } = useApp();
  const [filter, setFilter] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  // 切到终端并自动执行命令（apt update / apt upgrade）
  // apt upgrade -y 自动确认，但某些交互场景仍需用户手动 Y/N，终端原生支持
  const runInTerminal = (cmd: string) => {
    if (!activeTabId) return;
    sendTerminalCmd(cmd);
    setSubTab(activeTabId, "terminal");
  };

  // 软件包列表很大，初始不拉，点刷新再拉
  const { data, error, loading, refresh } = usePolling<monitor.AptPackage[]>(
    () => api.collectPackages(host),
    0,
    [host]
  );

  // 先过滤，再排序
  const filtered = useMemo(() => {
    if (!data) return [];
    const q = filter.trim().toLowerCase();
    let list = data;
    if (q) {
      list = data.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.version.toLowerCase().includes(q)
      );
    }
    const sorted = [...list].sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case "name":
          cmp = a.name.localeCompare(b.name);
          break;
        case "version":
          cmp = a.version.localeCompare(b.version);
          break;
        case "depends":
          cmp = a.depends - b.depends;
          break;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return sorted;
  }, [data, filter, sortKey, sortDir]);

  // 依赖数统计
  const stats = useMemo(() => {
    if (!data || data.length === 0) return null;
    let maxDeps = 0;
    let sumDeps = 0;
    for (const p of data) {
      if (p.depends > maxDeps) maxDeps = p.depends;
      sumDeps += p.depends;
    }
    return {
      total: data.length,
      maxDeps,
      avgDeps: Math.round((sumDeps / data.length) * 10) / 10,
    };
  }, [data]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  const SortIcon = ({ active }: { active: boolean }) =>
    active ? (
      sortDir === "asc" ? (
        <ArrowUp className="h-3 w-3" />
      ) : (
        <ArrowDown className="h-3 w-3" />
      )
    ) : null;

  return (
    <Card className="h-full overflow-hidden">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2">
          <Package className="h-4 w-4" />
          已安装软件包
          {stats && (
            <span className="ml-1 text-[10px] font-normal text-muted-foreground">
              共 {stats.total} 个 · 平均依赖 {stats.avgDeps} 个 · 最多{" "}
              {stats.maxDeps} 个依赖
            </span>
          )}
          <div className="relative ml-auto">
            <Search className="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="搜索包名/版本..."
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="h-7 w-64 pl-7 text-xs"
            />
          </div>
          <button
            onClick={refresh}
            className="text-[10px] font-normal text-muted-foreground hover:text-foreground"
          >
            <RefreshCw className="inline h-3 w-3" /> 刷新
          </button>
          <button
            onClick={() => runInTerminal("apt update")}
            className="flex items-center gap-1 rounded-md border border-border px-2 py-0.5 text-[10px] font-normal text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            title="在终端执行 apt update（检查可用更新）"
          >
            <RefreshCw className="h-3 w-3" />
            检查更新
          </button>
          <button
            onClick={() => runInTerminal("apt update && apt upgrade -y")}
            className="flex items-center gap-1 rounded-md bg-primary px-2 py-0.5 text-[10px] font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            title="在终端执行 apt update && apt upgrade -y（升级所有软件包，-y 自动确认常规提示；交互场景可手动输入 Y/N）"
          >
            <Upload className="h-3 w-3" />
            升级所有
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
                <th
                  className="cursor-pointer px-2 py-2 text-left font-medium text-muted-foreground hover:text-foreground"
                  onClick={() => toggleSort("name")}
                >
                  <span className="inline-flex items-center gap-1">
                    包名 <SortIcon active={sortKey === "name"} />
                  </span>
                </th>
                <th
                  className="cursor-pointer px-2 py-2 text-left font-medium text-muted-foreground hover:text-foreground"
                  onClick={() => toggleSort("version")}
                >
                  <span className="inline-flex items-center gap-1">
                    版本 <SortIcon active={sortKey === "version"} />
                  </span>
                </th>
                <th
                  className="cursor-pointer px-2 py-2 text-right font-medium text-muted-foreground hover:text-foreground"
                  onClick={() => toggleSort("depends")}
                >
                  <span className="inline-flex items-center gap-1">
                    依赖数 <SortIcon active={sortKey === "depends"} />
                  </span>
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.slice(0, 500).map((p) => (
                <tr
                  key={p.name}
                  className="border-b border-border/30 hover:bg-accent/40"
                >
                  <td className="px-2 py-1.5 font-mono text-[11px]">{p.name}</td>
                  <td className="px-2 py-1.5 font-mono text-[11px] text-muted-foreground">
                    {p.version}
                  </td>
                  <td className="px-2 py-1.5 text-right">
                    <Badge
                      variant="outline"
                      className={cn(
                        "h-5 px-1.5 text-[10px] tabular-nums",
                        p.depends >= 20
                          ? "border-warning/50 text-warning"
                          : p.depends >= 10
                          ? "border-primary/40 text-primary"
                          : "text-muted-foreground"
                      )}
                    >
                      {p.depends}
                    </Badge>
                  </td>
                </tr>
              ))}
              {filtered.length > 500 && (
                <tr>
                  <td
                    colSpan={3}
                    className="px-2 py-3 text-center text-[10px] text-muted-foreground"
                  >
                    只显示前 500 条（共 {filtered.length} 条匹配），请用搜索缩小范围
                  </td>
                </tr>
              )}
              {filtered.length === 0 && (
                <tr>
                  <td
                    colSpan={3}
                    className="px-2 py-8 text-center text-[11px] text-muted-foreground"
                  >
                    {filter ? `无匹配 "${filter}" 的包` : "无软件包数据"}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  );
}
