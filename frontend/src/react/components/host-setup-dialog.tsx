import { useQuery, useQueryClient } from "@tanstack/react-query";
import { LoaderCircle } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { api } from "@/api";
import { FlashNotices, Notice } from "@/react/components/page";
import { Button } from "@/react/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogTitle,
} from "@/react/components/ui/dialog";
import { useFlashMessage } from "@/react/lib/use-flash-message";
import { copyText } from "@/utils/clipboard";
import { formatErr } from "@/utils/format";

let target: string | null = null;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** Right-click actions retain their target without changing the active workspace. */
export function openHostSetup(host: string) {
  target = host;
  listeners.forEach((listener) => listener());
}

function closeHostSetup() {
  target = null;
  listeners.forEach((listener) => listener());
}

export function HostSetupDialogHost() {
  const host = useSyncExternalStore(subscribe, () => target);
  return host ? <HostSetupDialog key={host} host={host} /> : null;
}

function HostSetupDialog({ host }: { host: string }) {
  const client = useQueryClient();
  const flash = useFlashMessage();
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState("");
  const logRef = useRef<HTMLPreElement>(null);
  const follow = useRef(true);
  const observedRun = useRef(0);
  const environment = useQuery({
    queryKey: ["zsh-environment", host],
    queryFn: () => api.inspectZsh(host),
    retry: false,
    refetchOnMount: "always",
  });
  const task = useQuery({
    queryKey: ["zsh-setup", host],
    queryFn: () => api.getZshSetup(host),
    retry: false,
    refetchOnMount: "always",
    refetchInterval: (query) =>
      query.state.data?.state === "running" ? 1000 : false,
  });
  const env = environment.data;
  const job = task.data;
  const running = job?.state === "running";
  const busy = starting || running;
  const logs = job?.logs ?? [];
  const restoreCommand =
    logs.find((line) => line.startsWith("[恢复命令] "))?.slice(7) ??
    env?.restoreCommand ??
    "";
  const issue =
    startError ||
    (environment.error ? formatErr(environment.error) : "") ||
    (task.error ? `读取任务失败：${formatErr(task.error)}` : "") ||
    (env && !env.supported
      ? "仅支持使用 apt、dnf、yum、apk 的远程 Linux 主机。"
      : "") ||
    (env && !env.privileged
      ? "安装软件和设置登录 Shell 需要 root 或免密 sudo。"
      : "") ||
    (job?.state === "error" ? job.error : "");
  const ready =
    !!env?.supported &&
    env.privileged &&
    !environment.isFetching &&
    !environment.isError &&
    !task.isPending &&
    !task.isFetching &&
    !task.isError;

  useEffect(() => {
    if (!job?.startedAt || running || observedRun.current === job.startedAt)
      return;
    observedRun.current = job.startedAt;
    void client.invalidateQueries({ queryKey: ["zsh-environment", host] });
  }, [client, host, job?.startedAt, running]);

  useEffect(() => {
    if (follow.current && logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [logs.length]);

  async function start() {
    if (busy || !ready) return;
    setStarting(true);
    setStartError("");
    follow.current = true;
    try {
      const next = await api.startHostSetup(host);
      client.setQueryData(["zsh-setup", host], next);
    } catch (error) {
      setStartError(formatErr(error));
    } finally {
      setStarting(false);
    }
  }

  async function copy(value: string, message: string) {
    try {
      await copyText(value);
      flash.showToast(message);
    } catch (error) {
      flash.showError(`复制失败：${formatErr(error)}`);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) closeHostSetup();
      }}
    >
      <DialogContent aria-describedby={undefined} className="w-[min(600px,calc(100vw-32px))]">
        <FlashNotices flash={flash} />
        <DialogTitle>初始化主机 · {host}</DialogTitle>
        <div className="mt-4 space-y-4 text-sm">
          <div className="text-xs text-muted" aria-live="polite">
            {env
              ? `${env.distribution} · ${env.user} · ${env.shell}`
              : "正在检测目标主机…"}
          </div>
          <dl className="grid grid-cols-[64px_1fr] gap-x-4 gap-y-2">
            <dt className="text-muted">基础软件</dt>
            <dd className="min-w-0 break-words">
              openssh-server、vim、curl、wget、sudo、tree、ca-certificates
              {env?.manager === "apt-get" ? "、htop、btop" : ""}
            </dd>
            <dt className="text-muted">Shell</dt>
            <dd>zsh、Git、完整 Oh My Zsh、ys 主题；设为当前用户的默认 Shell</dd>
            <dt className="text-muted">增强功能</dt>
            <dd>命令高亮、历史建议；拼写纠错默认关闭</dd>
          </dl>
          {issue ? <Notice tone="error" text={issue} /> : null}
          {job?.state === "success" && !busy && !issue ? (
            <Notice
              tone="success"
              text={
                job.options.basePackages
                  ? "主机初始化完成，全部功能已通过加载验证。"
                  : "上次 Shell 配置已完成；可执行完整主机初始化。"
              }
            />
          ) : null}
          {busy || logs.length > 0 ? (
            <div>
              <div className="mb-2 flex items-center justify-between gap-4 text-xs">
                <span className="flex items-center gap-2" role="status">
                  {busy ? (
                    <LoaderCircle
                      className="size-3.5 animate-spin"
                      aria-hidden
                    />
                  ) : null}
                  {busy ? "正在初始化" : "执行日志"}
                </span>
                <Button
                  size="sm"
                  disabled={logs.length === 0}
                  onClick={() => void copy(logs.join("\n"), "日志已复制")}
                >
                  复制日志
                </Button>
              </div>
              <pre
                ref={logRef}
                tabIndex={0}
                aria-label={`${host} 初始化日志`}
                onScroll={(event) => {
                  const el = event.currentTarget;
                  follow.current =
                    el.scrollHeight - el.scrollTop - el.clientHeight < 32;
                }}
                className="max-h-56 min-h-24 overflow-auto whitespace-pre-wrap break-all rounded-control bg-graphite p-4 font-mono text-xs leading-5 text-graphite-text"
              >
                {logs.length ? logs.join("\n") : "正在连接目标主机…"}
              </pre>
            </div>
          ) : null}
        </div>
        <DialogFooter className="flex-wrap">
          {restoreCommand ? (
            <Button
              disabled={busy}
              onClick={() =>
                void copy(
                  restoreCommand,
                  "恢复命令已复制，请在目标主机终端执行",
                )
              }
            >
              复制恢复命令
            </Button>
          ) : null}
          {issue && !busy ? (
            <Button
              onClick={() => {
                setStartError("");
                void environment.refetch();
                void task.refetch();
              }}
            >
              重新检测
            </Button>
          ) : null}
          <Button onClick={closeHostSetup}>{busy ? "后台继续" : "关闭"}</Button>
          <Button
            variant="primary"
            disabled={busy || !ready}
            onClick={() => void start()}
          >
            {busy
              ? "执行中"
              : job?.options.basePackages && job.state === "success"
                ? "重新执行"
                : "开始初始化"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
