import { CurrentTextRefresh } from "@/react/components/current-text-refresh";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { api } from "@/api";
import { Notice, Page } from "@/react/components/page";
import { formatErr } from "@/utils/format";
import { hostsHighlightHtml } from "@/utils/hostsHighlight";
import { HighlightPane } from "./highlight-pane";

function formatSize(n: number) {
  if (n < 1024) return n + " B";
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
  return (n / (1024 * 1024)).toFixed(1) + " MB";
}

export function LocalHostsPage() {
  const query = useQuery({
    queryKey: ["local-hosts"],
    queryFn: () => api.localSysHosts(),
  });
  const raw = query.data?.raw || "";
  const html = useMemo(() => hostsHighlightHtml(raw), [raw]);
  const pathLabel = "/etc/hosts";

  return (
    <Page
      title="本机 Hosts"
      flush
      actions={<>
        <span className="font-mono text-sm text-muted">
          {pathLabel}
        </span>
        {query.data ? <span className="text-xs text-muted">{formatSize(raw.length)}</span> : null}
        <CurrentTextRefresh onRefresh={() => void query.refetch()} refreshing={query.isFetching} />
      </>}
      onRefresh={() => void query.refetch()}
    >
      {query.error ? (
        <div className="px-4 pt-4">
          <Notice text={formatErr(query.error)} />
        </div>
      ) : null}
      {/* 固定单文件直接阅读，路径与大小保留在工具行。 */}
      <div className="surface-float m-[var(--gap-card)] min-h-0 flex-1 overflow-hidden !bg-graphite">
        {raw ? (
          <HighlightPane html={html} text={raw} />
        ) : (
          <pre className="h-full p-4 text-sm text-muted">
            {query.isLoading ? "加载中…" : "暂无内容"}
          </pre>
        )}
      </div>
    </Page>
  );
}
