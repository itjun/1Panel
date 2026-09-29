import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { api } from "@/api";
import { Tag } from "@/react/components/ui/tag";
import { Notice, Page } from "@/react/components/page";
import { formatErr } from "@/utils/format";
import { highlightFileHtml } from "@/utils/codeHighlight";
import { nginxHighlightHtml } from "@/utils/nginxHighlight";
import { HighlightPane } from "./highlight-pane";

function formatSize(n: number) {
  if (n < 1024) return n + " B";
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
  return (n / (1024 * 1024)).toFixed(1) + " MB";
}

export function LocalNginxPage() {
  const info = useQuery({
    queryKey: ["local-nginx"],
    queryFn: () => api.localSysNginx(),
  });
  const [path, setPath] = useState("");
  const chosen = path || info.data?.files?.[0]?.path || "";
  const body = useQuery({
    queryKey: ["local-nginx-file", chosen],
    queryFn: () => api.localSysNginxRead(chosen),
    enabled: !!chosen,
  });

  const html = useMemo(() => {
    if (body.isError) return "";
    const text = body.data || "";
    if (!text) return "";
    if (/\.jsonc?$/i.test(chosen)) return highlightFileHtml(text, chosen);
    return nginxHighlightHtml(text);
  }, [body.data, body.isError, chosen]);

  const previewText = body.isError
    ? `# 读取失败: ${formatErr(body.error)}`
    : body.data || (body.isLoading ? "加载中…" : "");

  return (
    <Page
      title="本机 Nginx"
      flush
      actions={
        <span
          className="flex max-w-[420px] items-center gap-2 text-sm text-muted"
          data-tip={info.data?.confPath}
        >
          <Tag tone={info.data?.running ? "ok" : "neutral"}>
            {info.data?.running ? "运行中" : "未运行"}
          </Tag>
          <span className="truncate">
            {info.data?.version ? `v${info.data.version}` : ""}
            {info.data?.version && info.data?.confPath ? " · " : ""}
            {info.data?.confPath || ""}
          </span>
        </span>
      }
      onRefresh={() => void info.refetch()}
    >
      {info.error ? (
        <div className="px-4 pt-4">
          <Notice text={formatErr(info.error)} />
        </div>
      ) : null}
      {info.data && !info.data.installed ? (
        <div className="px-4 pt-4">
          <Notice tone="warn" text="未检测到 nginx 可执行文件" />
        </div>
      ) : null}
      {/* 内容区四周 16px 安全边距，两栏间隙 gap-card */}
      <div className="gap-card m-[var(--gap-card)] grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[260px_1fr]">
        <div className="surface-float min-h-0 overflow-auto">
          {(info.data?.files || []).map((file) => (
            <button
              key={file.path}
              type="button"
              className={
                chosen === file.path
                  ? "flex h-table-row w-full items-center justify-between bg-accent-soft px-3 text-left font-semibold text-accent"
                  : "flex h-table-row w-full items-center justify-between px-3 text-left hover:bg-raised"
              }
              onClick={() => setPath(file.path)}
            >
              <span className="truncate font-mono text-sm">
                {file.name || file.path}
              </span>
              <span className="shrink-0 text-xs text-muted">
                {formatSize(file.size || 0)}
              </span>
            </button>
          ))}
          {!info.isLoading && !(info.data?.files || []).length ? (
            <div className="px-3 py-6 text-sm text-muted">无配置文件</div>
          ) : null}
        </div>
        <div className="surface-float min-h-0 overflow-hidden !bg-graphite">
          {chosen ? (
            body.isError || !html ? (
              <pre className="h-full overflow-auto p-4 font-mono text-sm text-graphite-text">
                {previewText}
              </pre>
            ) : (
              <HighlightPane html={html} text={body.data || ""} />
            )
          ) : (
            <div className="p-4 text-sm text-muted">选择左侧文件预览</div>
          )}
        </div>
      </div>
    </Page>
  );
}
