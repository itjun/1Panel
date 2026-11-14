import { Notice } from "@/react/components/page";
import { Button } from "@/react/components/ui/button";
import { hostConnectionError } from "@/react/lib/host-connection-error";
import { formatErr } from "@/utils/format";

export function HostConnectionFailure({ error, target, onCheck, onRetry, isRetrying }: {
  error: unknown;
  target: string;
  onCheck: () => void;
  onRetry: () => void;
  isRetrying: boolean;
}) {
  const failure = hostConnectionError(error);
  return (
    <section className="flex flex-col gap-3" aria-label="连接诊断" role="alert">
      <Notice text={`${failure.title}（${target}）`} />
      <p className="text-sm leading-6 text-ink">{failure.hint}</p>
      <div className="flex flex-wrap items-center gap-3">
        <Button disabled={isRetrying} onClick={onRetry}>{isRetrying ? "重试中…" : "重试连接"}</Button>
        <Button onClick={onCheck}>检查 Agent</Button>
      </div>
      <details className="text-sm text-muted">
        <summary className="cursor-pointer">技术详情</summary>
        <pre className="mt-2 whitespace-pre-wrap break-words font-mono text-xs leading-5">{formatErr(error)}</pre>
      </details>
    </section>
  );
}
