import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { api } from "@/api";
import { Notice } from "@/react/components/page";
import { NginxEmptyState } from "@/react/components/nginx-empty-state";
import { TextReader } from "@/react/components/text-reader";
import { FileWorkspace, FileWorkspacePage, NginxViewTabs, type NginxView } from "../file-workspace";
import { HostLogContent, HostLogControls, useLocalNginxLog } from "../host-log-viewer";
import { NginxLogDownload } from "../nginx-log-download";
import { formatErr } from "@/utils/format";
import { highlightFileHtml } from "@/utils/codeHighlight";
import { nginxHighlightHtml } from "@/utils/nginxHighlight";
import { HighlightPane } from "./highlight-pane";

export function LocalNginxPage() {
  const info = useQuery({
    queryKey: ["local-nginx"],
    queryFn: () => api.localSysNginx(),
    retry: false,
  });
  const [view, setView] = useState<NginxView>("config");
  const isShowingLogs = view !== "config";
  const [path, setPath] = useState("");
  const isInstalled = info.data?.installed === true && !info.isError;
  const log = useLocalNginxLog(view, isInstalled && isShowingLogs);
  const files = isInstalled ? info.data?.files || [] : [];
  const chosen = files.some((file) => file.path === path) ? path : files[0]?.path || "";
  const body = useQuery({
    queryKey: ["local-nginx-file", chosen],
    queryFn: () => api.localSysNginxRead(chosen),
    enabled: !!chosen && !isShowingLogs,
    // 读取被拒/文件缺失是确定性失败，重试只会让「加载中…」假象更久
    retry: false,
  });

  const refresh = async () => {
    const result = await info.refetch({ throwOnError: true });
    if (!result.data?.installed || !isInstalled) return true;
    if (isShowingLogs) {
      await log.query.refetch({ throwOnError: true });
      return true;
    }
    if (result.data?.installed && chosen && result.data.files?.some((file) => file.path === chosen)) {
      await body.refetch({ throwOnError: true });
    }
    return true;
  };

  const html = useMemo(() => {
    const text = body.data || "";
    if (!text) return "";
    if (/\.jsonc?$/i.test(chosen)) return highlightFileHtml(text, chosen);
    return nginxHighlightHtml(text);
  }, [body.data, chosen]);

  return (
    <FileWorkspacePage title="Nginx" onRefresh={refresh} isRefreshing={info.isFetching || body.isFetching || log.query.isFetching}
      isRefreshVisible={!(info.isSuccess && !info.data.installed)}
      headerControls={isInstalled ? <NginxViewTabs value={view} onChange={setView} /> : undefined}
      actions={isInstalled && isShowingLogs ? <>
        <div className="text-page-filters"><HostLogControls log={log} /></div>
        <NginxLogDownload isLocal logPath={log.query.data?.source || (view === "nginx_error" ? info.data?.errorLogPath : info.data?.accessLogPath)} />
      </> : undefined}>
      {info.isPending ? <p className="text-page-note" role="status">正在检查 Nginx…</p>
        : info.error ? <Notice text={`无法检查 Nginx：${formatErr(info.error)}`} />
        : !isInstalled ? <NginxEmptyState isLocal />
        : isShowingLogs ? <HostLogContent log={log} isWorkspace />
        : <FileWorkspace files={files.map((file) => ({
          path: file.path, name: file.name || file.path,
        }))} path={chosen} onSelect={setPath} isLoading={info.isPending}>
        <TextReader path={chosen} text={body.data || ""}
          isLoading={info.isPending || (!!chosen && body.isPending)} isRefreshing={body.isFetching}
          error={body.error ? `读取失败：${formatErr(body.error)}` : undefined}
          size={info.data?.files?.find((file) => file.path === chosen)?.size}
          emptyText={chosen ? "暂无内容" : "选择左侧文件预览"}>
          <HighlightPane html={html} text={body.data || ""} label="Nginx 配置内容" showCopy={false} />
        </TextReader>
      </FileWorkspace>}
    </FileWorkspacePage>
  );
}
