import { ArrowLeftRight, Copy, Play, RefreshCw, Square } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { api, type speedtest } from "@/api";
import { FlashNotices, Page } from "@/react/components/page";
import { Button } from "@/react/components/ui/button";
import { Switch } from "@/react/components/ui/switch";
import { Tag } from "@/react/components/ui/tag";
import { useFlashMessage } from "@/react/lib/use-flash-message";
import { useSession } from "@/react/state/session";
import { copyText } from "@/utils/clipboard";
import { formatErr } from "@/utils/format";
import { EndpointPicker } from "./endpoint-picker";
import {
  LOCAL_ID,
  RELATION_LABEL,
  defaultParams,
  endpointLabel,
  linkSidesText,
  linkSpeedText,
  paramsText,
  summaryText,
} from "./format";
import { LiveChart, StatStrip } from "./live-chart";
import { ParamsForm } from "./params-form";
import { PathCards } from "./path-cards";
import { isFinished, speedtestStore, useSpeedtestRun } from "./store";
import { evaluate } from "./verdict";
import { VerdictPanel } from "./verdict-panel";

const PARAMS_KEY = "ipannel.speedtest.params.v1";

export const PHASE_LABEL: Record<string, string> = {
  prepare: "准备中",
  provision: "上传 iperf3",
  probe: "探测路径",
  running: "测速中",
  done: "已完成",
  failed: "失败",
  stopped: "已停止",
};

export function phaseTone(phase: string): "ok" | "danger" | "neutral" | "accent" {
  if (phase === "done") return "ok";
  if (phase === "failed") return "danger";
  if (phase === "stopped") return "neutral";
  return "accent";
}

export function loadParams(key: string, duration: number): speedtest.Params {
  try {
    const raw = localStorage.getItem(key);
    if (raw) return { ...defaultParams(duration), ...(JSON.parse(raw) as Partial<speedtest.Params>) };
  } catch {
    /* 坏数据回退默认 */
  }
  return defaultParams(duration);
}

/** 切走再回来保留选择与识别结果 */
const cache: {
  a: string;
  b: string;
  report: speedtest.PathReport | null;
  selected: speedtest.Candidate | null;
  prefillNonce: number;
  /** 最近一次按链路上限自动填带宽的路径，切回页面时不重复覆盖手动修改 */
  autoLinkKey: string;
} = { a: LOCAL_ID, b: "", report: null, selected: null, prefillNonce: 0, autoLinkKey: "" };

function defaultSelection(r: speedtest.PathReport): speedtest.Candidate | null {
  if (r.decision === "wan") return r.wan.best ?? null;
  if (r.decision === "lan" || r.decision === "choose") return r.lan.best ?? null;
  return null;
}

export function Section({ title, extra, children }: { title: string; extra?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-semibold text-ink">{title}</h3>
        {extra}
      </div>
      {children}
    </section>
  );
}

