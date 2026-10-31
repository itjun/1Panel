import { NginxLogDownload } from "@/react/components/nginx-log-download";
import { NginxEmptyState } from "@/react/components/nginx-empty-state";
import { HostLogContent, HostLogControls, useHostLog } from "@/react/components/host-log-viewer";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { api } from "@/api";
import { HighlightPane } from "@/react/components/local/highlight-pane";
import { Notice, Page } from "@/react/components/page";
import { TextReader } from "@/react/components/text-reader";
import { FileWorkspace, FileWorkspacePage, NginxViewTabs, type NginxView } from "@/react/components/file-workspace";
import { SftpPage } from "@/react/pages/sftp-page";
import type { Tool } from "@/react/state/session";
import { aptHighlightHtml } from "@/utils/aptHighlight";
import { highlightFileHtml } from "@/utils/codeHighlight";
import { hostsHighlightHtml } from "@/utils/hostsHighlight";
import { nginxHighlightHtml } from "@/utils/nginxHighlight";
import { formatErr } from "@/utils/format";

export function HostFilePage({ host, tool }: { host: string; tool: Tool }) {
  if (tool === "files") return <SftpPage host={host} />;
  if (tool === "nginx") return <RemoteCodePage key={host} host={host} kind="nginx" />;
  if (tool === "apt") return <RemoteCodePage host={host} kind="apt" />;
  if (tool === "hosts") return <RemoteCodePage host={host} kind="hosts" />;
  return null;
}

type Entry = { name: string; path: string; isDir: boolean; size?: number };

function normalizeEntries(raw: unknown[]): Entry[] {
  return raw
    .map((item) => {
      const row = item as { name?: string; path?: string; isDir?: boolean; size?: number };
      const path = row.path || row.name || "";
      return {
        name: row.name || path.split("/").pop() || path,
        path,
        isDir: !!row.isDir,
        size: row.size,
      };
    })
    .sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
    });
}

