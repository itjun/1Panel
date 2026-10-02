import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { api } from "@/api";
import { Notice, Page } from "@/react/components/page";
import { formatErr } from "@/utils/format";
import { aptHighlightHtml } from "@/utils/aptHighlight";
import { HighlightPane } from "./highlight-pane";

function formatSize(n: number) {
  if (n < 1024) return n + " B";
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
  return (n / (1024 * 1024)).toFixed(1) + " MB";
}

export function LocalAptPage() {
  const query = useQuery({
    queryKey: ["local-apt"],
    queryFn: () => api.localSysAptSources(),
  });
  const [path, setSelected] = useState("");

  const files = query.data?.files || [];
  const chosen = path || files[0]?.path || "";
  const text = files.find((file) => file.path === chosen)?.content || "";
  const html = useMemo(() => (text ? aptHighlightHtml(text) : ""), [text]);

  const distro = query.data?.distro;
  const hint = distro?.name
    ? `${distro.name}${distro.codename ? ` ${distro.codename}` : ""}`
    : "/etc/apt";

  return (
    <Page
      title="本机软件源"
      flush
      actions={<span className="font-mono text-sm text-muted">{hint}</span>}
      onRefresh={() => void query.refetch()}
    >
      {query.error ? (
        <div className="px-4 pt-4">
          <Notice text={formatErr(query.error)} />
        </div>
      ) : null}
      {distro && !distro.apt ? (
        <div className="px-4 pt-4">
          <Notice tone="warn" text="仅支持 apt（Debian / Ubuntu）" />
        </div>
      ) : null}
      {/* 内容区四周 16px 安全边距，两栏间隙 gap-card */}
      <div className="gap-card m-[var(--gap-card)] grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[260px_1fr]">
        <div className="surface-float min-h-0 overflow-auto">
          {files.map((file) => (
            <button
              key={file.path}
              type="button"
              className={
                chosen === file.path
                  ? "flex h-table-row w-full items-center justify-between bg-accent-soft px-3 text-left font-semibold text-accent"
                  : "flex h-table-row w-full items-center justify-between px-3 text-left hover:bg-raised"
              }
              onClick={() => setSelected(file.path)}
            >
              <span className="truncate font-mono text-sm">
                {file.name || file.path}
              </span>
              <span className="shrink-0 text-xs text-muted">
                {formatSize(file.size || 0)}
              </span>
            </button>
          ))}
          {!query.isLoading && !files.length ? (
            <div className="px-3 py-6 text-sm text-muted">无源文件</div>
          ) : null}
        </div>
        <div className="surface-float min-h-0 overflow-hidden !bg-graphite">
          {text ? (
            <HighlightPane html={html} text={text} />
          ) : (
            <div className="p-4 text-sm text-muted">
              {query.isLoading ? "加载中…" : "选择左侧文件预览"}
            </div>
          )}
        </div>
      </div>
    </Page>
  );
}
