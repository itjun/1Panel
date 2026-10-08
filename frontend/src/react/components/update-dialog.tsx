import { Events } from "@wailsio/runtime";
import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "@/api";
import { Notice } from "@/react/components/page";
import { Button } from "@/react/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@/react/components/ui/dialog";
import { closeUpdateDialog, initializeAppUpdate, useAppUpdate } from "@/react/state/app-update";
import { formatBytes, formatErr } from "@/utils/format";

/*
  应用更新弹窗：
  - 可选更新：立即更新 / 稍后提醒（24 小时）/ 跳过此版本；可关闭。
  - 强制更新：当前版本低于最低支持版本时不可关闭，只能更新或退出应用。
  - 下载与安装进度在弹窗内以文字展示，完成后后端自动重启应用。
*/
export function UpdateDialog() {
  useEffect(() => initializeAppUpdate(), []);
  const { state, dialogOpen } = useAppUpdate();
  const [actionError, setActionError] = useState("");

  const forced = !!state?.hasUpdate && !!state.mandatory;
  const open = forced || (dialogOpen && !!state?.hasUpdate);

  useEffect(() => {
    if (!open) setActionError("");
  }, [open]);

  if (!state || !open) return null;

  const busy = state.status === "downloading" || state.status === "installing";
  const failed = state.status === "error";

  async function run(action: () => Promise<void>, close = false) {
    setActionError("");
    try {
      await action();
      if (close) closeUpdateDialog();
    } catch (e) {
      setActionError(formatErr(e));
    }
  }

  function dismiss() {
    if (forced) return;
    closeUpdateDialog();
  }

  const meta = [
    `当前版本 ${state.current || "—"}`,
    state.releasedAt ? `发布于 ${formatDate(state.releasedAt)}` : "",
    state.size > 0 ? `安装包 ${formatBytes(state.size)}` : "",
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) dismiss();
      }}
    >
      <DialogContent
        className="w-[min(520px,calc(100vw-32px))]"
        onEscapeKeyDown={(e) => {
          if (forced) e.preventDefault();
        }}
        onInteractOutside={(e) => {
          if (forced || busy) e.preventDefault();
        }}
      >
        <DialogTitle>
          {forced ? `需要更新到 ${state.latest}` : `发现新版本 ${state.latest}`}
        </DialogTitle>
        <DialogDescription className="mt-1 text-sm text-muted tabular-nums">{meta}</DialogDescription>

        {forced ? (
          <div className="mt-4">
            <Notice
              tone="warning"
              text={`当前版本已停止支持（最低支持 ${state.minSupported}），更新后才能继续使用。`}
            />
          </div>
        ) : null}

        <div className="mt-4 max-h-60 overflow-auto rounded-control bg-raised px-3 py-2 text-sm leading-6 break-words whitespace-pre-wrap text-ink">
          {state.notes?.trim() || "本次更新未附说明。"}
        </div>

        {busy ? (
          <div className="mt-4 flex items-center gap-2 text-sm text-ink tabular-nums">
            <Loader2 aria-hidden className="size-4 shrink-0 animate-spin text-muted" strokeWidth={1.5} />
            {state.status === "installing" ? (
              <span>正在安装，完成后自动重启…</span>
            ) : (
              <span>{progressText(state.downloaded, state.total)}</span>
            )}
          </div>
        ) : null}

        {failed || actionError ? (
          <div className="mt-4">
            <Notice tone="error" text={`更新失败：${actionError || state.error}`} />
          </div>
        ) : null}

        <DialogFooter>
          {busy ? (
            <Button
              disabled={state.status === "installing"}
              onClick={() => void run(() => api.cancelUpdate())}
            >
              取消下载
            </Button>
          ) : forced ? (
            <>
              <Button onClick={() => void Events.Emit("app-quit-for-real")}>退出应用</Button>
              <Button variant="primary" autoFocus onClick={() => void run(() => api.startUpdate())}>
                {failed ? "重试" : "立即更新"}
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="ghost"
                onClick={() => void run(() => api.skipUpdateVersion(state.latest), true)}
              >
                跳过此版本
              </Button>
              <Button onClick={() => void run(() => api.remindUpdateLater(), true)}>稍后提醒</Button>
              <Button variant="primary" autoFocus onClick={() => void run(() => api.startUpdate())}>
                {failed ? "重试" : "立即更新"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function progressText(done: number, total: number): string {
  if (total > 0) {
    const pct = Math.min(100, Math.floor((done / total) * 100));
    return `正在下载 ${pct}% · ${formatBytes(done)} / ${formatBytes(total)}`;
  }
  return `正在下载 ${formatBytes(done)}`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
