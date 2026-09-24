import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { api } from "@/api";
import { Button } from "@/react/components/ui/button";
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
      actions={
        <>
          <span className="font-mono text-sm text-muted" title={pathLabel}>
            {pathLabel}
          </span>
          <Button onClick={() => void query.refetch()}>刷新</Button>
        </>
      }
    >
      {query.error ? <Notice text={formatErr(query.error)} /> : null}
      <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[220px_1fr]">
          <div className="border-r border-line">
            <div className="flex h-12 items-center justify-between bg-accent/10 px-3 font-semibold text-accent">
              <span className="font-mono text-sm">hosts</span>
              <span className="text-xs text-muted">{formatSize(raw.length)}</span>
            </div>
          </div>
          <div className="min-h-0 overflow-hidden">
            {raw ? (
              <HighlightPane html={html} text={raw} />
            ) : (
              <pre className="h-full bg-graphite p-4 text-sm text-muted">
                {query.isLoading ? "加载中…" : "暂无内容"}
              </pre>
            )}
          </div>
        </div>
    </Page>
  );
}
