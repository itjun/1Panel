import { FileWorkspace } from "./file-workspace";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { api } from "@/api";
import { HighlightPane } from "@/react/components/local/highlight-pane";
import { TextReader } from "@/react/components/text-reader";
import { Select } from "@/react/components/ui/select";
import { formatErr, splitTextLines } from "@/utils/format";
import { logHighlightHtml } from "@/utils/logHighlight";

/** Nginx 与日志页共用读取、过滤及展示，缓存仍按主机、日志类型和行数隔离。 */
export function useHostLog(host: string, kind: string, isEnabled = true) {
  return useLogReader(["logs", host, kind], (lines) => api.collectLog(host, kind, lines), isEnabled);
}

export function useLocalNginxLog(kind: string, isEnabled: boolean) {
  return useLogReader(["local-nginx-log", kind], (lines) => api.localSysNginxLog(kind, lines), isEnabled);
}

function useLogReader(key: string[], read: (lines: number) => Promise<{ source: string; content: string }>, isEnabled: boolean) {
  const [lines, setLines] = useState(500);
  const [search, setSearch] = useState("");
  const query = useQuery({
    queryKey: [...key, lines],
    queryFn: () => read(lines),
    enabled: isEnabled,
    retry: key[0] === "local-nginx-log" || key[2]?.startsWith("nginx_") ? false : undefined,
  });
  const text = useMemo(() => {
    const raw = query.data?.content || "";
    const keyword = search.trim().toLowerCase();
    if (!keyword) {
      return raw;
    }
    const matched: string[] = [];
    for (const line of raw.split("\n")) {
      if (line.toLowerCase().includes(keyword)) {
        matched.push(line);
      }
    }
    return matched.join("\n");
  }, [query.data?.content, search]);
  const html = useMemo(() => logHighlightHtml(text), [text]);

  return { query, lines, setLines, search, setSearch, text, html };
}

type HostLog = ReturnType<typeof useHostLog>;

export function HostLogControls({ log }: { log: HostLog }) {
  return (
    <>
      <Select<number>
        aria-label="行数"
        value={log.lines}
        onChange={log.setLines}
        options={[100, 500, 1000, 2000].map((count) => ({ value: count, label: `${count} 行` }))}
      />
      <input
        className="motion-field h-8 min-w-0 rounded-control px-3 text-ink"
        aria-label="搜索过滤"
        value={log.search}
        placeholder="搜索过滤"
        onChange={(event) => log.setSearch(event.target.value)}
      />
    </>
  );
}

export function HostLogContent({ log, isWorkspace = false }: { log: HostLog; isWorkspace?: boolean }) {
  const raw = log.query.data?.content || "";
  const count = raw ? splitTextLines(raw).length : 0;
  const reader = (
    <TextReader path={log.query.data?.source} sourceLabel={isWorkspace ? undefined : "来源"} text={log.text}
      isLoading={log.query.isPending} isRefreshing={log.query.isFetching}
      error={log.query.error ? `读取失败：${formatErr(log.query.error)}` : undefined}
      emptyText={log.search.trim() ? "没有匹配的日志" : !isWorkspace ? "暂无日志" : log.query.data?.source ? "日志文件为空" : "未找到日志文件"}
      footer={log.search.trim() ? <span>已过滤，本次读取 {count} 行</span> : undefined}>
      <HighlightPane html={log.html} text={log.text} pinBottom wrap label="日志内容" showCopy={false} />
    </TextReader>
  );
  if (!isWorkspace) return reader;
  const path = log.query.data?.source || "";
  return <FileWorkspace files={path ? [{ path, name: path.split(/[\\/]/).pop() || path }] : []}
    path={path} onSelect={() => {}} isLoading={log.query.isPending}>{reader}</FileWorkspace>;
}
