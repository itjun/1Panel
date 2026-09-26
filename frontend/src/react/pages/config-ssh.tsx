import { Events } from "@wailsio/runtime";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { api, type main, type panelsync } from "@/api";
import { CodeSurface } from "@/react/components/code-surface";
import { Button } from "@/react/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@/react/components/ui/dialog";
import { formatBytes, formatErr } from "@/utils/format";

type Props = {
  onOpenPanelJson: () => void;
  onCommitted?: () => void | Promise<void>;
};

type ConflictChoice = "panel" | "external" | "manual";

function formatMode(mode: number) {
  return mode ? `0${mode.toString(8)}` : "0600";
}

function formatFileTime(value?: number) {
  if (!value) return "—";
  return new Date(value * (value < 1e12 ? 1000 : 1)).toLocaleString();
}

function compactPath(path?: string) {
  if (!path) return "—";
  if (path.length > 62) return `…${path.slice(-59)}`;
  return path.replace(/^\/Users\/[^/]+/, "~");
}

function diffKindLabel(kind: string) {
  if (kind === "added") return "新增";
  if (kind === "removed") return "删除";
  if (kind === "changed") return "变化";
  return kind || "结构";
}

/**
 * 配置中心「SSH 文件」分区：文件树、每文件草稿、脏/外部标记、校验预览与提交。
 * 预览窗内可逐项解决冲突并提交，不必只跳到差异页。
 */