export function PairView() {
  const session = useSession();
  const flash = useFlashMessage();
  const run = useSpeedtestRun();
  const [a, setA] = useState(cache.a);
  const [b, setB] = useState(cache.b);
  const [report, setReport] = useState(cache.report);
  const [selected, setSelected] = useState(cache.selected);
  const [detecting, setDetecting] = useState(false);
  const [params, setParams] = useState(() => loadParams(PARAMS_KEY, 10));
  const [streams, setStreams] = useState(false);
  const seq = useRef(0);

  const pairRun = run && run.kind === "pair" ? run : null;
  const running = !!run && !isFinished(run.phase);

  useEffect(() => {
    Object.assign(cache, { a, b, report, selected });
  }, [a, b, report, selected]);

  useEffect(() => {
    localStorage.setItem(PARAMS_KEY, JSON.stringify(params));
  }, [params]);

  const linkMbps = selected?.kind === "lan" ? selected.linkMbps || 0 : 0;
  useEffect(() => {
    if (!selected || !linkMbps) return;
    const key = `${selected.server}|${selected.target.ip}|${linkMbps}`;
    if (cache.autoLinkKey === key) return;
    cache.autoLinkKey = key;
    setParams((p) => ({ ...p, udpBandwidthMbps: linkMbps }));
  }, [selected, linkMbps]);

  const bandwidthExtra =
    selected && linkMbps ? (
      params.udpBandwidthMbps === linkMbps ? (
        <span className="min-w-0 truncate text-xs text-muted" data-tip={linkSidesText(selected)}>
          按链路上限 {linkSpeedText(linkMbps)} 自动填入
        </span>
      ) : (
        <Button
          variant="ghost"
          size="sm"
          disabled={running}
          data-tip={linkSidesText(selected)}
          onClick={() => setParams((p) => ({ ...p, udpBandwidthMbps: linkMbps }))}
        >
          按上限 {linkSpeedText(linkMbps)}
        </Button>
      )
    ) : null;

  useEffect(() => {
    void api.speedtestActiveId().then((id) => {
      if (id && !speedtestStore.get()) speedtestStore.adopt(id);
    });
  }, []);

  const detect = useCallback(
    async (na: string, nb: string) => {
      if (!na || !nb || na === nb) return;
      const my = ++seq.current;
      setDetecting(true);
      setReport(null);
      setSelected(null);
      try {
        const r = await api.speedtestDetect(na, nb, params.port);
        if (my !== seq.current) return;
        setReport(r);
        setSelected(defaultSelection(r));
      } catch (e) {
        if (my === seq.current) flash.showError(formatErr(e));
      } finally {
        if (my === seq.current) setDetecting(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [params.port],
  );

  const pick = (na: string, nb: string) => {
    setA(na);
    setB(nb);
    if (na && nb && na !== nb && !running) void detect(na, nb);
    else {
      seq.current++;
      setReport(null);
      setSelected(null);
      setDetecting(false);
    }
  };

  const prefill = session.speedtestPrefill;
  useEffect(() => {
    if (!prefill || prefill.nonce === cache.prefillNonce) return;
    cache.prefillNonce = prefill.nonce;
    if (prefill.a || prefill.b) pick(prefill.a || LOCAL_ID, prefill.b || "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefill?.nonce]);

  async function start() {
    if (!selected || running) return;
    flash.clear();
    speedtestStore.begin({ kind: "pair", a, b, params, path: selected });
    try {
      const id = await api.speedtestStart({ a, b, path: selected, params });
      speedtestStore.confirm(id);
    } catch (e) {
      speedtestStore.fail(formatErr(e));
      flash.showError(formatErr(e));
    }
  }

  async function stop() {
    if (!run?.id) return;
    try {
      await api.speedtestStop(run.id);
    } catch (e) {
      flash.showError(formatErr(e));
    }
  }

  async function copyResult() {
    if (!pairRun?.params) return;
    await copyText(
      summaryText({
        a: pairRun.a || "",
        b: pairRun.b || "",
        params: pairRun.params,
        path: pairRun.path,
        summary: pairRun.summary,
        verdict: evaluate({ summary: pairRun.summary, protocol: pairRun.params.protocol, path: pairRun.path, params: pairRun.params }),
      }),
    );
    flash.showToast("已复制测速结果");
  }

  const last = pairRun?.samples[pairRun.samples.length - 1];
  const verdict =
    pairRun?.phase === "done"
      ? evaluate({ summary: pairRun.summary, protocol: pairRun.params?.protocol || "tcp", path: pairRun.path, params: pairRun.params })
      : null;
  const actions = running ? (
    <Button variant="danger" onClick={stop} disabled={!run?.id}>
      <Square className="size-4" />
      停止
    </Button>
  ) : (
    <Button variant="primary" onClick={start} disabled={!selected || detecting}>
      <Play className="size-4" />
      开始测速
    </Button>
  );

  return (
    <Page title="两机测速">
      <FlashNotices flash={flash} />
      <div className="flex flex-col gap-section">
        <Section title="端点">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm text-muted">A</span>
            <EndpointPicker label="A 端" value={a} exclude={b} disabled={running} onChange={(v) => pick(v, b)} />
            <Button
              variant="ghost"
              size="sm"
              aria-label="交换 A、B"
              data-tip="交换 A、B"
              disabled={running || !b}
              onClick={() => pick(b, a)}
            >
              <ArrowLeftRight className="size-4" />
            </Button>
            <span className="text-sm text-muted">B</span>
            <EndpointPicker label="B 端" value={b} exclude={a} disabled={running} onChange={(v) => pick(a, v)} />
            <Button
              variant="secondary"
              size="sm"
              disabled={running || detecting || !a || !b || a === b}
              onClick={() => void detect(a, b)}
            >
              <RefreshCw className="size-4" />
              {detecting ? "识别中…" : "重新识别"}
            </Button>
            {actions}
          </div>
        </Section>

        <Section title="路径" extra={detecting ? <span className="text-xs text-muted">正在读取网卡并探测连通性…</span> : null}>
          {report ? (
            <PathCards report={report} selected={selected} onSelect={setSelected} disabled={running} />
          ) : (
            <p className="text-sm text-muted">
              {detecting ? "识别中，首次会把 iperf3 上传到远端，稍等几秒。" : "选好 A、B 两端后自动识别局域网 / 广域网路径。"}
            </p>
          )}
        </Section>

        <Section title="参数">
          <ParamsForm value={params} onChange={setParams} disabled={running} bandwidthExtra={bandwidthExtra} />
        </Section>

        {pairRun ? (
          <Section
            title="实时"
            extra={
              <>
                <Tag tone={phaseTone(pairRun.phase)}>{PHASE_LABEL[pairRun.phase] || pairRun.phase}</Tag>
                <span className="min-w-0 truncate text-xs text-muted">
                  {pairRun.a ? `${endpointLabel(pairRun.a)} ⇄ ${endpointLabel(pairRun.b || "")}` : ""}
                  {pairRun.path ? ` · ${RELATION_LABEL[pairRun.path.relation] || pairRun.path.relation} ${pairRun.path.target.ip}` : ""}
                  {pairRun.params ? ` · ${paramsText(pairRun.params)}` : ""}
                </span>
                <span className="ml-auto flex items-center gap-3">
                  {pairRun.params && last ? (
                    <span className="text-xs text-muted tabular-nums">
                      {Math.min(last.t, pairRun.params.duration).toFixed(0)} / {pairRun.params.duration} 秒
                    </span>
                  ) : null}
                  <Switch checked={streams} onChange={setStreams}>
                    分流
                  </Switch>
                  {pairRun.phase === "done" ? (
                    <Button variant="ghost" size="sm" onClick={copyResult}>
                      <Copy className="size-4" />
                      复制结果
                    </Button>
                  ) : null}
                </span>
              </>
            }
          >
            {pairRun.message && pairRun.phase !== "running" && pairRun.phase !== "done" ? (
              <p className={pairRun.phase === "failed" ? "text-sm text-danger" : "text-sm text-muted"}>{pairRun.message}</p>
            ) : null}
            {verdict ? <VerdictPanel verdict={verdict} /> : null}
            <StatStrip
              samples={pairRun.samples}
              summary={pairRun.summary}
              protocol={pairRun.params?.protocol || "tcp"}
              fallbackRtt={pairRun.path?.rttMs}
            />
            <LiveChart samples={pairRun.samples} streams={streams} />
          </Section>
        ) : null}
      </div>
    </Page>
  );
}
