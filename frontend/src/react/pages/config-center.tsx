/**
 * INTEGRATION: 让 entry.tsx 改为使用本文件的 ConfigCenterPage，
 * 替换 `export function ConfigCenterPage`（或改为 re-export）。
 * App.tsx 已从 entry 导入；切到本文件后即可启用完整配置中心。
 *
 * 本页对照 Vue ConfigCenterView：概览 / Panel JSON / SSH / 差异 / 备份。
 */
import { Dialogs, Events } from "@wailsio/runtime";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { api, type main } from "@/api";
import { CodeSurface } from "@/react/components/code-surface";
import { Button } from "@/react/components/ui/button";
import { Card } from "@/react/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@/react/components/ui/dialog";
import { Notice, Page } from "@/react/components/page";
import { ConfigConflictsPanel } from "@/react/pages/config-conflicts";
import { ConfigSshFilesPanel } from "@/react/pages/config-ssh";
import { useSession } from "@/react/state/session";
import { formatBytes, formatErr } from "@/utils/format";

type ConflictChoice = "panel" | "external" | "manual";

function statusLabel(status?: {
  needsReview?: boolean;
  configStale?: boolean;
  drift?: boolean;
}) {
  if (!status) return "检测中";
  if (status.needsReview) return "需人工解决";
  if (status.configStale) return "配置待生成";
  if (status.drift) return "外部有修改";
  return "正常";
}

function diffKindLabel(kind: string) {
  if (kind === "added") return "新增";
  if (kind === "removed") return "删除";
  if (kind === "changed") return "变化";
  return kind || "结构";
}

function formatUnixTime(value?: number) {
  if (!value) return "—";
  return new Date(value * (value < 1e12 ? 1000 : 1)).toLocaleString();
}

function compactPath(path?: string) {
  if (!path) return "—";
  if (path.length > 62) return `…${path.slice(-59)}`;
  return path.replace(/^\/Users\/[^/]+/, "~");
}

function shortHash(value?: string) {
  if (!value) return "—";
  return value.slice(0, 8);
}

function kindDotClass(type: string) {
  if (type === "added") return "bg-success";
  if (type === "removed" || type === "danger") return "bg-danger";
  if (type === "changed") return "bg-info";
  return "bg-info";
}

