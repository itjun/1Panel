import { useEffect, useMemo, useRef, useState } from "react";
import { api, type filetext } from "@/api";
import { HighlightPane } from "@/react/components/local/highlight-pane";
import { Button } from "@/react/components/ui/button";
import { MOTION_MS, usePresence } from "@/react/lib/motion";
import { highlightFileHtml } from "@/utils/codeHighlight";
import { formatErr, splitTextLines } from "@/utils/format";

type OpenTarget = { path: string; name: string };

type Props = {
  host: string;
  target: OpenTarget | null;
  /** local：本机文件；默认读远程主机 */
  source?: "remote" | "local";
  onClose: () => void;
};

export function FilePreviewDrawer({ host, target, source = "remote", onClose }: Props) {
  const [preview, setPreview] = useState<filetext.Preview | null>(null);
  const [loading, setLoading] = useState(false);
  const [converting, setConverting] = useState(false);
  const [confirmNormalize, setConfirmNormalize] = useState(false);
  const [error, setError] = useState("");

  const open = !!target;
  const lastTargetRef = useRef(target);
  if (target) lastTargetRef.current = target;
  const displayTarget = target ?? lastTargetRef.current;
  const { mounted, visible } = usePresence(open, MOTION_MS.slow);
  const path = displayTarget?.path || "";
  const needsNormalize = !!preview?.needsNormalize && !!path;
  const lineCount = preview ? splitTextLines(preview.content ?? "").length : 0;
  const html = useMemo(
    () => highlightFileHtml(preview?.content || "", path || preview?.name || ""),
    [preview?.content, preview?.name, path],
  );

  useEffect(() => {
    if (!target) {
      setPreview(null);
      setError("");
      setConfirmNormalize(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError("");
    setConfirmNormalize(false);
    setPreview({
      path: target.path,
      name: target.name,
      content: "",
      encoding: "—",
      lineEnding: "—",
      needsNormalize: false,
      size: 0,
    });
    const read =
      source === "local"
        ? api.readLocalFilePreview(target.path)
        : api.readFilePreview(host, target.path);
    void read
      .then((result) => {
        if (cancelled) return;
        setPreview(result);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(formatErr(err));
        setPreview({
          path: target.path,
          name: target.name,
          content: `读取失败: ${formatErr(err)}`,
          encoding: "—",
          lineEnding: "—",
          needsNormalize: false,
          size: 0,
        });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [host, source, target]);

  async function normalizeToLinux() {
    if (!path || converting) return;
    if (!confirmNormalize) {
      setConfirmNormalize(true);
      return;
    }
    setConverting(true);
    setError("");
    try {
      const result =
        source === "local"
          ? await api.normalizeLocalFileToLinux(path)
          : await api.normalizeFileToLinux(host, path);
      setPreview(result);
      setConfirmNormalize(false);
    } catch (err) {
      setError(`转换失败: ${formatErr(err)}`);
    } finally {
      setConverting(false);
    }
  }

  if (!mounted) return null;

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <button
        type="button"
        className="motion-overlay absolute inset-0 bg-scrim"
        data-open={visible ? "true" : "false"}
        aria-label="关闭预览"
        onClick={onClose}
      />
      <aside
        className="motion-drawer-panel relative z-10 flex h-full w-1/2 min-w-[320px] flex-col border-l border-line bg-surface"
        data-open={visible ? "true" : "false"}
      >
        <div className="flex h-12 shrink-0 items-center gap-2 border-b border-line px-4">
          <h2 className="min-w-0 flex-1 truncate text-sm font-semibold text-ink">
            {preview?.name || displayTarget?.name || "预览"}
          </h2>
          <Button size="sm" onClick={onClose}>
            关闭
          </Button>
        </div>
        <div className="flex min-h-0 flex-1 flex-col p-3">
          {needsNormalize ? (
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2 rounded-surface bg-warn-soft px-3 py-2 text-sm text-warn">
              <span>
                当前不是 Linux 标准格式（期望 UTF-8 + LF）：编码{" "}
                <strong>{preview?.encoding || "—"}</strong>，换行{" "}
                <strong>{preview?.lineEnding || "—"}</strong>。
                {confirmNormalize ? " 写前会备份为「原文件名.bak.时间戳」。确认转换？" : ""}
              </span>
              <div className="flex gap-2">
                {confirmNormalize ? (
                  <Button
                    size="sm"
                    onClick={() => {
                      setConfirmNormalize(false);
                    }}
                  >
                    取消
                  </Button>
                ) : null}
                <Button
                  size="sm"
                  variant="primary"
                  disabled={converting}
                  onClick={() => void normalizeToLinux()}
                >
                  {converting
                    ? "转换中…"
                    : confirmNormalize
                      ? "转换并保存"
                      : "转换为 UTF-8 / LF"}
                </Button>
              </div>
            </div>
          ) : null}
          {error ? <p className="mb-2 text-sm text-danger">{error}</p> : null}
          <div className="min-h-0 flex-1 overflow-hidden bg-graphite">
            {loading ? (
              <pre className="p-4 font-mono text-sm text-graphite-text">加载中…</pre>
            ) : (
              <HighlightPane html={html} text={preview?.content || ""} />
            )}
          </div>
          <div className="mt-2 flex shrink-0 items-center justify-between gap-4 text-xs text-muted">
            <span>{preview ? `${lineCount} 行` : ""}</span>
            <span className="inline-flex items-center gap-2 tabular-nums">
              <span className={needsNormalize ? "font-semibold text-danger" : "text-ink"}>
                {preview?.encoding || "—"}
              </span>
              <span>|</span>
              <span className={needsNormalize ? "font-semibold text-danger" : "text-ink"}>
                {preview?.lineEnding || "—"}
              </span>
            </span>
          </div>
        </div>
      </aside>
    </div>
  );
}
