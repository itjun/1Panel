import { NginxLogDownload } from "@/react/components/nginx-log-download";
import { CurrentTextRefresh } from "@/react/components/current-text-refresh";
import { HostLogContent, HostLogControls, useHostLog } from "@/react/components/host-log-viewer";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { api } from "@/api";
import { HighlightPane } from "@/react/components/local/highlight-pane";
import { Notice, Page } from "@/react/components/page";
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

const NGINX_VIEWS = [
  { key: "config", label: "配置" },
  { key: "nginx_access", label: "访问日志" },
  { key: "nginx_error", label: "错误日志" },
] as const;
type NginxView = (typeof NGINX_VIEWS)[number]["key"];

function RemoteCodePage({ host, kind }: { host: string; kind: "nginx" | "apt" | "hosts" }) {
  const [selected, setSelected] = useState("");
  const [nginxView, setNginxView] = useState<NginxView>("config");
  const isShowingLogs = kind === "nginx" && nginxView !== "config";
  let logKind = "nginx_access";
  if (nginxView !== "config") {
    logKind = nginxView;
  }
  const log = useHostLog(host, logKind, isShowingLogs);

  const listing = useQuery({
    queryKey: ["code-list", host, kind],
    enabled: !isShowingLogs,
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
        .map((entry) => ({ name: entry.name, path: entry.path, content: "" }));
      return { files, hint: "/etc/nginx/conf.d" };
    },
  });

  const path = selected || listing.data?.files[0]?.path || "";
  const listed = listing.data?.files.find((file) => file.path === path);
  const isFileBodyNeeded = kind === "nginx" && !isShowingLogs && !!path;

  const body = useQuery({
    queryKey: ["code-body", host, path],
    queryFn: () => api.readFileText(host, path),
    enabled: isFileBodyNeeded,
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

  const title = kind === "apt" ? "软件源" : kind === "hosts" ? "Hosts" : "Nginx";

  return (
    <Page
      title={title}
      flush
      actions={
        <>
          {kind === "nginx" ? (
            <div className="flex shrink-0 items-center gap-4 pr-2" role="group" aria-label="Nginx 内容">
              {NGINX_VIEWS.map((view) => (
                <button
                  key={view.key}
                  type="button"
                  aria-pressed={nginxView === view.key}
                  className={`motion-colors h-8 whitespace-nowrap text-sm focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent ${nginxView === view.key ? "text-accent" : "text-muted hover:text-ink"}`}
                  onClick={() => setNginxView(view.key)}
                >
                  {view.label}
                </button>
              ))}
            </div>
          ) : null}
          {isShowingLogs ? <HostLogControls log={log} /> : (
            <span className="font-mono text-sm text-muted">{listing.data?.hint || ""}</span>
          )}
          {kind === "nginx" ? <NginxLogDownload key={host} host={host} /> : null}
          <CurrentTextRefresh onRefresh={() => void refresh().catch(() => {})} refreshing={refreshing} disabled={!isShowingLogs && !path} />
        </>
      }
      onRefresh={refresh}
      refreshing={refreshing}
      showRefresh={false}
    >
      {isShowingLogs ? (
        <div className="gap-card m-[var(--gap-card)] flex min-h-0 flex-1 flex-col">
          <HostLogContent log={log} />
        </div>
      ) : (
        <>
          {listing.error ? (
            <div className="px-3 pt-3">
              <Notice text={formatErr(listing.error)} />
            </div>
          ) : null}
          {isFileBodyNeeded && body.error ? (
            <div className="px-3 pt-3"><Notice text={formatErr(body.error)} /></div>
          ) : null}
          {listing.data?.aptOnly ? (
            <div className="px-3 pt-3">
              <Notice tone="warn" text="仅支持 apt（Debian / Ubuntu）" />
            </div>
          ) : null}
          <div className={`gap-card m-[var(--gap-card)] grid min-h-0 flex-1 grid-cols-1 ${kind !== "hosts" ? "md:grid-cols-[260px_1fr]" : ""}`}>
            {kind !== "hosts" ? <div className="surface-float min-h-0 overflow-auto">
              {(listing.data?.files || []).map((file) => (
                <button
                  key={file.path}
                  type="button"
                  className={
                    file.path === path
                      ? "flex h-table-row w-full items-center px-3 text-left font-mono text-sm font-semibold text-accent bg-accent-soft"
                      : "flex h-table-row w-full items-center px-3 text-left font-mono text-sm hover:bg-raised"
                  }
                  onClick={() => setSelected(file.path)}
                >
                  <span className="min-w-0 truncate" data-tip={file.name} data-tip-overflow="">
                    {file.name}
                  </span>
                </button>
              ))}
              {!listing.isLoading && !(listing.data?.files || []).length ? (
                <p className="px-3 py-4 text-sm text-muted">目录为空</p>
              ) : null}
            </div> : null}
            <div className="surface-float min-h-0 overflow-hidden !bg-graphite">
              {isFileBodyNeeded && body.isLoading && !loadedText ? (
                <pre className="p-4 font-mono text-sm text-graphite-text">加载中…</pre>
              ) : (
                <HighlightPane html={html} text={loadedText} />
              )}
            </div>
          </div>
        </>
      )}
    </Page>
  );
}
