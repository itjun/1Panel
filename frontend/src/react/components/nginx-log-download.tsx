import { Events, type CancellablePromise } from "@wailsio/runtime";
import { Download, LoaderCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { api } from "@/api";
import { Button } from "@/react/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/react/components/ui/dialog";
import { FlashNotices, Notice } from "@/react/components/page";
import { useFlashMessage } from "@/react/lib/use-flash-message";
import { formatErr } from "@/utils/format";

type Progress = {
  phase: string;
  done: number;
  total: number;
  files: number;
  skipped: number;
  available: number;
  required: number;
  reserve: number;
};
type ExportEvent = { host: string; requestID: string; progress: Progress };

function bytes(value: number): string {
  return value >= 1024 ** 3
    ? `${(value / 1024 ** 3).toFixed(2)} GiB`
    : `${(value / 1024 ** 2).toFixed(1)} MiB`;
}

export function NginxLogDownload({ host }: { host: string }) {
  const [open, setOpen] = useState(false);
  const [logDir, setLogDir] = useState("/var/log/nginx");
  const [temporaryDir, setTemporaryDir] = useState("/var/tmp");
  const [busy, setBusy] = useState(false);
  const [cancelRequested, setCancelRequested] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [checked, setChecked] = useState<Progress | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const flash = useFlashMessage();
  const dialog = useRef<HTMLDivElement>(null);
  const task = useRef<CancellablePromise<string> | null>(null);
  const requestID = useRef("");
  const cancelling = useRef(false);

  useEffect(() => {
    const off = Events.On("nginx-log-progress", (event: { data?: ExportEvent }) => {
      const data = event.data;
      if (data?.host !== host || data.requestID !== requestID.current) return;
      setProgress(data.progress);
      if (data.progress.phase === "checked") setChecked(data.progress);
    });
    return () => {
      off();
      requestID.current = "";
      task.current?.cancel();
      task.current = null;
    };
  }, [host]);

  function showDialog() {
    if (requestID.current) return;
    flushSync(() => {
      setOpen(true);
      setMessage(null);
      setProgress(null);
      setChecked(null);
      flash.clear();
    });
  }

  async function start() {
    // 先同步占住这次请求，再绘制界面或打开系统保存窗口。
    if (requestID.current) return;
    const id = crypto.randomUUID();
    requestID.current = id;
    cancelling.current = false;
    flushSync(() => {
      setBusy(true);
      setCancelRequested(false);
      setMessage(null);
      setProgress(null);
      setChecked(null);
      flash.clear();
    });
    dialog.current?.scrollTo({ top: 0 });
    dialog.current?.focus({ preventScroll: true });
    try {
      // 先让忙碌蒙层画出来，再打开可能卡住 webview 的系统窗口。
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      if (requestID.current !== id) return;
      if (cancelling.current) {
        setMessage("下载已取消。");
        return;
      }
      const pending = api.pickAndDownloadNginxLogs(host, logDir.trim(), temporaryDir.trim(), id);
      task.current = pending;
      const path = await pending;
      if (requestID.current === id && path) {
        setOpen(false);
        flash.showToast(`日志已保存：${path}`);
      }
    } catch (error) {
      if (requestID.current === id) {
        setMessage(cancelling.current ? "下载已取消，正在清理临时文件。" : formatErr(error));
      }
    } finally {
      if (requestID.current === id) {
        task.current = null;
        requestID.current = "";
        setBusy(false);
      }
    }
  }

  function cancel() {
    if (!requestID.current || cancelling.current) return;
    cancelling.current = true;
    flushSync(() => setCancelRequested(true));
    task.current?.cancel();
  }

  const phase = progress?.phase;
  let status = "选择保存位置并连接主机…";
  if (phase === "compressing") {
    status = "正在压缩日志…";
  } else if (phase === "downloading") {
    status = "正在下载压缩包…";
  } else if (phase === "complete") {
    status = "正在校验并保存…";
  } else if (phase === "checked") {
    status = "空间检查通过，开始压缩…";
  } else if (phase === "checking") {
    status = "正在检查日志与磁盘空间…";
  }
  const percent = progress?.total ? Math.min(100, progress.done / progress.total * 100) : 0;

  return (
    <>
      <FlashNotices flash={flash} />
      <Button size="sm" disabled={open || busy} aria-haspopup="dialog" aria-expanded={open} onClick={showDialog}>
        <Download className="size-4" />下载日志
      </Button>
      <Dialog open={open} onOpenChange={(value) => { if (!requestID.current) setOpen(value); }}>
        <DialogContent ref={dialog} className={`w-[min(560px,calc(100vw-32px))] ${busy ? "overflow-hidden" : ""}`} aria-busy={busy}
          onEscapeKeyDown={(event) => { if (requestID.current) event.preventDefault(); }}
          onPointerDownOutside={(event) => { if (requestID.current) event.preventDefault(); }}>
          <DialogTitle>下载 Nginx 日志</DialogTitle>
          <DialogDescription>
            直接将目录中的 access.log 和 error.log 打包为一个 .tar.zst 文件后下载，不筛选日期，不包含轮转日志或备份文件。
          </DialogDescription>
          <div inert={busy} aria-hidden={busy || undefined}>
            <div className="mt-4 flex flex-col gap-4 text-sm">
              <label className="flex flex-col gap-2">
                <span>远程日志目录</span>
                <input className="motion-field h-9 w-full rounded-control px-3 font-mono text-sm text-ink disabled:text-muted" value={logDir} disabled={busy} onChange={(event) => { setLogDir(event.target.value); setChecked(null); setMessage(null); }} />
              </label>
              <label className="flex flex-col gap-2">
                <span>远程压缩临时目录</span>
                <input className="motion-field h-9 w-full rounded-control px-3 font-mono text-sm text-ink disabled:text-muted" value={temporaryDir} disabled={busy} onChange={(event) => { setTemporaryDir(event.target.value); setChecked(null); setMessage(null); }} />
              </label>
              <p className="text-muted">
                压缩前检查磁盘空间，并预留至少 1 GiB 或容量的 10%。只读取开始时已有的内容，不修改日志、不重启或重载 Nginx。完成或取消后自动清理临时包。
              </p>
              <p className="text-xs text-muted">保留文件内的全部记录，包括历史日期和无时间戳内容。使用 zstd 默认参数压缩；缺失的文件会跳过，符号链接及设备文件不导出。</p>
              {checked ? (
                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 tabular-nums">
                  <dt className="text-muted">日志原始大小</dt><dd>{bytes(checked.total)} · {checked.files} 个文件</dd>
                  <dt className="text-muted">磁盘可用</dt><dd>{bytes(checked.available)}</dd>
                  <dt className="text-muted">压缩空间预算</dt><dd>{bytes(checked.required)}</dd>
                  <dt className="text-muted">安全预留</dt><dd>{bytes(checked.reserve)}</dd>
                  {checked.skipped > 0 ? <><dt className="text-muted">已跳过文件</dt><dd>{checked.skipped} 个目标文件缺失或不是普通文件</dd></> : null}
                </dl>
              ) : null}
              {message ? <Notice tone={cancelling.current ? "info" : "error"} text={message} /> : null}
            </div>
            <DialogFooter>
              <Button disabled={busy} onClick={() => setOpen(false)}>关闭</Button>
              <Button variant="primary" onClick={() => void start()} disabled={busy || !logDir.trim().startsWith("/") || !temporaryDir.trim().startsWith("/")}>压缩并下载</Button>
            </DialogFooter>
          </div>
          {busy ? (
            <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-6 rounded-panel bg-surface/95 px-8 py-6">
              <div role="status" aria-live="polite" className="flex w-full flex-col gap-3 text-sm">
                <div className="flex items-center justify-center gap-2"><LoaderCircle className="size-4 animate-spin text-accent" />{cancelRequested ? "正在取消下载…" : status}</div>
                {checked ? (
                  <>
                    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 tabular-nums">
                      <dt className="text-muted">打包文件</dt><dd className="text-right">access.log、error.log</dd>
                      <dt className="text-muted">日志原始大小</dt><dd className="text-right">{bytes(checked.total)} · {checked.files} 个文件</dd>
                    </dl>
                    {checked.skipped > 0 ? <p className="text-center text-xs text-muted">{checked.skipped} 个目标文件缺失或不是普通文件，仅打包可读取的文件。</p> : null}
                  </>
                ) : null}
                {phase === "compressing" || phase === "downloading" ? (
                  <>
                    <div className="h-2 w-full overflow-hidden rounded-control bg-raised" role="progressbar" aria-label={phase === "compressing" ? "压缩进度" : "下载进度"} aria-valuenow={Math.round(percent)} aria-valuemin={0} aria-valuemax={100}>
                      <div className="h-full bg-accent" style={{ width: `${percent}%` }} />
                    </div>
                    <span className="text-center text-xs text-muted tabular-nums">
                      {phase === "compressing" ? "已压缩" : "已下载"} {bytes(progress?.done || 0)} / {bytes(progress?.total || 0)} · {percent.toFixed(0)}%
                    </span>
                  </>
                ) : null}
              </div>
              <Button disabled={cancelRequested} onClick={cancel}>{cancelRequested ? "正在取消…" : "取消下载"}</Button>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
