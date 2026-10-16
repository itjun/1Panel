import { useQuery } from "@tanstack/react-query";
import { useMemo, useRef, useState } from "react";
import { api, type agentapi } from "@/api";
import { HighlightPane } from "@/react/components/local/highlight-pane";
import { Notice } from "@/react/components/page";
import { Button } from "@/react/components/ui/button";
import { Checkbox } from "@/react/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/react/components/ui/dialog";
import { Select } from "@/react/components/ui/select";
import { formatErr } from "@/utils/format";
import { APP_LOG_LEVELS, filterAppLogRecords, parseAppLogRecords, type AppLogLevel } from "@/utils/appLogFilter";
import { logHighlightHtml } from "@/utils/logHighlight";

export function AppLogDialog({
  host,
  row,
  onClose,
}: {
  host: string;
  row: agentapi.JavaAppInstance;
  onClose: () => void;
}) {
  const [lines, setLines] = useState(500);
  const [search, setSearch] = useState("");
  const [levels, setLevels] = useState<AppLogLevel[]>([]);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const processStart = useRef("");
  const query = useQuery({
    queryKey: ["app-log", host, row.pid, row.jarPath, row.port, row.screen, lines],
    queryFn: async () => {
      const result = await api.readAppLog(host, {
        pid: row.pid,
        jarPath: row.jarPath,
        port: row.port,
        screen: row.screen,
        processStart: processStart.current,
        lines,
      });
      processStart.current = result.processStart;
      return result;
    },
    retry: false,
    gcTime: 0,
    refetchOnWindowFocus: false,
    refetchInterval: (current) => autoRefresh && !current.state.error ? 5000 : false,
  });

  const records = useMemo(
    () => parseAppLogRecords(query.isError ? "" : query.data?.content || ""),
    [query.data?.content, query.isError],
  );
  const text = useMemo(() => filterAppLogRecords(records, levels, search), [records, levels, search]);
  const html = useMemo(() => logHighlightHtml(text), [text]);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex h-[80vh] max-h-[80vh] w-[80vw] max-w-[80vw] flex-col gap-3 overflow-hidden px-6 py-5">
        <div className="flex shrink-0 items-center justify-between gap-3">
          <DialogTitle>{row.service} · 进程日志</DialogTitle>
          <Button variant="ghost" size="sm" onClick={onClose}>关闭</Button>
        </div>
        <DialogDescription className="m-0 shrink-0 text-sm text-muted">
          {host} · PID {row.pid} · 端口 {row.port || "—"} · 会话 {row.screen || "—"}
        </DialogDescription>
        <div className="flex shrink-0 flex-wrap items-center gap-3">
          <Select<number>
            aria-label="日志行数"
            value={lines}
            onChange={setLines}
            options={[100, 500, 1000, 2000].map((count) => ({ value: count, label: `最近 ${count} 行` }))}
          />
          <input
            aria-label="过滤当前日志"
            className="motion-field h-8 min-w-0 flex-1 rounded-control px-3 text-sm text-ink"
            value={search}
            placeholder="过滤当前日志"
            onChange={(event) => setSearch(event.target.value)}
          />
          <Checkbox checked={autoRefresh} onChange={setAutoRefresh}>每 5 秒刷新</Checkbox>
          <Button size="sm" disabled={query.isFetching} onClick={() => void query.refetch()}>
            {query.isFetching ? "读取中…" : "刷新"}
          </Button>
        </div>
        <div role="group" aria-label="日志级别筛选" className="flex shrink-0 flex-wrap items-center gap-2">
          <span className="text-xs text-muted">日志级别</span>
          <Button size="sm" variant={levels.length ? "secondary" : "primary"} aria-pressed={!levels.length} onClick={() => setLevels([])}>
            全部
          </Button>
          {APP_LOG_LEVELS.map((level) => (
            <Button
              key={level}
              size="sm"
              variant={levels.includes(level) ? "primary" : "secondary"}
              aria-pressed={levels.includes(level)}
              onClick={() => setLevels((current) => current.includes(level) ? current.filter((item) => item !== level) : [...current, level])}
            >
              {level === "OTHER" ? "其他" : level.charAt(0) + level.slice(1).toLowerCase()}
            </Button>
          ))}
          <span className="text-xs text-muted">可多选 · 保留异常堆栈</span>
        </div>
        {query.error ? <Notice text={formatErr(query.error)} /> : null}
        {query.data?.source ? (
          <p className="m-0 shrink-0 break-all font-mono text-xs text-muted">来源 {query.data.source}</p>
        ) : null}
        <div className="surface-float min-h-0 flex-1 overflow-hidden !bg-graphite">
          {text ? (
            <HighlightPane html={html} text={text} pinBottom wrap />
          ) : (
            <p className="p-4 text-sm text-muted">
              {query.isPending ? "正在读取进程日志…" : query.isError ? "日志读取失败" : search.trim() || levels.length ? "当前日志中没有匹配内容" : "该实例日志暂为空"}
            </p>
          )}
        </div>
        <p className="m-0 shrink-0 text-xs text-muted">
          只读实例控制台日志，单次最多读取末尾 512 KiB。
          筛选仅作用于当前已读取的日志。
          {query.data?.truncated ? " 当前显示日志末尾片段。" : ""}
        </p>
      </DialogContent>
    </Dialog>
  );
}
