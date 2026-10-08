import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { api } from "@/api";
import { TH_STICKY_LINE } from "@/react/components/data-table";
import { FlashNotices, Notice, Page } from "@/react/components/page";
import { Button } from "@/react/components/ui/button";
import { confirmDialog } from "@/react/components/ui/confirm-dialog";
import { RadioGroup } from "@/react/components/ui/radio-group";
import { Tag, type TagTone } from "@/react/components/ui/tag";
import { formatDateTime } from "@/react/lib/alert-incidents";
import {
  dailyBreakdown,
  filterByRange,
  formatDayLabel,
  formatSpan,
  rangeStart,
  summarize,
  toEntries,
  type RunLogRange,
  type RunLogStatus,
} from "@/react/lib/run-log-stats";
import { useFlashMessage } from "@/react/lib/use-flash-message";
import { cn } from "@/react/lib/utils";
import { formatErr } from "@/utils/format";

const RANGE_OPTIONS: { value: RunLogRange; label: string }[] = [
  { value: "7d", label: "近 7 天" },
  { value: "30d", label: "近 30 天" },
  { value: "all", label: "全部" },
];

const STATUS_META: Record<RunLogStatus, { label: string; tone: TagTone }> = {
  running: { label: "运行中", tone: "accent" },
  normal: { label: "正常退出", tone: "neutral" },
  abnormal: { label: "异常退出", tone: "warn" },
};

const TH = cn("relative px-3 font-normal", TH_STICKY_LINE);

export function RunLogPage() {
  const [range, setRange] = useState<RunLogRange>("7d");
  const [now, setNow] = useState(() => Date.now());
  const flash = useFlashMessage();

  const query = useQuery({
    queryKey: ["app-sessions"],
    queryFn: () => api.listAppSessions(0),
  });
  const refetch = query.refetch;

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const clear = useMutation({
    mutationFn: () => api.clearAppSessions(),
    onSuccess: () => {
      void refetch();
      flash.showToast("已清空历史运行日志");
    },
    onError: (error) => flash.showError(`清空失败：${formatErr(error)}`),
  });

  async function onClear() {
    const ok = await confirmDialog({
      title: "清空运行日志？",
      body: "将删除全部历史启动 / 退出记录，本次运行的记录会保留。此操作不可撤销。",
      theme: "danger",
      confirmText: "清空",
    });
    if (ok) clear.mutate();
  }

  const entries = useMemo(() => toEntries(query.data || [], now), [query.data, now]);
  const from = rangeStart(range, now);
  const inRange = useMemo(() => filterByRange(entries, from), [entries, from]);
  const summary = useMemo(() => summarize(inRange), [inRange]);
  const days = useMemo(() => dailyBreakdown(inRange, from), [inRange, from]);
  const current = entries.find((e) => e.status === "running");

  return (
    <Page
      title="运行日志"
      actions={
        <>
          <RadioGroup aria-label="统计范围" value={range} onChange={setRange} options={RANGE_OPTIONS} />
          <Button size="sm" disabled={clear.isPending || entries.length <= 1} onClick={() => void onClear()}>
            清空
          </Button>
        </>
      }
      onRefresh={() => void refetch()}
      refreshing={query.isFetching}
    >
      <FlashNotices flash={flash} />
      {query.error ? <Notice text={formatErr(query.error)} /> : null}
      <div className="flex flex-col gap-section">
        <section className="grid grid-cols-2 gap-card lg:grid-cols-3">
          <StatBlock label="启动次数" value={`${summary.launches} 次`} />
          <StatBlock label="累计在线" value={formatSpan(summary.totalMs)} />
          <StatBlock label="平均每次" value={formatSpan(summary.avgMs)} />
          <StatBlock label="最长一次" value={formatSpan(summary.maxMs)} />
          <StatBlock
            label="异常退出"
            value={`${summary.abnormal} 次`}
            valueClass={summary.abnormal > 0 ? "text-warn" : undefined}
          />
          <StatBlock
            label="本次已在线"
            value={current ? formatSpan(current.durationMs) : "—"}
            hint={current ? `${formatDateTime(current.startAt)} 启动` : undefined}
          />
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold text-ink">按日汇总</h2>
          <table className="w-full border-collapse text-left text-sm">
            <thead className="text-xs text-muted">
              <tr className="h-table-head">
                <th className={TH}>日期</th>
                <th className={cn(TH, "w-32 text-right")}>启动次数</th>
                <th className={cn(TH, "w-48 text-right")}>在线时长</th>
              </tr>
            </thead>
            <tbody>
              {days.length === 0 ? (
                <EmptyRow colSpan={3} />
              ) : (
                days.map((d) => (
                  <tr key={d.day} className="h-table-row border-t border-line hover:bg-raised">
                    <td className="px-3 font-mono tabular-nums">{formatDayLabel(d.day, now)}</td>
                    <td className="px-3 text-right font-mono tabular-nums">{d.launches}</td>
                    <td className="px-3 text-right font-mono tabular-nums">{formatSpan(d.totalMs)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold text-ink">启动明细</h2>
          <table className="w-full border-collapse text-left text-sm">
            <thead className="text-xs text-muted">
              <tr className="h-table-head">
                <th className={cn(TH, "w-12 text-center")}>序</th>
                <th className={TH}>启动时间</th>
                <th className={TH}>退出时间</th>
                <th className={cn(TH, "text-right")}>在线时长</th>
                <th className={TH}>退出方式</th>
                <th className={TH}>版本</th>
              </tr>
            </thead>
            <tbody>
              {inRange.length === 0 ? (
                <EmptyRow colSpan={6} />
              ) : (
                inRange.map((e, index) => (
                  <tr key={e.id} className="h-table-row border-t border-line hover:bg-raised">
                    <td className="px-2 text-center font-mono text-xs tabular-nums text-muted">
                      {index + 1}
                    </td>
                    <td className="px-3 font-mono tabular-nums">{formatDateTime(e.startAt)}</td>
                    <td className="px-3 font-mono tabular-nums">
                      {e.status === "running" ? (
                        <span className="text-muted">—</span>
                      ) : (
                        <span data-tip={e.status === "abnormal" ? "按最后一次心跳估算" : undefined}>
                          {formatDateTime(e.endAt)}
                        </span>
                      )}
                    </td>
                    <td className="px-3 text-right font-mono tabular-nums">{formatSpan(e.durationMs)}</td>
                    <td className="px-3">
                      <Tag tone={STATUS_META[e.status].tone}>{STATUS_META[e.status].label}</Tag>
                    </td>
                    <td className="px-3 font-mono text-xs text-muted">{e.version || "—"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </section>
      </div>
    </Page>
  );
}

function StatBlock({
  label,
  value,
  hint,
  valueClass,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  valueClass?: string;
}) {
  return (
    <div className="flex flex-col gap-1 bg-raised p-4">
      <span className="text-xs text-muted">{label}</span>
      <span className={cn("font-mono text-2xl font-semibold tabular-nums text-ink", valueClass)}>
        {value}
      </span>
      {hint ? <span className="font-mono text-xs tabular-nums text-muted">{hint}</span> : null}
    </div>
  );
}

function EmptyRow({ colSpan }: { colSpan: number }) {
  return (
    <tr className="h-table-row border-t border-line">
      <td className="px-3 text-muted" colSpan={colSpan}>
        所选范围内没有记录
      </td>
    </tr>
  );
}
