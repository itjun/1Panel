import { RotateCcw, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { api, type speedtest } from "@/api";
import { FlashNotices, Page } from "@/react/components/page";
import { confirmDialog } from "@/react/components/ui/confirm-dialog";
import { Button } from "@/react/components/ui/button";
import { Tag } from "@/react/components/ui/tag";
import { useFlashMessage } from "@/react/lib/use-flash-message";
import { cn } from "@/react/lib/utils";
import { useSession } from "@/react/state/session";
import { formatErr } from "@/utils/format";
import { RELATION_LABEL, endpointLabel, formatBps, formatTime, paramsText } from "./format";
import { MatrixGrid, PairDetail, StarTable } from "./group-results";
import { LiveChart, StatStrip } from "./live-chart";
import { PHASE_LABEL, Section, phaseTone } from "./pair-view";
import { useSpeedtestRun } from "./store";

const KIND_LABEL: Record<string, string> = { pair: "两机", star: "星型", mesh: "矩阵" };

function resultText(it: speedtest.HistoryItem): string {
  if (it.kind === "pair") {
    const s = it.summary;
    if (!s) return "—";
    const parts = [];
    if (s.ab > 0) parts.push(`A→B ${formatBps(s.ab)}`);
    if (s.ba > 0) parts.push(`B→A ${formatBps(s.ba)}`);
    return parts.join(" · ") || "—";
  }
  const avg = it.avgAB > 0 ? ` · 平均 ${formatBps(it.avgAB)}` : "";
  return `成功 ${it.pairOk}/${it.pairCount}${avg}`;
}

function RecordDetail({ rec }: { rec: speedtest.Record }) {
  const session = useSession();
  const [picked, setPicked] = useState(-1);
  const protocol = rec.params?.protocol || "tcp";
  const pairs = rec.pairs || [];

  if (rec.kind === "pair") {
    const samples = rec.samples || [];
    return (
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-ink">
            {endpointLabel(rec.aId || rec.a || "")} ⇄ {endpointLabel(rec.bId || rec.b || "")}
          </span>
          {rec.path ? (
            <span className="text-xs text-muted">
              {RELATION_LABEL[rec.path.relation] || rec.path.relation} {rec.path.target.ip}
            </span>
          ) : null}
          <span className="text-xs text-muted">{paramsText(rec.params)}</span>
          {rec.aId && rec.bId ? (
            <Button
              variant="ghost"
              size="sm"
              className="ml-auto"
              onClick={() => session.openSpeedtest("pair", { a: rec.aId, b: rec.bId })}
            >
              <RotateCcw className="size-4" />
              再测一次
            </Button>
          ) : null}
        </div>
        {rec.error ? <p className="text-sm text-danger">{rec.error}</p> : null}
        <StatStrip samples={samples} summary={rec.summary} protocol={protocol} fallbackRtt={rec.path?.rttMs} />
        {samples.length ? <LiveChart samples={samples} height={240} /> : null}
      </div>
    );
  }

  const hosts = rec.hosts?.length ? rec.hosts : Array.from(new Set(pairs.flatMap((p) => [p.a, p.b])));
  const active = picked >= 0 ? pairs[picked] : undefined;
  return (
    <div className="flex flex-col gap-3">
      <div className="text-xs text-muted">
        {rec.group ? `${rec.group} · ` : ""}
        {rec.kind === "star" && rec.center ? `中心机 ${rec.center} · ` : ""}
        {paramsText(rec.params)}
      </div>
      {rec.kind === "star" ? (
        <StarTable pairs={pairs} protocol={protocol} activeIndex={picked} onPick={setPicked} />
      ) : (
        <MatrixGrid hosts={hosts} pairs={pairs} activeIndex={picked} onPick={setPicked} />
      )}
      {active ? <PairDetail pair={active} samples={active.samples || []} protocol={protocol} /> : null}
    </div>
  );
}

export function HistoryView() {
  const flash = useFlashMessage();
  const run = useSpeedtestRun();
  const [items, setItems] = useState<speedtest.HistoryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState("");
  const [record, setRecord] = useState<speedtest.Record | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setItems(await api.speedtestHistory());
    } catch (e) {
      flash.showError(formatErr(e));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void load();
  }, [load, run?.recordId]);

  useEffect(() => {
    setRecord(null);
    if (!selectedId) return;
    let alive = true;
    api
      .speedtestRecord(selectedId)
      .then((r) => alive && setRecord(r))
      .catch((e) => alive && flash.showError(formatErr(e)));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  async function remove(it: speedtest.HistoryItem) {
    const ok = await confirmDialog({ title: "删除这条测速记录？", theme: "danger", confirmText: "删除" });
    if (!ok) return;
    try {
      await api.speedtestDeleteRecord(it.id);
      if (selectedId === it.id) setSelectedId("");
      await load();
      flash.showToast("已删除");
    } catch (e) {
      flash.showError(formatErr(e));
    }
  }

  const head = ["时间", "类型", "对象", "参数", "结果", "状态", ""];
  return (
    <Page title="历史记录" onRefresh={() => void load()} refreshing={loading}>
      <FlashNotices flash={flash} />
      <div className="flex flex-col gap-section">
        <div className="surface-float overflow-auto">
          <table className="w-full border-collapse text-left text-sm">
            <thead className="sticky top-0 z-[1] bg-surface text-xs font-normal text-muted">
              <tr className="h-table-head border-b border-line">
                {head.map((h, i) => (
                  <th key={i} className="px-3 font-normal">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.length === 0 ? (
                <tr className="h-table-row">
                  <td className="px-3 text-muted" colSpan={head.length}>
                    {loading ? "加载中…" : "暂无测速记录"}
                  </td>
                </tr>
              ) : (
                items.map((it) => (
                  <tr
                    key={it.id}
                    onClick={() => setSelectedId(it.id === selectedId ? "" : it.id)}
                    className={cn(
                      "h-table-row cursor-pointer border-t border-line",
                      it.id === selectedId ? "bg-accent-soft" : "hover:bg-raised",
                    )}
                  >
                    <td className="whitespace-nowrap px-3 tabular-nums text-muted">{formatTime(it.createdAt)}</td>
                    <td className="px-3">{KIND_LABEL[it.kind] || it.kind}</td>
                    <td className="max-w-[260px] truncate px-3 text-ink">
                      {it.kind === "pair"
                        ? `${endpointLabel(it.a || "")} ⇄ ${endpointLabel(it.b || "")}`
                        : `${it.group || "分组"}${it.center ? ` · 中心 ${it.center}` : ""}`}
                    </td>
                    <td className="max-w-[260px] truncate px-3 text-xs text-muted">{paramsText(it.params)}</td>
                    <td className="whitespace-nowrap px-3 tabular-nums">{resultText(it)}</td>
                    <td className="px-3">
                      <Tag tone={phaseTone(it.status)}>{PHASE_LABEL[it.status] || it.status}</Tag>
                    </td>
                    <td className="px-3 text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label="删除"
                        onClick={(e) => {
                          e.stopPropagation();
                          void remove(it);
                        }}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {selectedId ? (
          <Section title="详情">
            {record ? <RecordDetail key={record.id} rec={record} /> : <p className="text-sm text-muted">加载中…</p>}
          </Section>
        ) : null}
      </div>
    </Page>
  );
}
