import { Events, type CancellablePromise } from "@wailsio/runtime";
import { Download, LoaderCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api } from "@/api";
import { Button } from "@/react/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/react/components/ui/dialog";
import { Notice } from "@/react/components/page";
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
  date?: string;
  unmatched?: number;
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
  const [progress, setProgress] = useState<Progress | null>(null);
  const [checked, setChecked] = useState<Progress | null>(null);
  const [message, setMessage] = useState<{ text: string; success: boolean } | null>(null);
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
    };
  }, [host]);

  async function start() {
    if (task.current) return;
    const id = crypto.randomUUID();
    requestID.current = id;
    cancelling.current = false;
    setBusy(true);
    setMessage(null);
    setProgress(null);
    setChecked(null);
    try {
      const pending = api.pickAndDownloadNginxLogs(host, logDir.trim(), temporaryDir.trim(), id);
      task.current = pending;
      const path = await pending;
      if (requestID.current === id) {
        setMessage(path ? { text: `已保存：${path}`, success: true } : null);
      }
    } catch (error) {
      if (requestID.current === id) {
        setMessage({ text: cancelling.current ? "下载已取消，正在清理临时文件。" : formatErr(error), success: false });
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
    cancelling.current = true;
    task.current?.cancel();
  }

  const phase = progress?.phase;
  const status = phase === "filtering" ? `正在筛选 ${progress?.date || "当日"} 的日志…`
    : phase === "compressing" ? "正在低负载压缩…"
    : phase === "downloading" ? "正在下载压缩包…"
    : phase === "complete" ? "正在校验并保存…"
    : phase === "checked" ? "空间检查通过，开始压缩…"
    : phase === "checking" ? "正在检查日志与磁盘空间…"
    : "选择保存位置并连接主机…";
  const percent = progress?.total ? Math.min(100, progress.done / progress.total * 100) : 0;

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <Download className="size-4" />下载日志
      </Button>
      <Dialog open={open} onOpenChange={(value) => { if (!busy) setOpen(value); }}>
        <DialogContent className="w-[min(560px,calc(100vw-32px))]">
          <DialogTitle>下载 Nginx 日志</DialogTitle>
          <DialogDescription>
            默认按远程主机的当天日期筛选日志记录，以 zstd 6 级单线程压缩为 .tar.zst 后下载。历史压缩包不包含在内。
          </DialogDescription>
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
              压缩前检查磁盘和内存。磁盘预留至少 1 GiB 或容量的 10%；内存按 256 MiB 任务预算检查，并预留至少 512 MiB 或总内存的 10%。以低优先级、2 MiB/s 限速处理，只读取开始时已有的内容；不修改日志、不重启或重载 Nginx。完成或取消后自动清理临时包。
            </p>
            <p className="text-xs text-muted">支持 Nginx 标准访问／错误日志时间及 ISO 8601 时间；无法识别日期的行会跳过。需要 Python 3、zstd、nice、ionice、stat 和日志读取权限，符号链接及设备文件不导出。</p>
            {checked ? (
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 tabular-nums">
                <dt className="text-muted">日志日期</dt><dd>{checked.date}（主机时间）</dd>
                <dt className="text-muted">当日日志</dt><dd>{checked.files} 个文件 · {bytes(checked.total)}</dd>
                <dt className="text-muted">磁盘可用</dt><dd>{bytes(checked.available)}</dd>
                <dt className="text-muted">压缩空间预算</dt><dd>{bytes(checked.required)}</dd>
                <dt className="text-muted">安全预留</dt><dd>{bytes(checked.reserve)}</dd>
                {checked.skipped > 0 ? <><dt className="text-muted">已跳过文件</dt><dd>{checked.skipped} 个历史压缩包、无当日记录或特殊文件</dd></> : null}
                {checked.unmatched ? <><dt className="text-muted">未识别日期</dt><dd>{checked.unmatched} 行，未纳入下载</dd></> : null}
              </dl>
            ) : null}
            {busy ? (
              <div role="status" aria-live="polite" className="flex flex-col gap-2">
                <div className="flex items-center gap-2"><LoaderCircle className="size-4 animate-spin text-accent" />{status}</div>
                {phase === "filtering" || phase === "compressing" || phase === "downloading" ? (
                  <>
                    <div className="h-2 w-full overflow-hidden rounded-control bg-raised" role="progressbar" aria-label={phase === "filtering" ? "筛选进度" : phase === "compressing" ? "压缩进度" : "下载进度"} aria-valuenow={Math.round(percent)} aria-valuemin={0} aria-valuemax={100}>
                      <div className="h-full bg-accent" style={{ width: `${percent}%` }} />
                    </div>
                    <span className="text-xs text-muted tabular-nums">{bytes(progress?.done || 0)} / {bytes(progress?.total || 0)} · {percent.toFixed(0)}%</span>
                  </>
                ) : null}
              </div>
            ) : null}
            {message ? <Notice tone={message.success ? "success" : cancelling.current ? "info" : "error"} text={message.text} /> : null}
          </div>
          <DialogFooter>
            {busy ? <Button onClick={cancel}>取消下载</Button> : <>
              <Button onClick={() => setOpen(false)}>关闭</Button>
              <Button variant="primary" onClick={() => void start()} disabled={!logDir.trim().startsWith("/") || !temporaryDir.trim().startsWith("/")}>压缩并下载</Button>
            </>}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
