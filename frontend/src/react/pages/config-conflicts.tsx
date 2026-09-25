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
  DialogTitle,
} from "@/react/components/ui/dialog";
import { formatErr } from "@/utils/format";

type Props = {
  onOpenSshFiles?: () => void;
  onCommitted?: () => void | Promise<void>;
};

type Choice = "panel" | "external" | "manual";

function diffKindLabel(kind: string) {
  if (kind === "added") return "新增";
  if (kind === "removed") return "删除";
  if (kind === "changed") return "变更";
  return kind || "变化";
}

function shortHash(value?: string) {
  if (!value) return "—";
  return value.slice(0, 8);
}

function formatUnixTime(value?: number) {
  if (!value) return "—";
  return new Date(value * (value < 1e12 ? 1000 : 1)).toLocaleString();
}

function kindClass(kind: string) {
  if (kind === "added") return "border-success/40 bg-success-soft text-success";
  if (kind === "removed") return "border-danger/40 bg-danger-soft text-danger";
  if (kind === "changed") return "border-warn/40 bg-warn-soft text-warn";
  return "border-line bg-raised text-muted";
}

/**
 * 配置中心「差异与冲突」：列出磁盘与 Panel 差异，导入预览后逐项解决冲突再提交。
 * 由 config-center.tsx 的 ConfigCenterPage 挂载；差异页已有流程保留。
 */