export function ConfigSshFilesPanel({ onOpenPanelJson, onCommitted }: Props) {
  const filesQuery = useQuery({
    queryKey: ["config-files"],
    queryFn: () => api.getPanelConfigTree(),
  });

  const [selectedPath, setSelectedPath] = useState("");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [dirtyPaths, setDirtyPaths] = useState<Set<string>>(() => new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [preview, setPreview] = useState<main.PanelConfigPreview | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewFilePath, setPreviewFilePath] = useState("");
  const [choices, setChoices] = useState<Record<string, ConflictChoice>>({});
  const [manualTexts, setManualTexts] = useState<Record<string, string>>({});

  const configFiles = filesQuery.data || [];
  const hasDirty = dirtyPaths.size > 0;

  useEffect(() => {
    if (!configFiles.length) return;
    if (selectedPath && configFiles.some((file) => file.path === selectedPath)) return;
    const firstSsh =
      configFiles.find((file) => !file.panelJson)?.path || configFiles[0]!.path;
    setSelectedPath(firstSsh);
  }, [configFiles, selectedPath]);

  // 有未保存草稿时，外部导入事件不自动刷新盖掉编辑
  useEffect(() => {
    const offImported = Events.On("panel-config-imported", () => {
      if (dirtyPaths.size > 0) {
        setError("检测到外部配置变化；当前草稿已暂停自动覆盖，请先处理差异。");
        return;
      }
      void filesQuery.refetch();
    });
    const offReview = Events.On("panel-config-needs-review", () => {
      if (dirtyPaths.size > 0) return;
      void filesQuery.refetch();
    });
    return () => {
      offImported();
      offReview();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirtyPaths]);

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

  const selectedFile =
    configFiles.find((file) => file.path === selectedPath) || null;
  const editorText =
    selectedFile && !selectedFile.panelJson
      ? (drafts[selectedFile.path] ?? selectedFile.content)
      : "";
  const fileDirty = selectedFile ? dirtyPaths.has(selectedFile.path) : false;

  const previewFile = useMemo(() => {
    if (!preview?.fileDiff?.length) return null;
    return (
      preview.fileDiff.find((file) => file.path === previewFilePath) ||
      preview.fileDiff[0] ||
      null
    );
  }, [preview, previewFilePath]);

  function selectFile(path: string) {
    const file = configFiles.find((item) => item.path === path);
    if (!file) return;
    if (file.panelJson) {
      onOpenPanelJson();
      return;
    }
    setSelectedPath(path);
  }

  function onEditorChange(value: string) {
    if (!selectedFile || selectedFile.panelJson) return;
    const path = selectedFile.path;
    setDrafts((prev) => ({ ...prev, [path]: value }));
    setDirtyPaths((prev) => {
      const next = new Set(prev);
      if (value === selectedFile.content) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  function buildDraftFiles(): panelsync.ConfigFile[] {
    return configFiles
      .filter((file) => !file.panelJson)
      .map((file) => ({
        path: file.path,
        content: drafts[file.path] ?? file.content,
        mode: file.mode,
        sha256: file.sha256,
      }));
  }

  async function refreshTree() {
    setError("");
    await filesQuery.refetch();
  }

  async function runPreview() {
    if (!hasDirty) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const next = await api.previewConfigDraft({ files: buildDraftFiles() });
      setPreview(next);
      setPreviewFilePath(next.fileDiff?.[0]?.path || "");
      setPreviewOpen(true);
      setMessage(
        next.valid
          ? "预览已生成，确认后可提交。"
          : "预览存在冲突，请在本窗逐项选择后再提交。",
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
      setPreview(next);
      setPreviewFilePath(next.fileDiff?.[0]?.path || previewFilePath);
      setMessage(
        next.valid
          ? "冲突已应用，预览可提交。"
          : "已重新预览，若仍有冲突请继续处理。",
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
      setDrafts({});
      setDirtyPaths(new Set());
      setMessage("已备份并提交 Panel JSON 与 SSH 配置。");
      await filesQuery.refetch();
      await onCommitted?.();
    } catch (err) {
      setError(formatErr(err));
      await filesQuery.refetch();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {error ? (
        <div className="rounded-control border border-danger/40 bg-danger-soft px-3 py-2 text-sm text-danger">
          {error}
        </div>
      ) : null}
      {message ? (
        <div className="rounded-control border border-success/40 bg-success-soft px-3 py-2 text-sm text-success">
          {message}
        </div>
      ) : null}

      <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[260px_1fr]">
        <aside className="flex min-h-0 flex-col overflow-hidden border-r border-line bg-surface">
          <div className="flex items-center justify-between border-b border-line px-3 py-2">
            <div>
              <div className="text-sm font-medium">文件树</div>
            </div>
            <Button size="sm" disabled={filesQuery.isFetching} onClick={() => void refreshTree()}>
              刷新
            </Button>
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
            {configFiles.map((file) => {
              const dirty = dirtyPaths.has(file.path);
              const active = file.path === selectedPath && !file.panelJson;
              return (
                <button
                  key={file.path}
                  type="button"
                  className={`flex w-full items-center gap-2 truncate px-3 py-2 text-left text-sm hover:bg-raised ${
                    active ? "bg-accent-soft font-semibold text-accent" : ""
                  } ${dirty && !active ? "font-medium" : ""}`}
                  onClick={() => selectFile(file.path)}
                >
                  <span className="min-w-0 flex-1 truncate">
                    {file.panelJson ? "Panel JSON" : file.path}
                  </span>
                  {dirty ? (
                    <span className="shrink-0 text-accent" title="本地已修改">
                      ●
                    </span>
                  ) : file.externalChanged ? (
                    <span className="shrink-0 text-[11px] text-danger">外部</span>
                  ) : null}
                </button>
              );
            })}
            {!configFiles.length && !filesQuery.isLoading ? (
              <p className="p-3 text-sm text-muted">暂无配置文件</p>
            ) : null}
          </div>
          <div className="border-t border-line px-2 py-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                void api.revealPanelPath("config.d").catch((err) => setError(formatErr(err)));
              }}
            >
              打开 config.d
            </Button>
          </div>
        </aside>

        <div className="flex min-h-0 flex-col overflow-hidden bg-surface">
          <div className="flex flex-wrap items-start justify-between gap-2 border-b border-line px-3 py-2">
            <div className="min-w-0">
              <div className="truncate font-medium">{selectedFile?.path || "config"}</div>
              <code className="block truncate text-[11px] text-muted" title={selectedFile?.absolutePath}>
                {compactPath(selectedFile?.absolutePath)}
              </code>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {selectedFile?.generated ? (
                <span className="rounded-control border border-line px-2 py-0.5 text-xs text-muted">
                  Panel 生成
                </span>
              ) : null}
              {selectedFile?.externalChanged ? (
                <span className="rounded-control border border-danger/40 bg-danger-soft px-2 py-0.5 text-xs text-danger">
                  磁盘已变化
                </span>
              ) : null}
              <Button
                size="sm"
                onClick={() => {
                  if (selectedFile?.absolutePath) {
                    void api
                      .openPanelPath(selectedFile.absolutePath)
                      .catch((err) => setError(formatErr(err)));
                  }
                }}
              >
                系统编辑器
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  if (selectedFile?.absolutePath) {
                    void api
                      .revealPanelPath(selectedFile.absolutePath)
                      .catch((err) => setError(formatErr(err)));
                  }
                }}
              >
                定位
              </Button>
              <Button
                size="sm"
                variant="primary"
                disabled={busy || !hasDirty}
                onClick={() => void runPreview()}
              >
                校验并预览
              </Button>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-hidden">
            {selectedFile && !selectedFile.panelJson ? (
              <CodeSurface
                key={selectedFile.path}
                value={editorText}
                language="ssh"
                readOnly={false}
                onChange={onEditorChange}
              />
            ) : (
              <div className="p-4 text-sm text-muted">请选择左侧 SSH 文件进行编辑。</div>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-3 py-2 text-xs text-muted">
            <span className={fileDirty ? "text-danger" : ""}>
              {fileDirty
                ? "草稿未保存，提交时会先导入 Panel JSON 再生成配置"
                : "文件内容来自当前磁盘快照"}
            </span>
            {selectedFile ? (
              <span>
                {formatBytes(selectedFile.size)} · {formatMode(selectedFile.mode)} ·{" "}
                {formatFileTime(selectedFile.updatedAt)}
              </span>
            ) : null}
          </div>
        </div>
      </div>

      <Dialog open={previewOpen} onOpenChange={(open) => !open && setPreviewOpen(false)}>
        <DialogContent className="flex max-h-[min(88vh,820px)] w-[min(1120px,calc(100%-32px))] flex-col overflow-hidden p-0">
          <div className="border-b border-line px-5 py-4">
            <DialogTitle>提交前预览</DialogTitle>
            <DialogDescription className="mt-1">
              基于 Revision {preview?.baseRevision ?? "—"}
              {preview?.expiresAt
                ? ` · ${formatFileTime(preview.expiresAt)} 过期`
                : ""}
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
                          <span className="ml-auto text-xs text-muted">{test.durationMs} ms</span>
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
                    <div className="grid max-h-52 gap-2 overflow-auto md:grid-cols-3">
                      <DiffPane title="Panel" text={previewFile.panelContent || ""} />
                      <DiffPane title="当前磁盘" text={previewFile.externalContent || ""} />
                      <DiffPane title="待生成" text={previewFile.generatedContent || ""} />
                    </div>
                  ) : null}
                  {(preview.hostDiff || []).map((host) => (
                    <div
                      key={host.alias}
                      className="mt-2 flex flex-wrap items-center gap-2 text-sm"
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
            <Button disabled={busy} onClick={() => setPreviewOpen(false)}>
              取消
            </Button>
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
    </div>
  );
}

function DiffPane({ title, text }: { title: string; text: string }) {
  return (
    <div className="rounded-control border border-line bg-raised p-2">
      <div className="mb-1 text-xs text-muted">{title}</div>
      <pre className="max-h-40 overflow-auto whitespace-pre-wrap font-mono text-[11px] text-ink">
        {text || "（空）"}
      </pre>
    </div>
  );
}
