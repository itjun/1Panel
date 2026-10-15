import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { api } from "@/api";
import { HighlightPane } from "@/react/components/local/highlight-pane";
import { Notice } from "@/react/components/page";
import { Select } from "@/react/components/ui/select";
import { formatErr } from "@/utils/format";
import { logHighlightHtml } from "@/utils/logHighlight";

/** Nginx 与日志页共用读取、过滤及展示，缓存仍按主机、日志类型和行数隔离。 */
export function useHostLog(host: string, kind: string, isEnabled = true) {
  const [lines, setLines] = useState(500);
  const [search, setSearch] = useState("");
  const query = useQuery({
    queryKey: ["logs", host, kind, lines],
    queryFn: () => api.collectLog(host, kind, lines),
    enabled: isEnabled,
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

export function HostLogContent({ log }: { log: HostLog }) {
  return (
    <>
      {log.query.error ? <Notice text={formatErr(log.query.error)} /> : null}
      {log.query.data?.source ? (
        <p className="m-0 text-xs text-muted">来源 {log.query.data.source}</p>
      ) : null}
      <div className="surface-float min-h-0 flex-1 overflow-hidden !bg-graphite" aria-busy={log.query.isFetching}>
        {log.query.isLoading ? (
          <pre className="p-4 font-mono text-sm text-graphite-text" role="status">加载中…</pre>
        ) : (
          <HighlightPane html={log.html} text={log.text} pinBottom wrap />
        )}
      </div>
    </>
  );
}
