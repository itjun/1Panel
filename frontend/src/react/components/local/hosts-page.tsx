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
      actions={
        <span className="font-mono text-sm text-muted">
          {pathLabel}
        </span>
      }
      onRefresh={() => void query.refetch()}
    >
      {query.error ? (
        <div className="px-4 pt-4">
          <Notice text={formatErr(query.error)} />
        </div>
      ) : null}
      {/* 内容区四周 16px 安全边距，两栏间隙 gap-card */}
      <div className="gap-card m-4 grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[260px_1fr]">
        <div className="surface-float min-h-0 overflow-auto">
          <div className="flex h-table-row items-center justify-between bg-accent-soft px-3 font-semibold text-accent">
            <span className="font-mono text-sm">hosts</span>
            <span className="text-xs text-muted">{formatSize(raw.length)}</span>
          </div>
        </div>
        <div className="surface-float min-h-0 overflow-hidden !bg-graphite">
          {raw ? (
            <HighlightPane html={html} text={raw} />
          ) : (
            <pre className="h-full p-4 text-sm text-muted">
              {query.isLoading ? "加载中…" : "暂无内容"}
            </pre>
          )}
        </div>
      </div>
    </Page>
  );
}