function RemoteCodePage({ host, kind }: { host: string; kind: "nginx" | "apt" | "hosts" }) {
  const [selected, setSelected] = useState("");
  const [nginxView, setNginxView] = useState<NginxView>("config");
  const nginxStatus = useQuery({
    queryKey: ["nginx-installed", host],
    queryFn: () => api.isNginxInstalled(host),
    enabled: kind === "nginx",
    retry: false,
  });
  const isNginxReady = nginxStatus.data === true && !nginxStatus.isError;
  const isShowingLogs = kind === "nginx" && nginxView !== "config";
  let logKind = "nginx_access";
  if (nginxView !== "config") {
    logKind = nginxView;
  }
  const log = useHostLog(host, logKind, isShowingLogs && isNginxReady);

  const listing = useQuery({
    queryKey: ["code-list", host, kind],
    enabled: !isShowingLogs && (kind !== "nginx" || isNginxReady),
    retry: false,
    queryFn: async () => {
      if (kind === "hosts") {
        const info = await api.collectHosts(host);
        return {
          files: [{ name: "hosts", path: "/etc/hosts", content: info.raw || "" }],
          hint: "/etc/hosts",
        };
      }
      if (kind === "apt") {
        const snap = await api.collectAptSources(host);
        const files = (snap.files || []).map((file) => ({
          name: file.name || file.path,
          path: file.path,
          content: file.content || "",
        }));
        const distro = snap.distro;
        const hint = distro?.name
          ? `${distro.name}${distro.codename ? ` ${distro.codename}` : ""}`
          : "/etc/apt";
        return { files, hint, aptOnly: !!distro && !distro.apt };
      }
      const entries = normalizeEntries(await api.listDir(host, "/etc/nginx/conf.d"));
      const files = entries
        .filter((entry) => !entry.isDir && !entry.name.startsWith("."))
        .map((entry) => ({ name: entry.name, path: entry.path, content: "", size: entry.size }));
      return { files, hint: "/etc/nginx/conf.d" };
    },
  });

  const path = listing.data?.files.some((file) => file.path === selected) ? selected : listing.data?.files[0]?.path || "";
  const listed = listing.data?.files.find((file) => file.path === path);
  const isFileBodyNeeded = kind === "nginx" && isNginxReady && !isShowingLogs && !!path;

  const body = useQuery({
    queryKey: ["code-body", host, path],
    queryFn: () => api.readFileText(host, path),
    enabled: isFileBodyNeeded,
    retry: false,
  });

  const loadedText =
    kind === "nginx"
      ? body.data || ""
      : listed?.content || (kind === "hosts" ? listing.data?.files[0]?.content || "" : "");

  const html = useMemo(() => {
    if (!loadedText) return "";
    if (kind === "nginx") {
      // conf.d 里可能混有 .json；按路径识别，其余仍按 nginx
      if (/\.jsonc?$/i.test(path)) return highlightFileHtml(loadedText, path);
      return nginxHighlightHtml(loadedText);
    }
    if (kind === "apt") return aptHighlightHtml(loadedText);
    return hostsHighlightHtml(loadedText);
  }, [kind, loadedText, path]);

  useEffect(() => {
    setSelected("");
  }, [host, kind]);

  const refresh = async () => {
    if (kind === "nginx") {
      const result = await nginxStatus.refetch({ throwOnError: true });
      // 从未安装恢复后由 enabled 自动加载，避免同一次刷新重复请求。
      if (!result.data || !isNginxReady) return true;
    }
    if (isShowingLogs) {
      await log.query.refetch({ throwOnError: true });
      return true;
    }
    await Promise.all([listing.refetch({ throwOnError: true }), ...(isFileBodyNeeded ? [body.refetch({ throwOnError: true })] : [])]);
    return true;
  };
  let refreshing = listing.isFetching || (isFileBodyNeeded && body.isFetching);
  if (isShowingLogs) {
    refreshing = log.query.isFetching;
  }

  refreshing = refreshing || (kind === "nginx" && nginxStatus.isFetching);

  const title = kind === "apt" ? "软件源" : kind === "hosts" ? "Hosts" : "Nginx";

  let content = isShowingLogs ? <HostLogContent log={log} isWorkspace /> : (
    <>
      {listing.error ? <Notice text={formatErr(listing.error)} /> : null}
      {listing.data?.aptOnly ? <Notice tone="warn" text="仅支持 apt（Debian / Ubuntu）" /> : null}
      <FileWorkspace files={listing.data?.files || []} path={path} onSelect={setSelected} isLoading={listing.isPending}>
        <TextReader path={path || (kind === "hosts" ? "/etc/hosts" : undefined)} text={loadedText}
          size={listed && "size" in listed && typeof listed.size === "number" ? listed.size : undefined}
          isLoading={listing.isPending || (isFileBodyNeeded && body.isPending)}
          isRefreshing={refreshing}
          error={body.error && isFileBodyNeeded ? `读取失败：${formatErr(body.error)}` : undefined}
          emptyText={path ? "暂无内容" : "选择左侧文件预览"}>
          <HighlightPane html={html} text={loadedText} label="文件内容" showCopy={false} />
        </TextReader>
      </FileWorkspace>
    </>
  );

  if (kind === "nginx") {
    if (nginxStatus.isPending) {
      content = <p className="text-page-note" role="status">正在检查 Nginx…</p>;
    } else if (nginxStatus.error) {
      content = <Notice text={`无法检查 Nginx：${formatErr(nginxStatus.error)}`} />;
    } else if (!isNginxReady) {
      content = <NginxEmptyState />;
    } else if (listing.isError && !isShowingLogs) {
      content = <Notice text={`无法读取配置目录：${formatErr(listing.error)}`} />;
    }
  }

  if (kind !== "apt") {
    return (
      <FileWorkspacePage title={title} onRefresh={refresh} isRefreshing={refreshing}
        isRefreshVisible={!(kind === "nginx" && nginxStatus.isSuccess && nginxStatus.data === false)}
        actions={isShowingLogs && isNginxReady ? <>
          <div className="text-page-filters"><HostLogControls log={log} /></div>
          <NginxLogDownload key={host} host={host} />
        </> : null}
        headerControls={kind === "nginx" && isNginxReady
          ? <NginxViewTabs value={nginxView} onChange={setNginxView} /> : undefined}>
        {content}
      </FileWorkspacePage>
    );
  }

  return (
    <Page title={title} flush
      actions={<span className="font-mono text-sm text-muted">{listing.data?.hint || ""}</span>}
      onRefresh={refresh} refreshing={refreshing}>
      {listing.error ? <div className="px-3 pt-3"><Notice text={formatErr(listing.error)} /></div> : null}
      {listing.data?.aptOnly ? <div className="px-3 pt-3"><Notice tone="warn" text="仅支持 apt（Debian / Ubuntu）" /></div> : null}
      <div className="gap-card m-[var(--gap-card)] grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[260px_1fr]">
        <div className="surface-float min-h-0 overflow-auto">
          {(listing.data?.files || []).map((file) => (
            <button key={file.path} type="button"
              className={file.path === path
                ? "flex h-table-row w-full items-center px-3 text-left font-mono text-sm font-semibold text-accent bg-accent-soft"
                : "flex h-table-row w-full items-center px-3 text-left font-mono text-sm hover:bg-raised"}
              onClick={() => setSelected(file.path)}>
              <span className="min-w-0 truncate" data-tip={file.name} data-tip-overflow="">{file.name}</span>
            </button>
          ))}
          {!listing.isLoading && !(listing.data?.files || []).length ? <p className="px-3 py-4 text-sm text-muted">目录为空</p> : null}
        </div>
        <div className="surface-float min-h-0 overflow-hidden !bg-graphite">
          <HighlightPane html={html} text={loadedText} />
        </div>
      </div>
    </Page>
  );
}
