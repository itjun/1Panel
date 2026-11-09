import type { ReactNode } from "react";
import { ArrowLeft, ArrowRight, Circle, Laptop, LoaderCircle, Server } from "lucide-react";
import { endpointLabel, LOCAL_ID } from "./format";
import "./transfer-path.css";

export function TransferPath({ a, b, direction, phase, elapsed = 0, duration, status, action }: {
  a: string;
  b: string;
  direction: string;
  phase?: string;
  elapsed?: number;
  duration: number;
  status?: string;
  action?: ReactNode;
}) {
  const isRunning = phase === "running";
  const isPreparing = !!phase && ["prepare", "provision", "probe"].includes(phase);
  const progress = phase === "done" ? 100 : Math.min(99, Math.max(0, elapsed / Math.max(1, duration) * 100));
  const directions = direction === "bidir" ? ["forward", "reverse"] : ["forward", "reverse"].includes(direction) ? [direction] : [];
  return <div className="transfer-path" aria-label="测速方向" data-phase={phase || "idle"}>
    <div className="transfer-path-diagram">
      {[a, b].map((id, index) => {
        const Icon = id === LOCAL_ID ? Laptop : Server;
        return <div key={index} className={`transfer-path-endpoint transfer-path-endpoint-${index}`}>
          <Icon aria-hidden className="size-10 text-muted" strokeWidth={1.5} />
          <span className="max-w-full break-words text-center text-sm">{index === 0 ? "A" : "B"} {id ? endpointLabel(id) : isRunning ? "待恢复" : "待选择"}</span>
        </div>;
      })}
      <div className="transfer-path-lanes">
        {!directions.length ? <p className="text-center text-xs text-muted">正在恢复测速信息</p> : null}
        {directions.map((value) => {
          const isReverse = value === "reverse";
          const Arrow = isReverse ? ArrowLeft : ArrowRight;
          return <div key={value} className="transfer-path-lane" data-direction={value} data-running={isRunning} data-ready={!!a && !!b}>
            <span className="text-xs font-medium">{isReverse ? "B → A" : "A → B"}{status ? `　${status}` : ""}</span>
            <div className="transfer-path-track" aria-hidden>
              <Arrow className="transfer-path-arrow size-5" />
              {isRunning ? <Circle className="transfer-path-packet size-3" fill="currentColor" /> : null}
            </div>
          </div>;
        })}
      </div>
    </div>
    {phase ? <div className="flex flex-wrap items-center gap-3 text-xs text-muted" role="status">
      {isRunning || isPreparing ? <LoaderCircle aria-hidden className="size-4 animate-spin text-accent motion-reduce:animate-none" /> : null}
      <span>{status}</span>
      {duration > 0 && (isRunning || phase === "done") ? <>
        <span className="font-mono tabular-nums">已用 {Math.min(elapsed, duration).toFixed(0)} / {duration} 秒</span>
        <progress className="transfer-path-progress" aria-label="测速进度" max={100} value={progress} />
      </> : null}
      {action ? <span className="ml-auto">{action}</span> : null}
    </div> : !b ? <p className="text-center text-xs text-muted">选择 B 端后识别路径</p> : null}
  </div>;
}