export function ConfigConflictsPanel({ onOpenSshFiles, onCommitted }: Props) {
  const overview = useQuery({
    queryKey: ["config-overview"],
    queryFn: () => api.getPanelConfigOverview(),
  });

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [preview, setPreview] = useState<main.PanelConfigPreview | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewFilePath, setPreviewFilePath] = useState("");
  const [choices, setChoices] = useState<Record<string, Choice>>({});
  const [manualTexts, setManualTexts] = useState<Record<string, string>>({});

  const diff = overview.data?.diff;

  const previewFile = useMemo(() => {
    if (!preview?.fileDiff?.length) return null;
    return (
      preview.fileDiff.find((file) => file.path === previewFilePath) ||
      preview.fileDiff[0] ||
      null
    );
  }, [preview, previewFilePath]);

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

  async function refreshAll() {
    setError("");
    await overview.refetch();
  }

  async function showPreview(value: main.PanelConfigPreview) {
    setPreview(value);
    setPreviewFilePath(value.fileDiff?.[0]?.path || "");
    setPreviewOpen(true);
  }

  async function previewExternalImport() {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const tree = await api.getPanelConfigTree();
      const files = tree
        .filter((file) => !file.panelJson)
        .map((file) => ({
          path: file.path,
          content: file.content,
          mode: file.mode,
          sha256: file.sha256,
        }));
      const next = await api.previewConfigDraft({ files });
      await showPreview(next);
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
      await showPreview(next);
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
      setMessage("已备份并提交 Panel JSON 与 SSH 配置。");
      await refreshAll();
      await onCommitted?.();
    } catch (err) {
      setError(formatErr(err));
      await refreshAll();
    } finally {
      setBusy(false);
    }
  }

  async function generateConfig() {
    setBusy(true);
    setError("");
    try {
      await api.generatePanelConfig();
      setMessage("已生成 SSH 配置");
      await refreshAll();
    } catch (err) {
      setError(formatErr(err));
    } finally {
      setBusy(false);
    }
  }

  const hasDiffList =
    (diff?.changedFiles || []).length > 0 || (diff?.hostDiff || []).length > 0;

  return (
    <div className="flex flex-col gap-4">
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

      <Card>
        <h2 className="text-lg font-medium">差异与冲突</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          {overview.data?.drift || overview.data?.needsReview ? (
            <Button disabled={busy} onClick={() => void previewExternalImport()}>
              预览外部导入
            </Button>
          ) : (
            <Button disabled={busy} onClick={() => void previewExternalImport()}>
              导入差异
            </Button>
          )}
          <Button
            variant="primary"
            disabled={busy || !preview?.valid}
            onClick={() => {
              if (preview?.valid) {
                setPreviewOpen(true);
              }
            }}
          >
            提交预览
          </Button>
          <Button disabled={busy} onClick={() => void generateConfig()}>
            生成配置
          </Button>
          <Button disabled={busy || overview.isFetching} onClick={() => void refreshAll()}>
            重新扫描
          </Button>
        </div>
      </Card>

      {hasDiffList ? (
        <div className="flex flex-col gap-3">
          {(diff?.changedFiles || []).map((file) => (
            <Card key={file.path}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <span
                    className={`rounded-control border px-2 py-0.5 text-[10px] font-semibold ${kindClass(file.kind)}`}
                  >
                    {diffKindLabel(file.kind)}
                  </span>
                  <strong className="truncate font-mono text-sm">{file.path}</strong>
                </div>
                {onOpenSshFiles ? (
                  <Button size="sm" variant="ghost" onClick={() => onOpenSshFiles()}>
                    打开文件
                  </Button>
                ) : null}
              </div>
              <div className="mt-2 grid gap-2 font-mono text-[11px] text-muted md:grid-cols-3">
                <div>Panel {shortHash(file.panelSha256)}</div>
                <div>磁盘 {shortHash(file.externalSha256)}</div>
                <div>生成 {shortHash(file.generatedSha256)}</div>
              </div>
              {file.panelContent || file.externalContent || file.generatedContent ? (
                <div className="mt-3 grid max-h-56 gap-2 overflow-auto md:grid-cols-3">
                  <DiffPane title="Panel 快照" text={file.panelContent || ""} />
                  <DiffPane title="当前磁盘" text={file.externalContent || ""} />
                  <DiffPane title="待生成结果" text={file.generatedContent || ""} />
                </div>
              ) : null}
            </Card>
          ))}
          {(diff?.hostDiff || []).map((host) => (
            <Card key={host.alias}>
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`rounded-control border px-2 py-0.5 text-[10px] font-semibold ${kindClass(host.kind)}`}
                >
                  {diffKindLabel(host.kind)}
                </span>
                <strong>{host.alias}</strong>
                <span className="text-sm text-muted">
                  {(host.fields || []).join(" · ") || "结构变化"}
                </span>
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <Card>
          <div className="py-10 text-center text-muted">
            <h3 className="text-base font-medium text-ink">配置树一致</h3>
            <p className="mt-1 text-sm">当前没有检测到磁盘与 Panel 快照之间的变化。</p>
          </div>
        </Card>
      )}

      {preview && !previewOpen ? (
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="font-medium">最近预览</div>
              <div className="text-sm text-muted">
                文件 {(preview.fileDiff || []).length} · 主机 {(preview.hostDiff || []).length} ·{" "}
                {(preview.conflicts || []).length} 冲突 ·{" "}
                {preview.valid ? "可提交" : "需处理冲突"}
              </div>
            </div>
            <Button size="sm" onClick={() => setPreviewOpen(true)}>
              打开预览
            </Button>
          </div>
        </Card>
      ) : null}

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
                                  const value = event.target.value as Choice;
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
                      <div className="flex min-h-[180px] min-w-0 flex-col overflow-hidden rounded-control border border-line">
                        <div className="border-b border-line bg-raised px-2 py-1.5 text-[10px] font-semibold text-muted">
                          Panel 快照
                        </div>
                        <div className="min-h-0 flex-1 overflow-hidden">
                          <CodeSurface
                            value={previewFile.panelContent || ""}
                            language="ssh"
                            readOnly
                          />
                        </div>
                      </div>
                      <div className="flex min-h-[180px] min-w-0 flex-col overflow-hidden rounded-control border border-line">
                        <div className="border-b border-line bg-raised px-2 py-1.5 text-[10px] font-semibold text-muted">
                          当前磁盘
                        </div>
                        <div className="min-h-0 flex-1 overflow-hidden">
                          <CodeSurface
                            value={previewFile.externalContent || ""}
                            language="ssh"
                            readOnly
                          />
                        </div>
                      </div>
                      <div className="flex min-h-[180px] min-w-0 flex-col overflow-hidden rounded-control border border-line">
                        <div className="border-b border-line bg-raised px-2 py-1.5 text-[10px] font-semibold text-muted">
                          待生成结果
                        </div>
                        <div className="min-h-0 flex-1 overflow-hidden">
                          <CodeSurface
                            value={previewFile.generatedContent || ""}
                            language="ssh"
                            readOnly
                          />
                        </div>
                      </div>
                    </div>
                  ) : null}
                  {(preview.hostDiff || []).map((host) => (
                    <div
                      key={host.alias}
                      className="mt-1 flex flex-wrap items-center gap-2 border-t border-line py-2 text-sm"
                    >
                      <span
                        className={`rounded-control border px-2 py-0.5 text-[10px] font-semibold ${kindClass(host.kind)}`}
                      >
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

          <div className="flex justify-end gap-2 border-t border-line px-5 py-3">
            <Button onClick={() => setPreviewOpen(false)}>取消</Button>
            <Button
              variant="primary"
              disabled={busy || !preview?.valid}
              onClick={() => void commitPreview()}
            >
              确认备份并提交
            </Button>
          </div>
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
