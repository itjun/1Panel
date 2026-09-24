import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { api } from "@/api";
import { Button } from "@/react/components/ui/button";
import { Card } from "@/react/components/ui/card";
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
      actions={
        <>
          <span className="max-w-[420px] truncate text-sm text-muted" title={info.data?.confPath}>
            {info.data?.running ? "运行中" : "未运行"}
            {info.data?.version ? ` · v${info.data.version}` : ""}
            {info.data?.confPath ? ` · ${info.data.confPath}` : ""}
          </span>
          <Button onClick={() => void info.refetch()}>刷新</Button>
        </>
      }
    >
      {info.error ? <Notice text={formatErr(info.error)} /> : null}
      {info.data && !info.data.installed ? (
        <Notice tone="warn" text="未检测到 nginx 可执行文件" />
      ) : null}
      <Card className="min-h-0 flex-1 overflow-hidden p-0">
        <div className="grid h-full grid-cols-1 md:grid-cols-[260px_1fr]">
          <div className="overflow-auto border-r border-line">
            {(info.data?.files || []).map((file) => (
              <button
                key={file.path}
                type="button"
                className={
                  chosen === file.path
                    ? "flex h-12 w-full items-center justify-between bg-accent/10 px-3 text-left text-accent"
                    : "flex h-12 w-full items-center justify-between px-3 text-left hover:bg-[#f7f8fa]"
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
          <div className="min-h-0 overflow-hidden">
            {chosen ? (
              body.isError || !html ? (
                <pre className="h-full overflow-auto bg-[#191c21] p-4 font-mono text-sm text-[#e5e7eb]">
                  {previewText}
                </pre>
              ) : (
                <HighlightPane html={html} text={body.data || ""} />
              )
            ) : (
              <div className="p-4 text-sm text-[#8b98a8]">选择左侧文件预览</div>
            )}
          </div>
        </div>
      </Card>
    </Page>
  );
}
