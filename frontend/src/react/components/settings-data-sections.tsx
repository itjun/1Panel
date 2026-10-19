import { Events } from "@wailsio/runtime";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { api, type main } from "@/api";
import { HighlightPane } from "@/react/components/local/highlight-pane";
import { Button } from "@/react/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/react/components/ui/dialog";
import { FlashNotices, Notice } from "@/react/components/page";
import { applicationPreferences } from "@/react/lib/application-data";
import { useFlashMessage } from "@/react/lib/use-flash-message";
import { formatErr } from "@/utils/format";
import { highlightFileHtml } from "@/utils/codeHighlight";
import "@/react/styles/settings.css";
import "@/react/styles/config-data.css";

function time(value: number) {
  return new Date(value).toLocaleString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
}

function compactPath(path?: string) {
  return path?.replace(/^\/Users\/[^/]+|^\/home\/[^/]+|^[A-Za-z]:\\Users\\[^\\]+/, "~") || "—";
}

export function SettingsDataSections({ onBusyChange }: { onBusyChange: (busy: boolean) => void }) {
  const queryClient = useQueryClient();
  const flash = useFlashMessage();
  const [busy, setBusy] = useState(false);
  useEffect(() => { onBusyChange(busy); }, [busy, onBusyChange]);
  const [preview, setPreview] = useState<main.ApplicationBackup | null>(null);
  const [viewer, setViewer] = useState<"app" | "ssh" | null>(null);
  const [selectedSSH, setSelectedSSH] = useState("");
  const overview = useQuery({ queryKey: ["config-overview"], queryFn: () => api.getPanelConfigOverview() });
  const backups = useQuery({ queryKey: ["application-backups"], queryFn: () => api.listApplicationBackups() });
  const restoreError = useQuery({ queryKey: ["application-restore-error"], queryFn: () => api.applicationRestoreError() });
  const files = useQuery({ queryKey: ["config-files"], queryFn: () => api.getPanelConfigTree(), enabled: viewer === "ssh" });
  const appConfig = useQuery({ queryKey: ["config-readonly-state"], queryFn: () => api.getEditablePanelState(), enabled: viewer === "app" });
  const sshFiles = (files.data || []).filter(file => !file.panelJson);
  const currentFile = sshFiles.find(file => file.path === selectedSSH) || sshFiles.find(file => file.absolutePath === overview.data?.sshConfigPath) || sshFiles[0];

  useEffect(() => {
    const off = ["panel-config-imported", "panel-config-needs-review"].map(name => Events.On(name, () => {
      for (const key of ["config-overview", "config-files", "config-readonly-state"]) void queryClient.invalidateQueries({ queryKey: [key] });
    }));
    return () => off.forEach(dispose => dispose());
  }, [queryClient]);

  async function backup() {
    setBusy(true); flash.clear();
    try {
      const result = await api.pickAndBackupApplicationData(applicationPreferences());
      if (result) { await backups.refetch(); flash.showToast("应用数据已备份，并保留了一份本地副本。"); }
    } catch (error) { flash.showError(formatErr(error)); }
    finally { setBusy(false); }
  }

  async function showPreview(path: string) {
    setBusy(true); flash.clear();
    try { setPreview(await api.previewApplicationBackup(path)); }
    catch (error) { flash.showError(formatErr(error)); }
    finally { setBusy(false); }
  }

  async function chooseRestore() {
    setBusy(true); flash.clear();
    try { const path = await api.pickApplicationBackup(); if (path) setPreview(await api.previewApplicationBackup(path)); }
    catch (error) { flash.showError(formatErr(error)); }
    finally { setBusy(false); }
  }

  async function restore() {
    if (!preview) return;
    setBusy(true); flash.clear();
    try {
      await api.restoreApplicationData(preview.path, preview.fingerprint, applicationPreferences());
      flash.showToast("当前数据已自动备份，正在重新启动应用以完成恢复…");
    } catch (error) { flash.showError(formatErr(error)); setBusy(false); }
  }

  const viewerText = viewer === "app" ? (appConfig.data ? JSON.stringify(appConfig.data, null, 2) : "") : currentFile?.content || "";
  const viewerError = viewer === "app" ? appConfig.error : files.error;
  const viewerLoading = viewer === "app" ? appConfig.isPending : files.isPending;
  const viewerHtml = useMemo(
    () => highlightFileHtml(viewerText, "panel.json", viewer === "ssh" ? "sshconfig" : undefined),
    [viewerText, viewer],
  );
  const previewIsLocal = (backups.data || []).some(item => item.path === preview?.path);

  function restorePreview(item: main.ApplicationBackup) {
    return <div className="config-data-restore" aria-label="恢复预览">
      <div className="config-data-restore-summary">
        <h3 className="text-base font-semibold">恢复预览</h3>
        <p className="mt-2">{item.hosts} 台主机 · {item.groups} 个分组 · 应用设置与布局 · 通知和历史记录 · SSH 配置及凭据</p>
        <p className="mt-2 text-xs text-muted">将覆盖当前应用数据，恢复前会自动保存当前数据，随后重新启动应用。</p>
      </div>
      <div className="flex flex-wrap gap-2 self-end">
        <Button disabled={busy} onClick={() => setPreview(null)}>取消</Button>
        <Button variant="primary" disabled={busy} onClick={() => void restore()}>{busy ? "恢复中…" : "确认恢复"}</Button>
      </div>
    </div>;
  }

  return <>
    <FlashNotices flash={flash} />
      <section id="settings-backups" data-settings-section="backups" className="settings-section config-data-page" aria-labelledby="application-backups-title">
        <header className="settings-section-heading"><h2 id="application-backups-title">备份</h2></header>
        <div className="settings-section-body">
        <div className="mb-4 flex flex-wrap gap-2">
          <Button variant="primary" disabled={busy} onClick={() => void backup()}>备份应用数据</Button>
          <Button disabled={busy} onClick={() => void chooseRestore()}>恢复应用数据</Button>
        </div>
      {restoreError.data ? <Notice text={restoreError.data} /> : null}
        {backups.error ? <Notice text={formatErr(backups.error)} /> : null}
        <div className="config-data-backups">
          <div className="config-data-backup-row config-data-table-head"><span>备份文件</span><span>时间</span><span>操作</span></div>
          {backups.isPending ? <p className="config-data-empty" role="status">正在读取备份…</p> : null}
          {!backups.isPending && !backups.error && !backups.data?.length ? <p className="config-data-empty">暂无应用数据备份</p> : null}
          {(backups.data || []).map(item => <div key={item.path}>
            <div className="config-data-backup-row">
              <button className="config-data-filename" aria-expanded={preview?.path === item.path} disabled={busy} onClick={() => preview?.path === item.path ? setPreview(null) : void showPreview(item.path)}>
                {preview?.path === item.path ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                <span className="truncate" title={item.name}>{item.name}</span>
              </button>
              <span className="text-sm tabular-nums">{time(item.createdAt)}</span>
              <Button variant="ghost" className="justify-start text-accent" disabled={busy} onClick={() => void showPreview(item.path)}>查看内容</Button>
            </div>
            {preview?.path === item.path ? restorePreview(preview) : null}
          </div>)}
        </div>
        {preview && !previewIsLocal ? <div className="mt-4"><p className="mb-2 truncate text-sm text-muted" title={preview.path}>{preview.name} · {time(preview.createdAt)}</p>{restorePreview(preview)}</div> : null}
        </div>
      </section>
      <section id="settings-config" data-settings-section="config" className="settings-section config-data-page" aria-labelledby="application-config-title">
        <header className="settings-section-heading"><h2 id="application-config-title">配置</h2></header>
        <div className="settings-section-body">
        {overview.error ? <Notice text={formatErr(overview.error)} /> : null}
        <div className="config-data-current">
          <div className="config-data-config-row">
            <span className="font-semibold">应用配置</span>
            <div className="min-w-0"><p>{overview.isPending ? "读取中…" : `${overview.data?.hostCount ?? "—"} 台主机 · ${overview.data?.groupCount ?? "—"} 个分组`}</p><p className="mt-1 truncate font-mono text-xs text-muted" title={overview.data?.panelPath}>{compactPath(overview.data?.panelPath)}</p></div>
            <Button variant="ghost" className="text-accent" onClick={() => setViewer("app")}>查看配置</Button>
          </div>
          <div className="config-data-config-row">
            <span className="font-semibold">SSH 配置</span>
            <p className="min-w-0 truncate text-sm"><span className="font-mono">{compactPath(overview.data?.sshConfigPath)}</span><span className="ml-3 text-muted">{overview.data?.configFileCount ?? "—"} 个配置文件</span></p>
            <Button variant="ghost" className="text-accent" onClick={() => { setSelectedSSH(""); setViewer("ssh"); }}>查看 SSH</Button>
          </div>
        </div>
        {overview.data?.needsReview || overview.data?.drift || overview.data?.configStale ? <p className="mt-3 text-sm text-muted">SSH 配置与应用数据存在差异，可在「查看 SSH」中检查当前内容。</p> : null}
        </div>
      </section>
    <Dialog open={!!viewer} onOpenChange={open => !open && setViewer(null)}>
      <DialogContent className="flex h-[min(680px,calc(100vh-64px))] w-[min(1000px,calc(100vw-48px))] flex-col overflow-hidden">
        <div className="flex items-start justify-between gap-4">
          <div><DialogTitle>{viewer === "ssh" ? "当前 SSH 配置" : "当前应用配置"}</DialogTitle><DialogDescription>{viewer === "ssh" ? "只读查看本机现有的 SSH 配置文件。" : "只读查看当前配置，密码已隐藏。主机和连接信息可在主机页面修改。"}</DialogDescription></div>
          <Button onClick={() => setViewer(null)}>关闭</Button>
        </div>
        {viewerError ? <Notice text={formatErr(viewerError)} /> : null}
        <div className="config-data-viewer mt-5 min-h-0 flex-1">
          {viewer === "ssh" ? <nav aria-label="SSH 配置文件" className="config-data-file-list">{sshFiles.map(file => <button key={file.path} className={file === currentFile ? "is-selected" : ""} aria-current={file === currentFile ? "true" : undefined} onClick={() => setSelectedSSH(file.path)} title={file.displayPath}>{file.path}</button>)}{!viewerLoading && !sshFiles.length ? <p className="p-3 text-sm text-muted">暂无 SSH 配置文件</p> : null}</nav> : null}
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <p className="mb-3 shrink-0 break-all font-mono text-xs text-muted">{viewer === "ssh" ? currentFile?.displayPath : compactPath(overview.data?.panelPath)}</p>
            <div className="min-h-0 flex-1 overflow-hidden bg-graphite">
              {viewerLoading || viewerError ? <pre className="local-code-pre" role="status">{viewerLoading ? "读取配置中…" : "读取失败"}</pre> :
                <HighlightPane key={viewer === "ssh" ? currentFile?.path : "app"} html={viewerHtml} text={viewerText} label={viewer === "ssh" ? "SSH 配置内容，只读" : "应用配置内容，只读"} />}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  </>;
}