export function ConfigCenterPage() {
  const session = useSession();
  const section = session.configSection;

  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // Panel JSON 草稿
  const [jsonText, setJsonText] = useState("");
  const [jsonDirty, setJsonDirty] = useState(false);
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [hydratingJson, setHydratingJson] = useState(false);

  // 备份
  const [selectedBackupId, setSelectedBackupId] = useState("");
  const [backupDetail, setBackupDetail] = useState<main.PanelBackup | null>(null);
  const [restoreOpen, setRestoreOpen] = useState(false);

  // 提交前预览（JSON / 导入差异）
  const [preview, setPreview] = useState<main.PanelConfigPreview | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewFilePath, setPreviewFilePath] = useState("");
  const [choices, setChoices] = useState<Record<string, ConflictChoice>>({});
  const [manualTexts, setManualTexts] = useState<Record<string, string>>({});

  // 加密导出口令
  const [exportOpen, setExportOpen] = useState(false);
  const [exportPassphrase, setExportPassphrase] = useState("");
  const [exportPath, setExportPath] = useState("");

  // 系统编辑器选择
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorLoading, setEditorLoading] = useState(false);
  const [editorTargetPath, setEditorTargetPath] = useState("");
  const [systemEditors, setSystemEditors] = useState<main.PanelSystemEditor[]>([]);
  const [launchingEditorId, setLaunchingEditorId] = useState("");

  const overview = useQuery({
    queryKey: ["config-overview"],
    queryFn: () => api.getPanelConfigOverview(),
  });
  const files = useQuery({
    queryKey: ["config-files"],
    queryFn: () => api.getPanelConfigTree(),
    enabled: section === "files" || section === "diff" || section === "overview" || section === "json",
  });
  const backups = useQuery({
    queryKey: ["config-backups"],
    queryFn: () => api.listPanelBackups(),
    enabled: section === "backups" || section === "overview",
  });

  const diff = overview.data?.diff;

  // 影响摘要：按类型分别计数
  const impactItems = useMemo(() => {
    if (!diff) return [];
    return [
      { key: "added", label: "新增主机", count: (diff.addedHosts || []).length, type: "added" },
      { key: "removed", label: "删除主机", count: (diff.removedHosts || []).length, type: "removed" },
      { key: "changed", label: "主机字段变化", count: (diff.changedHosts || []).length, type: "changed" },
      { key: "files", label: "文件变化", count: (diff.changedFiles || []).length, type: "changed" },
      {
        key: "conflicts",
        label: "待解决冲突",
        count: (diff.conflicts || []).length,
        type: "danger",
      },
    ].filter((item) => item.count > 0);
  }, [diff]);

  const previewFile = useMemo(() => {
    if (!preview?.fileDiff?.length) return null;
    return (
      preview.fileDiff.find((file) => file.path === previewFilePath) ||
      preview.fileDiff[0] ||
      null
    );
  }, [preview, previewFilePath]);

  const panelJsonFile = useMemo(
    () => (files.data || []).find((file) => file.panelJson) || null,
    [files.data],
  );

  // 进入 JSON 分区时加载脱敏草稿（有未保存草稿则不覆盖）
  useEffect(() => {
    if (section !== "json") return;
    if (jsonDirty && jsonText) return;
    void loadJson(false);
    // 仅在切换到 json 时触发；脏标记保护草稿
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section]);

  useEffect(() => {
    if (section !== "backups") return;
    const list = backups.data || [];
    if (!list.length) {
      setSelectedBackupId("");
      setBackupDetail(null);
      return;
    }
    const id =
      selectedBackupId && list.some((item) => item.id === selectedBackupId)
        ? selectedBackupId
        : list[0]!.id;
    if (id !== selectedBackupId) setSelectedBackupId(id);
    void api
      .getPanelBackup(id)
      .then(setBackupDetail)
      .catch((err) => setError(formatErr(err)));
  }, [backups.data, section, selectedBackupId]);

  // 预览冲突默认选项
  useEffect(() => {
    if (!preview) return;
    setChoices((prev) => {
      const next = { ...prev };
      for (const conflict of preview.conflicts || []) {
        if (!next[conflict.id]) next[conflict.id] = "panel";
      }
      return next;
    });
    setManualTexts((prev) => {
      const next = { ...prev };
      for (const conflict of preview.conflicts || []) {
        if (next[conflict.id] === undefined) {
          next[conflict.id] = conflict.external || "";
        }
      }
      return next;
    });
  }, [preview]);

  // 外部配置变化：有未保存草稿时不自动盖掉
  useEffect(() => {
    const offImported = Events.On("panel-config-imported", () => {
      if (jsonDirty) {
        setError("检测到外部配置变化；当前草稿已暂停自动覆盖，请先处理差异。");
        return;
      }
      void refreshAll();
    });
    const offReview = Events.On("panel-config-needs-review", () => {
      void refreshAll();
    });
    const offError = Events.On("panel-config-import-error", () => {
      void refreshAll();
    });
    return () => {
      offImported();
      offReview();
      offError();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jsonDirty]);

  async function refreshAll() {
    setError("");
    await Promise.all([
      overview.refetch(),
      files.refetch(),
      section === "backups" || section === "overview"
        ? backups.refetch()
        : Promise.resolve(),
    ]);
    // JSON 分区且草稿干净时才重载
    if (section === "json" && !jsonDirty) {
      await loadJson(passwordVisible);
    }
  }

  async function loadJson(reveal: boolean) {
    setBusy(true);
    setError("");
    try {
      const state = reveal
        ? await api.getEditablePanelStateSensitive()
        : await api.getEditablePanelState();
      setHydratingJson(true);
      setJsonText(JSON.stringify(state, null, 2));
      setJsonDirty(false);
      setPasswordVisible(reveal);
      // 下一帧再允许标记脏，避免设置文本本身触发 onChange
      requestAnimationFrame(() => setHydratingJson(false));
    } catch (err) {
      setError(formatErr(err));
    } finally {
      setBusy(false);
    }
  }

  async function togglePasswords() {
    if (passwordVisible) {
      if (jsonDirty) {
        const answer = await Dialogs.Question({
          Title: "重新加载脱敏 JSON",
          Message: "隐藏敏感字段会重新加载当前 JSON 草稿，未提交的编辑会丢失。",
          Buttons: [
            { Label: "取消", IsCancel: true },
            { Label: "重新加载", IsDefault: true },
          ],
        });
        if (answer !== "重新加载") return;
      }
      await loadJson(false);
      return;
    }
    await loadJson(true);
  }

  function showPreview(value: main.PanelConfigPreview) {
    setPreview(value);
    setPreviewFilePath(value.fileDiff?.[0]?.path || "");
    setPreviewOpen(true);
  }

  /** 工具栏「导入差异」：打开完整预览窗，不只出一句提示 */
  async function previewExternalImport() {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const tree = await api.getPanelConfigTree();
      const draftFiles = tree
        .filter((file) => !file.panelJson)
        .map((file) => ({
          path: file.path,
          content: file.content,
          mode: file.mode,
          sha256: file.sha256,
        }));
      const next = await api.previewConfigDraft({ files: draftFiles });
      showPreview(next);
      setMessage(
        next.valid
          ? "已生成差异预览，确认后可提交。"
          : "预览存在冲突，请逐项选择处理方式后再提交。",
      );
    } catch (err) {
      setError(formatErr(err));
    } finally {
      setBusy(false);
    }
  }

  async function previewJson() {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const parsed = JSON.parse(jsonText) as main.PanelStateDraft;
      if (!parsed || !Array.isArray(parsed.hosts) || !Array.isArray(parsed.groups)) {
        throw new Error("必须包含 hosts 和 groups 数组");
      }
      const next = await api.previewPanelState(parsed);
      showPreview(next);
      setMessage(
        next.valid
          ? "Panel JSON 预览已生成。"
          : "预览存在冲突或无效，请处理后提交。",
      );
    } catch (err) {
      setError(formatErr(err));
    } finally {
      setBusy(false);
    }
  }

  async function resolveConflicts() {
    if (!preview?.previewId) return;
    const conflicts = preview.conflicts || [];
    if (!conflicts.length) return;
    setBusy(true);
    setError("");
    try {
      const resolutions: main.PanelConfigResolution[] = conflicts.map((conflict) => ({
        id: conflict.id,
        choice: choices[conflict.id] || "panel",
        manual: manualTexts[conflict.id] || "",
      }));
      const next = await api.resolveConfigConflicts(preview.previewId, resolutions);
      showPreview(next);
      setMessage(
        next.valid ? "冲突已应用，预览可提交。" : "已重新预览，若仍有冲突请继续处理。",
      );
    } catch (err) {
      setError(formatErr(err));
    } finally {
      setBusy(false);
    }
  }

  async function commitPreview() {
    if (!preview?.valid || !preview.previewId) return;
    setBusy(true);
    setError("");
    try {
      await api.commitPanelPreview(preview.previewId);
      setPreviewOpen(false);
      setPreview(null);
      setChoices({});
      setManualTexts({});
      setJsonDirty(false);
      setMessage("已备份并提交 Panel JSON 与 SSH 配置。");
      await refreshAll();
      await session.refresh();
    } catch (err) {
      setError(formatErr(err));
      await refreshAll();
    } finally {
      setBusy(false);
    }
  }

  async function restoreSelected() {
    if (!backupDetail) return;
    setBusy(true);
    setError("");
    try {
      await api.restorePanelBackup(backupDetail.summary.id);
      setRestoreOpen(false);
      setMessage("配置快照已恢复。");
      await refreshAll();
      await backups.refetch();
      await session.refresh();
    } catch (err) {
      setError(formatErr(err));
    } finally {
      setBusy(false);
    }
  }

  /** 概览与备份共用：先选路径，再要口令 */
  async function beginEncryptedExport() {
    setError("");
    try {
      const path = await Dialogs.SaveFile({
        Title: "导出加密 Panel 备份",
        Filename: "1pannel-backup.age",
        CanCreateDirectories: true,
        CanChooseDirectories: false,
        CanChooseFiles: true,
      });
      if (!path) return;
      setExportPath(path);
      setExportPassphrase("");
      setExportOpen(true);
    } catch (err) {
      setError(formatErr(err));
    }
  }

  async function confirmEncryptedExport() {
    if (!exportPath || !exportPassphrase) {
      setError("请输入导出口令。");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await api.exportEncryptedPanelBackup(exportPath, exportPassphrase);
      setExportOpen(false);
      setExportPassphrase("");
      setExportPath("");
      setMessage("已生成 age 加密备份（含密码）。");
    } catch (err) {
      setError(formatErr(err));
    } finally {
      setBusy(false);
    }
  }

  async function openEditorPicker(path: string) {
    if (!path) return;
    setEditorTargetPath(path);
    setEditorOpen(true);
    setEditorLoading(true);
    try {
      setSystemEditors(await api.listSystemEditors());
    } catch (err) {
      setEditorOpen(false);
      setError(formatErr(err));
    } finally {
      setEditorLoading(false);
    }
  }

  async function launchEditor(editor: main.PanelSystemEditor) {
    if (!editorTargetPath || launchingEditorId) return;
    setLaunchingEditorId(editor.id);
    try {
      await api.openPanelPathWithEditor(editorTargetPath, editor.id);
      setEditorOpen(false);
      try {
        localStorage.setItem("1pannel.config.editor", editor.id);
      } catch {
        // 忽略本地存储失败
      }
    } catch (err) {
      setError(formatErr(err));
    } finally {
      setLaunchingEditorId("");
    }
  }

  async function revealPath(path: string) {
    if (!path) return;
    try {
      await api.revealPanelPath(path);
    } catch (err) {
      setError(formatErr(err));
    }
  }

  return (
    <Page
      title="配置中心"
      flush={section === "json" || section === "files" || section === "diff"}
      actions={
        <>
          <span className="text-sm text-muted">{statusLabel(overview.data)}</span>
          {overview.data?.drift || overview.data?.needsReview ? (
            <Button disabled={busy} onClick={() => void previewExternalImport()}>
              导入差异
            </Button>
          ) : null}
        </>
      }
      onRefresh={() => void refreshAll()}
      refreshing={busy}
    >
      {error ? <Notice text={error} /> : null}
      {message ? <Notice text={message} tone="warn" /> : null}

      {section === "overview" ? (
        <div className="gap-card flex flex-col">
          <Card>
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" onClick={() => session.setConfigSection("json")}>
                编辑 Panel JSON
              </Button>
              <Button onClick={() => session.setConfigSection("files")}>查看 SSH 文件</Button>
              <Button onClick={() => session.setConfigSection("diff")}>差异与冲突</Button>
              <Button onClick={() => session.setConfigSection("backups")}>备份与恢复</Button>
            </div>
          </Card>

          <div className="gap-card grid md:grid-cols-2 xl:grid-cols-4">
            <Card>
              <div className="text-sm text-muted">Panel 主机</div>
              <div className="text-2xl">{overview.data?.hostCount ?? 0}</div>
              <div className="text-xs text-muted">Revision {overview.data?.revision ?? 0}</div>
            </Card>
            <Card>
              <div className="text-sm text-muted">分组</div>
              <div className="text-2xl">{overview.data?.groupCount ?? 0}</div>
            </Card>
            <Card>
              <div className="text-sm text-muted">SSH 文件</div>
              <div className="text-2xl">{overview.data?.configFileCount ?? 0}</div>
              <div className="text-xs text-muted">
                {overview.data?.includeCount ?? 0} 个 Include 文件
              </div>
            </Card>
            <Card
              className={
                overview.data?.configStale || overview.data?.drift
                  ? "border-danger/40 bg-danger-soft"
                  : undefined
              }
            >
              <div className="text-sm text-muted">配置状态</div>
              <div className="text-lg">{statusLabel(overview.data)}</div>
              <div className="text-xs text-muted">
                上次生成 {formatUnixTime(overview.data?.lastGenerated)}
              </div>
            </Card>
          </div>

          <div className="gap-card grid md:grid-cols-2">
            <Card>
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <div className="font-medium">配置位置</div>
                </div>
                <Button
                  size="sm"
                  onClick={() => void revealPath(overview.data?.panelPath || "")}
                >
                  定位 Panel
                </Button>
              </div>
              <div className="grid grid-cols-[82px_minmax(0,1fr)_auto] items-center gap-2 border-b border-line py-2 text-sm">
                <span className="text-muted">Panel JSON</span>
                <code className="truncate font-mono text-xs" title={overview.data?.panelPath}>
                  {compactPath(overview.data?.panelPath)}
                </code>
                <Button size="sm" variant="ghost" onClick={() => session.setConfigSection("json")}>
                  查看
                </Button>
              </div>
              <div className="grid grid-cols-[82px_minmax(0,1fr)_auto] items-center gap-2 border-b border-line py-2 text-sm">
                <span className="text-muted">SSH config</span>
                <code className="truncate font-mono text-xs" title={overview.data?.sshConfigPath}>
                  {compactPath(overview.data?.sshConfigPath)}
                </code>
                <Button size="sm" variant="ghost" onClick={() => session.setConfigSection("files")}>
                  查看
                </Button>
              </div>
              <div className="grid grid-cols-[82px_minmax(0,1fr)_auto] items-center gap-2 py-2 text-sm">
                <span className="text-muted">Include</span>
                <code className="truncate font-mono text-xs text-muted">
                  ~/.ssh/config.d/*.conf
                </code>
                <Button size="sm" variant="ghost" onClick={() => void revealPath("config.d")}>
                  定位
                </Button>
              </div>
            </Card>

            <Card>
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <div className="font-medium">影响摘要</div>
                </div>
                <Button size="sm" onClick={() => session.setConfigSection("diff")}>
                  查看全部
                </Button>
              </div>
              {impactItems.length > 0 ? (
                <div className="space-y-2">
                  {impactItems.map((item) => (
                    <div
                      key={item.key}
                      className="flex items-center gap-2 text-sm text-muted"
                    >
                      <span
                        className={`inline-block h-1.5 w-1.5 rounded-full ${kindDotClass(item.type)}`}
                      />
                      <span>{item.label}</span>
                      <strong className="ml-auto text-ink">{item.count}</strong>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted">当前没有待处理差异</p>
              )}
            </Card>
          </div>

          <Card>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="font-medium">最近备份</div>
                {overview.data?.lastBackup ? (
                  <p className="mt-1 text-sm text-muted">
                    {formatUnixTime(overview.data.lastBackup.createdAt)} ·{" "}
                    {overview.data.lastBackup.hostCount} 台主机 ·{" "}
                    {overview.data.lastBackup.fileCount} 个配置文件
                  </p>
                ) : (
                  <p className="mt-1 text-sm text-muted">尚未生成自动备份</p>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => session.setConfigSection("backups")}>备份与恢复</Button>
                <Button disabled={busy} onClick={() => void beginEncryptedExport()}>
                  加密导出
                </Button>
              </div>
            </div>
          </Card>
        </div>
      ) : null}

      {section === "json" ? (
        <div className="surface-float m-[var(--gap-card)] flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
            <div>
              <h2 className="text-lg font-medium">Panel 状态草稿</h2>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button disabled={busy} onClick={() => void togglePasswords()}>
                {passwordVisible ? "隐藏敏感字段" : "显示敏感字段"}
              </Button>
              <Button
                disabled={busy}
                onClick={() => {
                  const path = panelJsonFile?.absolutePath || overview.data?.panelPath || "";
                  void openEditorPicker(path);
                }}
              >
                系统编辑器
              </Button>
              <Button
                disabled={busy}
                onClick={() => {
                  const path = panelJsonFile?.absolutePath || overview.data?.panelPath || "";
                  void revealPath(path);
                }}
              >
                定位
              </Button>
              <Button disabled={busy} onClick={() => void loadJson(passwordVisible)}>
                重新加载
              </Button>
              <Button variant="primary" disabled={busy} onClick={() => void previewJson()}>
                校验并预览
              </Button>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-hidden border-t border-line">
            <CodeSurface
              value={jsonText}
              language="json"
              readOnly={false}
              onChange={(value) => {
                if (hydratingJson) return;
                setJsonText(value);
                setJsonDirty(true);
              }}
            />
          </div>
          <div
            className={`flex flex-wrap justify-between gap-2 px-4 py-2 text-xs ${
              jsonDirty ? "text-danger" : "text-muted"
            }`}
          >
            <span>
              {jsonDirty ? "草稿未保存" : "当前草稿与已加载的 Panel 状态一致"}
            </span>
          </div>
        </div>
      ) : null}

      {section === "files" ? (
        <div className="m-[var(--gap-card)] min-h-0 flex-1">
          <div className="surface-float flex h-full min-h-0 flex-col overflow-hidden">
            <ConfigSshFilesPanel
              onOpenPanelJson={() => session.setConfigSection("json")}
              onCommitted={async () => {
                setPreview(null);
                setJsonDirty(false);
                await refreshAll();
                await session.refresh();
              }}
            />
          </div>
        </div>
      ) : null}

      {section === "diff" ? (
        <div className="m-[var(--gap-card)] min-h-0 flex-1">
          <div className="surface-float flex h-full min-h-0 flex-col overflow-hidden">
            <ConfigConflictsPanel
              onOpenSshFiles={() => session.setConfigSection("files")}
              onCommitted={async () => {
                setPreview(null);
                setJsonDirty(false);
                await refreshAll();
                await session.refresh();
              }}
            />
          </div>
        </div>
      ) : null}

      {section === "backups" ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-medium">备份与恢复</h2>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button disabled={busy} onClick={() => void beginEncryptedExport()}>
                加密导出
              </Button>
              <Button
                disabled={busy || backups.isFetching}
                onClick={() => void backups.refetch()}
              >
                刷新时间线
              </Button>
            </div>
          </div>
          <div className="grid min-h-0 flex-1 md:grid-cols-[280px_1fr]">
            <div className="min-h-0 overflow-auto border-r border-line bg-surface">
              {(backups.data || []).map((backup) => (
                <button
                  key={backup.id}
                  type="button"
                  className={`block w-full border-b border-line px-3 py-3 text-left hover:bg-raised ${
                    selectedBackupId === backup.id
                      ? "bg-accent-soft font-semibold text-accent"
                      : ""
                  }`}
                  onClick={() => setSelectedBackupId(backup.id)}
                >
                  <div className="text-sm">{formatUnixTime(backup.createdAt)}</div>
                  <div className="font-medium">Revision {backup.revision}</div>
                  <div className="text-xs text-muted">
                    {backup.hostCount} 台 · {backup.fileCount} 文件 · {formatBytes(backup.size)}
                  </div>
                </button>
              ))}
              {(backups.data || []).length === 0 ? (
                <p className="p-4 text-sm text-muted">暂无自动备份</p>
              ) : null}
            </div>
            <Card>
              {backupDetail ? (
                <>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="text-xs text-muted">SNAPSHOT</div>
                      <h3 className="text-lg font-medium">
                        {formatUnixTime(backupDetail.summary.createdAt)}
                      </h3>
                      <div className="mt-1 text-sm text-muted">
                        Revision {backupDetail.summary.revision} ·{" "}
                        {formatBytes(backupDetail.summary.size)}
                      </div>
                      <div className="mt-1 truncate font-mono text-xs text-muted">
                        {backupDetail.summary.path}
                      </div>
                    </div>
                    <Button
                      variant="primary"
                      disabled={busy}
                      onClick={() => setRestoreOpen(true)}
                    >
                      恢复此快照
                    </Button>
                  </div>
                  <div className="mt-4 max-h-[48vh] overflow-auto border border-line">
                    {(backupDetail.files || []).map((file) => (
                      <div
                        key={file.path}
                        className="flex items-center justify-between border-b border-line px-3 py-2 text-sm"
                      >
                        <span className="truncate font-mono">
                          {file.displayPath || file.path}
                        </span>
                        <span className="text-muted">
                          {shortHash(file.sha256)} · {formatBytes(file.size)}
                        </span>
                      </div>
                    ))}
                  </div>
                  <p className="mt-3 text-sm text-muted">
                    恢复会同时回滚 Panel JSON 与 SSH 文件树，恢复前会先创建当前状态快照；不要求远程主机在线。
                  </p>
                </>
              ) : (
                <p className="text-muted">选择左侧备份查看详情</p>
              )}
            </Card>
          </div>
        </div>
      ) : null}

      {/* 提交前完整预览：连接测试、冲突逐项选择、确认提交 */}
      <Dialog
        open={previewOpen}
        onOpenChange={(open) => {
          if (!open) setPreviewOpen(false);
        }}
      >
        <DialogContent className="flex max-h-[min(88vh,820px)] w-[min(1120px,calc(100%-32px))] flex-col overflow-hidden p-0">
          <div className="border-b border-line px-5 py-4">
            <DialogTitle>提交前预览</DialogTitle>
            <DialogDescription className="mt-1">
              基于 Revision {preview?.baseRevision ?? "—"}
              {preview?.expiresAt ? ` · ${formatUnixTime(preview.expiresAt)} 过期` : ""}
            </DialogDescription>
          </div>

          <div className="min-h-0 flex-1 overflow-auto px-5 py-4">
            {preview ? (
              <>
                <div
                  className={`mb-3 rounded-control border px-3 py-2 ${
                    preview.valid
                      ? "border-success/40 bg-success-soft text-success"
                      : "border-danger/40 bg-danger-soft text-danger"
                  }`}
                >
                  <div className="font-medium">
                    {preview.valid ? "可以提交" : "需要处理后才能提交"}
                  </div>
                  {preview.error ? <div className="mt-1 text-sm">{preview.error}</div> : null}
                </div>

                <section className="mb-4">
                  <div className="mb-2 flex items-center justify-between">
                    <h3 className="text-sm font-medium">连接测试</h3>
                    <span className="text-xs text-muted">
                      {(preview.affectedHosts || []).length} 台受影响主机
                    </span>
                  </div>
                  {(preview.connectionTests || []).length ? (
                    <div className="space-y-1">
                      {(preview.connectionTests || []).map((test) => (
                        <div
                          key={test.alias}
                          className="flex flex-wrap items-center gap-2 rounded-control border border-line px-2 py-1.5 text-sm"
                        >
                          <span
                            className={`rounded-control px-1.5 py-0.5 text-xs ${
                              test.success
                                ? "bg-success-soft text-success"
                                : "bg-danger-soft text-danger"
                            }`}
                          >
                            {test.success ? "通过" : "失败"}
                          </span>
                          <strong>{test.alias}</strong>
                          <span className="text-muted">
                            {test.success ? test.message || "" : test.error || ""}
                          </span>
                          <span className="ml-auto text-xs text-muted">
                            {test.durationMs} ms
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-muted">
                      仅修改布局、备注或注释，无需远程连通性测试。
                    </p>
                  )}
                </section>

                {(preview.conflicts || []).length > 0 ? (
                  <section className="mb-4">
                    <div className="mb-2 flex items-center justify-between">
                      <h3 className="text-sm font-medium">逐项解决冲突</h3>
                      <span className="text-xs text-muted">全部解决后才可提交</span>
                    </div>
                    <div className="space-y-3">
                      {(preview.conflicts || []).map((conflict) => {
                        const choice = choices[conflict.id] || "panel";
                        return (
                          <div
                            key={conflict.id}
                            className="rounded-control border border-danger/40 bg-danger-soft px-3 py-3"
                          >
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <div className="min-w-0">
                                <div className="font-medium text-ink">
                                  {conflict.alias || conflict.file || "配置项"}
                                </div>
                                <div className="mt-0.5 text-sm text-danger">
                                  {conflict.summary}
                                </div>
                              </div>
                              <select
                                className="rounded-control border border-line bg-surface px-2 py-1.5 text-sm"
                                value={choice}
                                onChange={(event) => {
                                  const value = event.target.value as ConflictChoice;
                                  setChoices((prev) => ({ ...prev, [conflict.id]: value }));
                                }}
                              >
                                <option value="panel">保留 Panel</option>
                                <option value="external">采用外部</option>
                                {conflict.file ? (
                                  <option value="manual">手工合并</option>
                                ) : null}
                              </select>
                            </div>
                            {choice === "manual" && conflict.file ? (
                              <textarea
                                className="mt-2 w-full rounded-control border border-line bg-surface px-2 py-2 font-mono text-xs"
                                rows={6}
                                placeholder="输入最终文件内容"
                                value={manualTexts[conflict.id] || ""}
                                onChange={(event) => {
                                  const value = event.target.value;
                                  setManualTexts((prev) => ({
                                    ...prev,
                                    [conflict.id]: value,
                                  }));
                                }}
                              />
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                    <div className="mt-3">
                      <Button disabled={busy} onClick={() => void resolveConflicts()}>
                        应用冲突选择并重新预览
                      </Button>
                    </div>
                  </section>
                ) : null}

                <section>
                  <div className="mb-2 flex items-center justify-between">
                    <h3 className="text-sm font-medium">文件与主机影响</h3>
                    <span className="text-xs text-muted">
                      {(preview.fileDiff || []).length} 个文件 ·{" "}
                      {(preview.hostDiff || []).length} 台主机
                    </span>
                  </div>
                  <div className="mb-2 flex flex-wrap gap-1">
                    {(preview.fileDiff || []).map((file) => (
                      <button
                        key={file.path}
                        type="button"
                        className={`rounded-control border px-2 py-1 text-xs ${
                          previewFile?.path === file.path
                            ? "border-accent bg-accent-soft font-semibold text-accent"
                            : "border-line"
                        }`}
                        onClick={() => setPreviewFilePath(file.path)}
                      >
                        {diffKindLabel(file.kind)} · {file.path}
                      </button>
                    ))}
                  </div>
                  {previewFile ? (
                    <div className="mb-3 grid max-h-64 gap-2 overflow-auto md:grid-cols-3">
                      <DiffPane title="Panel 快照" text={previewFile.panelContent || ""} />
                      <DiffPane title="当前磁盘" text={previewFile.externalContent || ""} />
                      <DiffPane title="待生成结果" text={previewFile.generatedContent || ""} />
                    </div>
                  ) : null}
                  {(preview.hostDiff || []).map((host) => (
                    <div
                      key={host.alias}
                      className="mt-1 flex flex-wrap items-center gap-2 border-t border-line py-2 text-sm"
                    >
                      <span className="rounded-control border border-line px-1.5 py-0.5 text-xs">
                        {diffKindLabel(host.kind)}
                      </span>
                      <strong>{host.alias}</strong>
                      <span className="text-muted">
                        {(host.fields || []).join(" · ") || "结构变化"}
                      </span>
                    </div>
                  ))}
                </section>
              </>
            ) : null}
          </div>

          <DialogFooter className="mt-0 border-t border-line px-5 py-3">
            <Button onClick={() => setPreviewOpen(false)}>取消</Button>
            <Button
              variant="primary"
              disabled={busy || !preview?.valid}
              onClick={() => void commitPreview()}
            >
              确认备份并提交
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={restoreOpen} onOpenChange={setRestoreOpen}>
        <DialogContent>
          <DialogTitle>恢复配置快照</DialogTitle>
          <DialogDescription>
            将恢复 {formatUnixTime(backupDetail?.summary.createdAt)} 的 Panel JSON 与 SSH
            文件树。当前状态会先自动备份。
          </DialogDescription>
          <DialogFooter>
            <Button onClick={() => setRestoreOpen(false)}>取消</Button>
            <Button variant="primary" disabled={busy} onClick={() => void restoreSelected()}>
              恢复
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={exportOpen}
        onOpenChange={(open) => {
          setExportOpen(open);
          if (!open) {
            setExportPassphrase("");
            setExportPath("");
          }
        }}
      >
        <DialogContent>
          <DialogTitle>加密导出</DialogTitle>
          <DialogDescription>
            完整导出包含 Panel JSON 中的密码，请设置一个不会被 Panel 保存的口令。
          </DialogDescription>
          <p className="mt-2 truncate font-mono text-xs text-muted" title={exportPath}>
            {exportPath || "—"}
          </p>
          <input
            type="password"
            className="mt-3 w-full rounded-control border border-line bg-surface px-3 py-2 text-sm"
            placeholder="导出口令"
            value={exportPassphrase}
            onChange={(event) => setExportPassphrase(event.target.value)}
            autoFocus
          />
          <DialogFooter>
            <Button onClick={() => setExportOpen(false)}>取消</Button>
            <Button
              variant="primary"
              disabled={busy || !exportPassphrase}
              onClick={() => void confirmEncryptedExport()}
            >
              导出
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={editorOpen} onOpenChange={setEditorOpen}>
        <DialogContent>
          <DialogTitle>选择系统编辑器</DialogTitle>
          <DialogDescription>
            选择一个已安装的应用打开当前配置文件。
          </DialogDescription>
          <p className="mt-1 truncate font-mono text-xs text-muted" title={editorTargetPath}>
            {compactPath(editorTargetPath)}
          </p>
          <div className="mt-3 max-h-72 space-y-2 overflow-auto">
            {editorLoading ? (
              <p className="text-sm text-muted">正在扫描系统编辑器…</p>
            ) : systemEditors.length ? (
              systemEditors.map((editor) => (
                <button
                  key={editor.id}
                  type="button"
                  disabled={!!launchingEditorId}
                  className={`flex w-full items-center gap-3 rounded-control border px-3 py-2 text-left hover:bg-raised ${
                    editor.systemDefault ? "border-dashed border-accent/40" : "border-line"
                  }`}
                  onClick={() => void launchEditor(editor)}
                >
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">
                      {editor.name}
                      {editor.systemDefault ? (
                        <span className="ml-2 text-xs text-muted">默认</span>
                      ) : null}
                    </div>
                    <div className="truncate font-mono text-[11px] text-muted">
                      {editor.path}
                    </div>
                  </div>
                  {launchingEditorId === editor.id ? (
                    <span className="text-xs text-muted">打开中…</span>
                  ) : null}
                </button>
              ))
            ) : (
              <p className="text-sm text-muted">没有发现可用的系统编辑器</p>
            )}
          </div>
          <DialogFooter>
            <Button onClick={() => setEditorOpen(false)}>取消</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Page>
  );
}

function DiffPane({ title, text }: { title: string; text: string }) {
  return (
    <div className="flex min-h-[180px] min-w-0 flex-col overflow-hidden rounded-control border border-line">
      <div className="border-b border-line bg-raised px-2 py-1.5 text-[10px] font-semibold text-muted">
        {title}
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        <CodeSurface value={text || ""} language="ssh" readOnly />
      </div>
    </div>
  );
}
