import { Events } from "@wailsio/runtime";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  DatabaseBackup,
  Folder,
  ShieldCheck,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { api, type main } from "@/api";
import { CodeSurface } from "@/react/components/code-surface";
import { TextFileList, TextPage, TextReader } from "@/react/components/text-reader";
import { TH_STICKY_LINE } from "@/react/components/data-table";
import { FlashNotices, Notice, Page } from "@/react/components/page";
import { confirmDialog } from "@/react/components/ui/confirm-dialog";
import { Button } from "@/react/components/ui/button";
import { Tag } from "@/react/components/ui/tag";
import { applicationPreferences } from "@/react/lib/application-data";
import { cn } from "@/react/lib/utils";
import { useFlashMessage } from "@/react/lib/use-flash-message";
import { useSession } from "@/react/state/session";
import { copyText } from "@/utils/clipboard";
import { formatErr } from "@/utils/format";
import "@/react/styles/config-data.css";

function time(value: number) {
  return new Date(value).toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function applicationBackupDir(panelPath?: string) {
  if (!panelPath) return "";
  const slash = Math.max(panelPath.lastIndexOf("/"), panelPath.lastIndexOf("\\"));
  if (slash <= 0) return "";
  return panelPath.slice(0, slash) + panelPath[slash] + "application-backups";
}

function fileSize(value: number) {
  if (!value) return "—";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  return `${(value / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function sourceOS(value: string) {
  const normalized = value.trim().toLowerCase();
  if (normalized === "darwin" || normalized === "macos") return "macOS";
  if (normalized === "win32" || normalized === "windows") return "Windows";
  if (normalized === "linux") return "Linux";
  return value || "未知系统";
}

export function ConfigDataPage() {
  const session = useSession();
  const section = session.configSection;
  const queryClient = useQueryClient();
  const flash = useFlashMessage();
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<main.ApplicationBackup | null>(null);
  const [selectedSSH, setSelectedSSH] = useState("");

  const overview = useQuery({
    queryKey: ["config-overview"],
    queryFn: () => api.getPanelConfigOverview(),
  });
  const backups = useQuery({
    queryKey: ["application-backups"],
    queryFn: () => api.listApplicationBackups(),
    enabled: section === "backups",
  });
  const restoreError = useQuery({
    queryKey: ["application-restore-error"],
    queryFn: () => api.applicationRestoreError(),
    enabled: section === "backups",
  });
  const files = useQuery({
    queryKey: ["config-files"],
    queryFn: () => api.getPanelConfigTree(),
    enabled: section === "ssh",
  });
  const appConfig = useQuery({
    queryKey: ["config-readonly-state"],
    queryFn: () => api.getEditablePanelState(),
    enabled: section === "json",
  });

  const sshFiles = (files.data || []).filter((file) => !file.panelJson);
  const currentFile = sshFiles.find((file) => file.path === selectedSSH)
    || sshFiles.find((file) => file.absolutePath === overview.data?.sshConfigPath)
    || sshFiles[0];
  const jsonText = useMemo(
    () => appConfig.data ? JSON.stringify(appConfig.data, null, 2) : "",
    [appConfig.data],
  );
  const backupDir = applicationBackupDir(overview.data?.panelPath);
  const previewIsLocal = (backups.data || []).some((item) => item.path === preview?.path);
  const activeFetching = section === "backups"
    ? backups.isFetching || restoreError.isFetching
    : section === "json"
      ? appConfig.isFetching
      : files.isFetching;

  useEffect(() => {
    const off = ["panel-config-imported", "panel-config-needs-review"].map((name) => (
      Events.On(name, () => {
        for (const key of ["config-overview", "config-files", "config-readonly-state"]) {
          void queryClient.invalidateQueries({ queryKey: [key] });
        }
      })
    ));
    return () => off.forEach((dispose) => dispose());
  }, [queryClient]);

  async function refresh() {
    const requests: Promise<unknown>[] = [overview.refetch({ throwOnError: true })];
    if (section === "backups") {
      requests.push(backups.refetch({ throwOnError: true }), restoreError.refetch({ throwOnError: true }));
    } else if (section === "json") {
      requests.push(appConfig.refetch({ throwOnError: true }));
    } else {
      requests.push(files.refetch({ throwOnError: true }));
    }
    await Promise.all(requests);
    return true;
  }

  async function backup() {
    setBusy(true);
    flash.clear();
    try {
      const result = await api.pickAndBackupApplicationData(applicationPreferences());
      if (result) {
        await Promise.all([backups.refetch(), overview.refetch()]);
        flash.showToast("已创建完整备份，并在本地保留一份副本。");
      }
    } catch (error) {
      flash.showError(formatErr(error));
    } finally {
      setBusy(false);
    }
  }

  async function showPreview(path: string) {
    setBusy(true);
    flash.clear();
    try {
      setPreview(await api.previewApplicationBackup(path));
    } catch (error) {
      flash.showError(formatErr(error));
    } finally {
      setBusy(false);
    }
  }

  async function chooseRestore() {
    setBusy(true);
    flash.clear();
    try {
      const path = await api.pickApplicationBackup();
      if (path) setPreview(await api.previewApplicationBackup(path));
    } catch (error) {
      flash.showError(formatErr(error));
    } finally {
      setBusy(false);
    }
  }

  async function restore() {
    if (!preview) return;
    setBusy(true);
    flash.clear();
    try {
      await api.restoreApplicationData(
        preview.path,
        preview.fingerprint,
        applicationPreferences(),
      );
      flash.showToast("当前数据已自动备份，正在重新启动应用以完成恢复…");
    } catch (error) {
      flash.showError(formatErr(error));
      setBusy(false);
    }
  }

  async function removeBackup(item: main.ApplicationBackup) {
    const ok = await confirmDialog({
      title: "删除这份备份？",
      body: `${item.name} 将从本机备份目录删除，删除后不能恢复。`,
      theme: "danger",
      confirmText: "删除",
      cancelText: "取消",
    });
    if (!ok) return;
    setBusy(true);
    flash.clear();
    try {
      await api.deleteApplicationBackup(item.path);
      if (preview?.path === item.path) setPreview(null);
      await backups.refetch();
      flash.showToast("已删除备份");
    } catch (error) {
      flash.showError(formatErr(error));
    } finally {
      setBusy(false);
    }
  }

  async function openBackupDir() {
    flash.clear();
    try {
      await api.openApplicationBackupDirectory();
    } catch (error) {
      flash.showError(formatErr(error));
    }
  }

  async function copy(value: string, message: string) {
    if (!value) return;
    try {
      await copyText(value);
      flash.showToast(message);
    } catch (error) {
      flash.showError(formatErr(error));
    }
  }

  function restorePreview(item: main.ApplicationBackup) {
    return (
      <div className="config-data-restore" aria-label="恢复预览">
        <div className="config-data-restore-copy">
          <div className="config-data-restore-title">
            <h3>恢复预览</h3>
            <Tag tone="warn">将覆盖当前数据</Tag>
          </div>
          <div className="config-data-restore-facts">
            <span><strong>{item.hosts}</strong> 台主机</span>
            <span><strong>{item.groups}</strong> 个分组</span>
            <span><strong>{item.dataFiles + item.sshFiles}</strong> 个数据文件</span>
            <span>{fileSize(item.size)}</span>
            <span>{sourceOS(item.sourceOS)}</span>
          </div>
          <p>恢复前会自动保存当前数据，完成后应用重新启动。备份包含密码和密钥，请确认来源可信。</p>
        </div>
        <div className="config-data-restore-actions">
          <Button disabled={busy} onClick={() => setPreview(null)}>取消</Button>
          <Button variant="primary" disabled={busy} onClick={() => void restore()}>
            {busy ? "恢复中" : "确认恢复"}
          </Button>
        </div>
      </div>
    );
  }

  if (section === "json" || section === "ssh") {
    const isJson = section === "json";
    const isDrift = overview.data?.needsReview || overview.data?.drift || overview.data?.configStale;
    return (
      <TextPage title={isJson ? "应用 JSON" : "SSH 配置"} onRefresh={refresh}
        isRefreshing={overview.isFetching || activeFetching}>
        {overview.error ? <Notice text={formatErr(overview.error)} /> : null}
        {isJson ? <>
          <p className="text-page-note">密码已隐藏。</p>
          <TextReader path={overview.data?.panelPath} text={jsonText} isLoading={appConfig.isPending}
            isRefreshing={appConfig.isFetching}
            error={appConfig.error ? `读取失败：${formatErr(appConfig.error)}` : undefined}
            footer={<><span>{overview.data?.hostCount ?? "—"} 台主机</span><span>{overview.data?.groupCount ?? "—"} 个分组</span></>}>
            <CodeSurface value={jsonText} language="json" readOnly />
          </TextReader>
        </> : <>
          {isDrift ? <Notice tone="warning" text="SSH 配置与应用数据存在差异，请先检查当前文件内容。" /> : null}
          <div className="text-reader-layout">
            <TextFileList location={overview.data?.sshConfigPath} path={currentFile?.path || ""}
              onSelect={setSelectedSSH} isLoading={files.isPending}
              files={sshFiles.map((file) => ({ path: file.path, name: file.path, detail: file.generated ? "生成" : "本机" }))} />
            <TextReader path={currentFile?.absolutePath || currentFile?.displayPath} text={currentFile?.content || ""}
              isLoading={files.isPending} isRefreshing={files.isFetching} size={currentFile?.size}
              error={files.error ? `读取失败：${formatErr(files.error)}` : undefined}
              emptyText={currentFile ? "暂无内容" : "暂无 SSH 配置文件"}>
              <CodeSurface value={currentFile?.content || ""} language="ssh" readOnly />
            </TextReader>
          </div>
        </>}
      </TextPage>
    );
  }

  return (
    <Page
      title="配置"
      heading={false}
      flush
      onRefresh={refresh}
      refreshing={busy || overview.isFetching || activeFetching}
    >
      <FlashNotices flash={flash} />

      {section === "backups" ? (
        <div className="config-data-page">
          <header className="config-data-header">
            <div className="config-data-title">
              <h1>备份与恢复</h1>
              <p>完整保存主机、分组、应用设置、通知历史和 SSH 凭据，可跨设备恢复。</p>
            </div>
            <div className="config-data-actions">
              <Button variant="primary" disabled={busy} onClick={() => void backup()}>
                备份应用数据
              </Button>
              <Button disabled={busy} onClick={() => void chooseRestore()}>
                从文件恢复
              </Button>
            </div>
          </header>

          <div className="config-data-safety">
            <ShieldCheck size={20} strokeWidth={1.5} aria-hidden />
            <div>
              <strong>恢复前会自动备份当前数据</strong>
              <span>恢复完成后应用会重新启动，避免旧进程覆盖已恢复的文件。</span>
            </div>
          </div>

          {restoreError.data ? <Notice text={restoreError.data} /> : null}

          {preview && !previewIsLocal ? (
            <section className="config-data-external" aria-label="外部备份">
              <div className="config-data-external-head">
                <div>
                  <h2>已选择外部备份</h2>
                  <p title={preview.path}>{preview.path}</p>
                </div>
                <Tag tone="info">{time(preview.createdAt)}</Tag>
              </div>
              {restorePreview(preview)}
            </section>
          ) : null}

          <section className="config-data-section" aria-labelledby="application-backups-title">
            <div className="config-data-section-head">
              <div>
                <h2 id="application-backups-title">本地备份</h2>
                <p>下列文件是本机保留的副本，可直接预览并恢复。点击「备份应用数据」时，还会另存一份到你选择的位置。</p>
                {backupDir ? (
                  <div className="config-data-backup-location">
                    <Folder size={15} strokeWidth={1.5} aria-hidden />
                    <span className="config-data-backup-location-label">存储位置</span>
                    <span className="config-data-backup-location-path" title={backupDir}>{backupDir}</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="config-data-backup-location-action"
                      onClick={() => void openBackupDir()}
                    >
                      打开
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="config-data-backup-location-action"
                      onClick={() => void copy(backupDir, "已复制备份目录")}
                    >
                      复制
                    </Button>
                  </div>
                ) : null}
              </div>
              <Tag tone="neutral">{backups.data?.length || 0} 份</Tag>
            </div>

            {backups.error ? <Notice text={formatErr(backups.error)} /> : null}
            <div className="config-data-backup-table-wrap">
              <table className="config-data-backup-table w-full min-w-[720px] table-fixed border-collapse text-left text-sm">
                <thead className="sticky top-0 z-20 bg-surface text-xs font-normal text-muted">
                  <tr className="h-table-head">
                    <th className={cn("relative px-3 text-left font-normal", TH_STICKY_LINE)}>备份时间</th>
                    <th className={cn("relative px-3 text-center font-normal", TH_STICKY_LINE)}>主机</th>
                    <th className={cn("relative px-3 text-center font-normal", TH_STICKY_LINE)}>分组</th>
                    <th className={cn("relative px-3 text-center font-normal", TH_STICKY_LINE)}>数据文件</th>
                    <th className={cn("relative px-3 text-center font-normal", TH_STICKY_LINE)}>大小</th>
                    <th className={cn("relative px-3 text-center font-normal", TH_STICKY_LINE)}>来源</th>
                    <th className={cn("relative px-3 text-right font-normal", TH_STICKY_LINE)}>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {backups.isPending ? (
                    <tr className="h-table-row border-t border-line">
                      <td className="px-3 text-muted" colSpan={7} role="status">正在读取备份…</td>
                    </tr>
                  ) : null}
                  {!backups.isPending && !backups.error && !backups.data?.length ? (
                    <tr className="border-t border-line">
                      <td colSpan={7}>
                        <div className="config-data-empty">
                          <DatabaseBackup size={24} strokeWidth={1.5} aria-hidden />
                          <strong>暂无应用数据备份</strong>
                          <span>点击上方「备份应用数据」创建第一份完整备份。</span>
                        </div>
                      </td>
                    </tr>
                  ) : null}
                  {(backups.data || []).map((item) => {
                    const expanded = preview?.path === item.path;
                    return (
                      <tr
                        key={item.path}
                        className={cn(
                          "h-table-row border-t border-line hover:bg-raised",
                          expanded && "bg-accent-soft hover:bg-accent-soft",
                        )}
                      >
                        <td className="px-3 tabular-nums text-ink" title={item.path}>{time(item.createdAt)}</td>
                        <td className="px-3 text-center tabular-nums">{item.hosts}</td>
                        <td className="px-3 text-center tabular-nums">{item.groups}</td>
                        <td className="px-3 text-center tabular-nums">{item.dataFiles + item.sshFiles}</td>
                        <td className="px-3 text-center tabular-nums">{fileSize(item.size)}</td>
                        <td className="px-3 text-center">{sourceOS(item.sourceOS)}</td>
                        <td className="px-3 text-right">
                          <div className="config-data-backup-actions">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="config-data-backup-action"
                              disabled={busy}
                              onClick={() => expanded ? setPreview(null) : void showPreview(item.path)}
                            >
                              {expanded ? "收起" : "恢复"}
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="config-data-backup-delete"
                              disabled={busy}
                              onClick={() => void removeBackup(item)}
                            >
                              删除
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {preview && previewIsLocal ? restorePreview(preview) : null}
          </section>
        </div>
      ) : null}

    </Page>
  );
}
