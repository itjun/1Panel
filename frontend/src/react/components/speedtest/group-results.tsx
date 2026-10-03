import type { ReactNode } from "react";
import type { speedtest } from "@/api";
import { Tag } from "@/react/components/ui/tag";
import { cn } from "@/react/lib/utils";
import { RELATION_LABEL, formatBps, formatMs } from "./format";
import { LiveChart, StatStrip } from "./live-chart";

const PAIR_STATUS: Record<string, { label: string; tone: "neutral" | "ok" | "warn" | "danger" | "accent" }> = {
  pending: { label: "等待", tone: "neutral" },
  probe: { label: "探测", tone: "accent" },
  running: { label: "测速中", tone: "accent" },
  done: { label: "完成", tone: "ok" },
  failed: { label: "失败", tone: "danger" },
  stopped: { label: "已停止", tone: "neutral" },
  nolan: { label: "内网不通", tone: "warn" },
};

export function PairStatusTag({ status }: { status: string }) {
  const s = PAIR_STATUS[status] || { label: status, tone: "neutral" as const };
  return <Tag tone={s.tone}>{s.label}</Tag>;
}

function pathText(p?: speedtest.Candidate | null) {
  if (!p) return "—";
  return `${RELATION_LABEL[p.relation] || p.relation} ${p.target.ip}`;
}

/** 星型：中心机与每台主机一行，双向吞吐 */
export function StarTable({
  pairs,
  protocol,
  activeIndex,
  onPick,
}: {
  pairs: speedtest.PairResult[];
  protocol: string;
  activeIndex: number;
  onPick: (index: number) => void;
}) {
  const udp = protocol === "udp";
  const head = ["主机", "状态", "路径", "中心→主机", "主机→中心", "RTT", udp ? "抖动 / 丢包" : "重传", "说明"];
  return (
    <div className="surface-float overflow-auto">
      <table className="w-full border-collapse text-left text-sm">
        <thead className="sticky top-0 z-[1] bg-surface text-xs font-normal text-muted">
          <tr className="h-table-head border-b border-line">
            {head.map((h, i) => (
              <th key={h} className={cn("px-3 font-normal", i >= 3 && i <= 6 && "text-right")}>
                {h === "中心→主机" ? (
                  <span className="inline-flex items-center gap-1.5">
                    <span aria-hidden className="h-0.5 w-3 bg-io-write" />
                    {h}
                  </span>
                ) : h === "主机→中心" ? (
                  <span className="inline-flex items-center gap-1.5">
                    <span aria-hidden className="h-0.5 w-3 bg-io-read" />
                    {h}
                  </span>
                ) : (
                  h
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {pairs.map((p, i) => {
            const s = p.summary;
            return (
              <tr
                key={`${p.a}-${p.b}`}
                onClick={() => onPick(i)}
                className={cn(
                  "h-table-row cursor-pointer border-t border-line",
                  i === activeIndex ? "bg-accent-soft" : "hover:bg-raised",
                )}
              >
                <td className="max-w-[200px] truncate px-3 text-ink">{p.b}</td>
                <td className="px-3">
                  <PairStatusTag status={p.status} />
                </td>
                <td className="max-w-[220px] truncate px-3 font-mono text-xs">{pathText(p.path)}</td>
                <td className="px-3 text-right tabular-nums">{formatBps(s?.ab)}</td>
                <td className="px-3 text-right tabular-nums">{formatBps(s?.ba)}</td>
                <td className="px-3 text-right tabular-nums">{formatMs(s?.rttMs || p.path?.rttMs)}</td>
                <td className="px-3 text-right tabular-nums">
                  {s ? (udp ? `${formatMs(s.jitterMs)} / ${s.lostPct.toFixed(2)}%` : String(s.retransmits)) : "—"}
                </td>
                <td className="max-w-[320px] truncate px-3 text-xs text-muted" title={p.reason}>
                  {p.reason || ""}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/**
 * 矩阵：行是发送方、列是接收方，格内为 A→B 平均吞吐。
 * 热度只用三档已有 token：raised / accent-tint / accent-soft + accent 字。
 */
export function MatrixGrid({
  hosts,
  pairs,
  activeIndex,
  onPick,
}: {
  hosts: string[];
  pairs: speedtest.PairResult[];
  activeIndex: number;
  onPick: (index: number) => void;
}) {
  const index = new Map<string, number>();
  pairs.forEach((p, i) => index.set(`${p.a}\u0000${p.b}`, i));
  const max = pairs.reduce((m, p) => Math.max(m, p.summary?.ab || 0), 0);

  function tier(v: number) {
    if (!v || !max) return "bg-raised text-muted";
    const r = v / max;
    if (r >= 0.75) return "bg-accent-soft text-accent font-semibold";
    if (r >= 0.4) return "bg-accent-tint text-ink";
    return "bg-raised text-ink";
  }

  return (
    <div className="overflow-auto">
      <table className="border-separate border-spacing-1 text-sm">
        <thead>
          <tr>
            <th className="px-2 text-left text-xs font-normal text-muted">发送 ＼ 接收</th>
            {hosts.map((h) => (
              <th key={h} className="max-w-[140px] truncate px-2 text-xs font-normal text-muted" title={h}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {hosts.map((a) => (
            <tr key={a}>
              <th className="max-w-[160px] truncate px-2 text-left text-xs font-normal text-muted" title={a}>
                {a}
              </th>
              {hosts.map((b) => {
                if (a === b) {
                  return <td key={b} className="h-12 min-w-[112px] rounded-control bg-canvas" aria-hidden />;
                }
                const i = index.get(`${a}\u0000${b}`);
                const p = i === undefined ? undefined : pairs[i];
                const v = p?.summary?.ab || 0;
                let body: ReactNode = "—";
                if (p?.status === "done") body = formatBps(v);
                else if (p?.status === "running" || p?.status === "probe") body = "测速中…";
                else if (p?.status === "failed") body = <span className="text-danger">失败</span>;
                else if (p?.status === "nolan") body = "内网不通";
                else if (p?.status === "stopped") body = "已停止";
                return (
                  <td
                    key={b}
                    title={p?.reason || (p?.path ? pathText(p.path) : undefined)}
                    onClick={() => i !== undefined && onPick(i)}
                    className={cn(
                      "motion-colors h-12 min-w-[112px] cursor-pointer rounded-control px-2 text-center tabular-nums",
                      p?.status === "done" ? tier(v) : "bg-raised text-muted",
                      i === activeIndex && "outline outline-2 -outline-offset-2 outline-accent",
                    )}
                  >
                    {body}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** 单对详情：曲线 + 指标条 */
export function PairDetail({
  pair,
  samples,
  protocol,
  title,
}: {
  pair: speedtest.PairResult;
  samples: speedtest.Sample[];
  protocol: string;
  title?: string;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-semibold text-ink">{title || `${pair.a} ⇄ ${pair.b}`}</h3>
        <PairStatusTag status={pair.status} />
        <span className="truncate text-xs text-muted">{pathText(pair.path)}</span>
      </div>
      {pair.reason ? <p className="text-sm text-muted">{pair.reason}</p> : null}
      {samples.length || pair.summary ? (
        <>
          <StatStrip samples={samples} summary={pair.summary} protocol={protocol} fallbackRtt={pair.path?.rttMs} />
          {samples.length ? <LiveChart samples={samples} height={220} /> : null}
        </>
      ) : null}
    </div>
  );
}
