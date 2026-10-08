import type { speedtest } from "@/api";
import { Tag } from "@/react/components/ui/tag";
import { cn } from "@/react/lib/utils";
import { RELATION_LABEL, addrText, endpointLabel, formatMs, linkSidesText, linkSpeedText } from "./format";

/** 状态灯：可用 success，不可用 line-strong（不亮） */
export function StatusLed({ on, className }: { on: boolean; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("inline-block size-2 shrink-0 rounded-full", on ? "bg-success" : "bg-line-strong", className)}
    />
  );
}

function sameCandidate(a?: speedtest.Candidate | null, b?: speedtest.Candidate | null) {
  return !!a && !!b && a.server === b.server && a.target.ip === b.target.ip && a.relation === b.relation;
}

function candidateTitle(c: speedtest.Candidate, report: speedtest.PathReport): string {
  const server = c.server === "a" ? report.a : report.b;
  const port = c.port ? `:${c.port}` : "";
  return `${RELATION_LABEL[c.relation] || c.relation} · ${endpointLabel(server.id)} ${c.target.ip}${port}`;
}

function PathCard({
  title,
  kind,
  report,
  selected,
  recommended,
  onSelect,
  disabled,
}: {
  title: string;
  kind: "lan" | "wan";
  report: speedtest.PathReport;
  selected: speedtest.Candidate | null;
  recommended: boolean;
  onSelect: (c: speedtest.Candidate) => void;
  disabled: boolean;
}) {
  const summary = kind === "lan" ? report.lan : report.wan;
  const list = (report.candidates || []).filter((c) => c.kind === kind);
  const available = summary.available && !!summary.best;
  const active = available && selected?.kind === kind;
  const clickable = available && !disabled;

  return (
    <div
      role={clickable ? "button" : undefined}
      tabIndex={clickable ? 0 : undefined}
      aria-pressed={clickable ? active : undefined}
      onClick={() => clickable && summary.best && onSelect(summary.best)}
      onKeyDown={(e) => {
        if (!clickable || !summary.best) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect(summary.best);
        }
      }}
      className={cn(
        "motion-colors flex min-w-0 flex-col gap-3 rounded-panel p-4 text-left",
        active ? "bg-accent-soft" : "bg-raised",
        clickable && !active && "cursor-pointer hover:bg-accent-tint",
        !available && "opacity-60",
      )}
    >
      <div className="flex items-center gap-2">
        <StatusLed on={available} />
        <span className={cn("text-sm font-semibold", active ? "text-accent" : available ? "text-ink" : "text-muted")}>
          {title}
        </span>
        {recommended && available ? <Tag tone="accent">推荐</Tag> : null}
        {active ? <Tag tone="info">已选</Tag> : null}
        <span className="ml-auto text-xs text-muted tabular-nums">
          {available && summary.best ? `可连通 · RTT ${formatMs(summary.best.rttMs)}` : "不可用"}
        </span>
      </div>
      {list.length === 0 ? (
        <p className="text-xs text-muted">{summary.reason || (kind === "lan" ? "没有可用的内网地址" : "没有可用的公网地址")}</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {list.map((c) => {
            const isSel = sameCandidate(c, selected);
            const pick = c.ok && !disabled;
            return (
              <li key={`${c.server}-${c.target.ip}-${c.relation}`}>
                <button
                  type="button"
                  disabled={!pick}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (pick) onSelect(c);
                  }}
                  className={cn(
                    "flex w-full min-w-0 items-center gap-2 rounded-control px-2 py-1 text-left text-xs",
                    pick ? "cursor-pointer hover:bg-surface" : "cursor-default",
                    isSel && "bg-surface",
                  )}
                >
                  <StatusLed on={c.ok} className="size-1.5" />
                  <span className={cn("min-w-0 flex-1 truncate", c.ok ? "text-ink" : "text-muted")}>
                    {candidateTitle(c, report)}
                  </span>
                  {c.linkMbps ? (
                    <span className="shrink-0 text-muted tabular-nums" data-tip={`两端网卡协商速率：${linkSidesText(c)}`}>
                      上限 {linkSpeedText(c.linkMbps)}
                    </span>
                  ) : null}
                  <span className="shrink-0 text-muted tabular-nums">
                    {c.ok ? formatMs(c.rttMs) : c.probed ? "不通" : "未探测"}
                  </span>
                </button>
                {!c.ok && c.reason ? <p className="pl-5.5 pr-2 text-xs text-muted">{c.reason}</p> : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function EndpointSegments({ view, side }: { view: speedtest.EndpointView; side: "A" | "B" }) {
  const addrs = view.addrs || [];
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="text-xs text-muted">
        {side} 端 · {endpointLabel(view.id)}
      </div>
      {view.error ? (
        <div className="text-xs text-danger">{view.error}</div>
      ) : addrs.length === 0 ? (
        <div className="text-xs text-muted">未读到地址</div>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {addrs.map((a) => (
            <Tag
              key={`${a.source}-${a.ip}`}
              tone={a.kind === "wan" ? "warn" : a.kind === "overlay" ? "info" : "neutral"}
              title={a.speedMbps ? `${a.iface} · 协商速率 ${a.speedMbps} Mbps` : `${a.iface || a.source}`}
            >
              <span className="font-mono">{addrText(a)}</span>
              {a.speedMbps ? <span className="tabular-nums"> · {linkSpeedText(a.speedMbps)}</span> : null}
            </Tag>
          ))}
        </div>
      )}
    </div>
  );
}

export function PathCards({
  report,
  selected,
  onSelect,
  disabled = false,
}: {
  report: speedtest.PathReport;
  selected: speedtest.Candidate | null;
  onSelect: (c: speedtest.Candidate) => void;
  disabled?: boolean;
}) {
  const tone =
    report.decision === "none" ? "text-danger" : report.decision === "choose" ? "text-accent" : "text-muted";
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-card">
        <PathCard
          title="局域网"
          kind="lan"
          report={report}
          selected={selected}
          recommended={report.decision === "lan" || report.decision === "choose"}
          onSelect={onSelect}
          disabled={disabled}
        />
        <PathCard
          title="广域网"
          kind="wan"
          report={report}
          selected={selected}
          recommended={report.decision === "wan"}
          onSelect={onSelect}
          disabled={disabled}
        />
      </div>
      {report.message ? <p className={cn("text-sm", tone)}>{report.message}</p> : null}
      <div className="grid grid-cols-2 gap-card">
        <EndpointSegments view={report.a} side="A" />
        <EndpointSegments view={report.b} side="B" />
      </div>
    </div>
  );
}
