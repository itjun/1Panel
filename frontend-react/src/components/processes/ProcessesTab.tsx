import { useMemo, useState } from "react";
import {
  ColumnDef,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  SortingState,
  useReactTable,
} from "@tanstack/react-table";
import { Check, ChevronDown, ChevronUp, Copy, Skull, Sparkles } from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { api } from "@/lib/api";
import { usePolling } from "@/hooks/usePolling";
import { cn, formatBytes, formatDuration } from "@/lib/utils";
import type { monitor } from "@wailsjs/go/models";
import { LoadingState, ErrorState } from "@/components/overview/States";

interface ProcessesTabProps {
  host: string;
}

type View = "all" | "java";

export function ProcessesTab({ host }: ProcessesTabProps) {
  const [view, setView] = useState<View>("all");
  const [sorting, setSorting] = useState<SortingState>([
    { id: "cpu", desc: true },
  ]);
  const [filter, setFilter] = useState("");

  const fetcher = useMemo(() => {
    return view === "all"
      ? () => api.collectProcesses(host, 100)
      : () => api.collectJava(host);
  }, [host, view]);

  const { data, error, loading, refresh } = usePolling<monitor.ProcInfo[]>(
    fetcher,
    5000,
    [host, view]
  );

  const columns = useMemo<ColumnDef<monitor.ProcInfo>[]>(
    () => [
      {
        accessorKey: "pid",
        header: "PID",
        cell: ({ row }) => (
          <span className="tabular-nums text-muted-foreground">
            {row.original.pid}
          </span>
        ),
        size: 70,
      },
      { accessorKey: "user", header: "用户", size: 80 },
      {
        accessorKey: "cpu",
        header: "CPU%",
        cell: ({ row }) => (
          <span
            className={cn(
              "tabular-nums font-medium",
              row.original.cpu > 80
                ? "text-destructive"
                : row.original.cpu > 30
                ? "text-warning"
                : ""
            )}
          >
            {row.original.cpu.toFixed(1)}
          </span>
        ),
        size: 70,
      },
      {
        accessorKey: "mem",
        header: "MEM%",
        cell: ({ row }) => (
          <span
            className={cn(
              "tabular-nums font-medium",
              row.original.mem > 50 ? "text-warning" : ""
            )}
          >
            {row.original.mem.toFixed(1)}
          </span>
        ),
        size: 70,
      },
      {
        accessorKey: "rss",
        header: "RSS",
        cell: ({ row }) => (
          <span className="tabular-nums text-muted-foreground">
            {formatBytes(row.original.rss)}
          </span>
        ),
        size: 90,
      },
      {
        accessorKey: "elapsed",
        header: "运行时长",
        cell: ({ row }) => (
          <span className="tabular-nums text-muted-foreground">
            {formatDuration(row.original.elapsed)}
          </span>
        ),
        size: 90,
      },
      {
        accessorKey: "cmd",
        header: "启动命令",
        cell: ({ row }) => (
          <span
            className="block max-w-[480px] truncate font-mono text-[11px]"
            title={row.original.cmd}
          >
            {row.original.cmd}
          </span>
        ),
      },
      {
        id: "actions",
        header: "",
        cell: ({ row }) => <RowActions host={host} proc={row.original} onKilled={refresh} />,
        size: 40,
      },
    ],
    [host, refresh]
  );

  const table = useReactTable({
    data: data || [],
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    globalFilterFn: (row, _columnId, value) => {
      const p = row.original;
      return (
        p.cmd.toLowerCase().includes(value.toLowerCase()) ||
        p.user.toLowerCase().includes(value.toLowerCase()) ||
        String(p.pid).includes(value)
      );
    },
  });

  useMemo(() => {
    table.setGlobalFilter(filter);
  }, [filter, table]);

  if (loading && !data) return <LoadingState />;
  if (error && !data) return <ErrorState message={error} />;

  return (
    <div className="flex h-full flex-col">
      <div className="mb-2 flex items-center gap-2">
        <div className="flex h-8 items-center rounded-md bg-muted p-0.5">
          <button
            onClick={() => setView("all")}
            className={cn(
              "flex h-7 items-center rounded px-2.5 text-xs font-medium transition-colors",
              view === "all"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            全部进程
          </button>
          <button
            onClick={() => setView("java")}
            className={cn(
              "flex h-7 items-center gap-1 rounded px-2.5 text-xs font-medium transition-colors",
              view === "java"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <Sparkles className="h-3 w-3" />
            Java 进程
          </button>
        </div>
        <Input
          placeholder="按命令/用户/PID 过滤..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="h-8 max-w-xs text-xs"
        />
        <span className="ml-auto text-[10px] text-muted-foreground">
          {(data || []).length} 条
        </span>
      </div>

      <Card className="flex-1 overflow-hidden">
        <div className="h-full overflow-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-card">
              {table.getHeaderGroups().map((hg) => (
                <tr key={hg.id} className="border-b border-border">
                  {hg.headers.map((h) => (
                    <th
                      key={h.id}
                      className="px-2.5 py-2 text-left font-medium text-muted-foreground"
                      style={{ width: h.getSize() }}
                    >
                      {h.isPlaceholder ? null : (
                        <button
                          className={cn(
                            "flex items-center gap-1",
                            h.column.getCanSort() &&
                              "cursor-pointer hover:text-foreground"
                          )}
                          onClick={h.column.getToggleSortingHandler()}
                        >
                          {flexRender(
                            h.column.columnDef.header,
                            h.getContext()
                          )}
                          {h.column.getIsSorted() === "asc" && (
                            <ChevronUp className="h-3 w-3" />
                          )}
                          {h.column.getIsSorted() === "desc" && (
                            <ChevronDown className="h-3 w-3" />
                          )}
                        </button>
                      )}
                    </th>
                  ))}
                </tr>
              ))}
            </thead>
            <tbody>
              {table.getRowModel().rows.length === 0 && (
                <tr>
                  <td
                    colSpan={columns.length}
                    className="py-12 text-center text-xs text-muted-foreground"
                  >
                    {view === "java"
                      ? "未发现 Java 进程"
                      : "暂无进程数据"}
                  </td>
                </tr>
              )}
              {table.getRowModel().rows.map((row) => (
                <tr
                  key={row.id}
                  className="border-b border-border/50 transition-colors hover:bg-accent/50"
                >
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id} className="px-2.5 py-1.5">
                      {flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext()
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function RowActions({
  host,
  proc,
  onKilled,
}: {
  host: string;
  proc: monitor.ProcInfo;
  onKilled: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState<string | null>(null);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(proc.cmd);
      setLast("copied");
      setTimeout(() => setLast(null), 1500);
    } catch {
      setLast("failed");
      setTimeout(() => setLast(null), 1500);
    }
  };

  const kill = async (force: boolean) => {
    if (
      !confirm(
        `${force ? "强制结束" : "结束"}进程 ${proc.pid}?\n${proc.cmd.slice(0, 80)}`
      )
    )
      return;
    setBusy(true);
    try {
      await api.killProcess(host, proc.pid, force);
      onKilled();
    } catch (e) {
      alert(`结束失败: ${e}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          disabled={busy}
        >
          <span className="text-base leading-none">⋯</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={copy}>
          {last === "copied" ? (
            <Check className="h-3.5 w-3.5 text-success" />
          ) : (
            <Copy className="h-3.5 w-3.5" />
          )}
          复制启动命令
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={() => kill(false)}
          className="text-destructive focus:text-destructive"
        >
          <Skull className="h-3.5 w-3.5" />
          结束进程 (TERM)
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => kill(true)}
          className="text-destructive focus:text-destructive"
        >
          <Skull className="h-3.5 w-3.5" />
          强制结束 (KILL)
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
