import { Play, Square } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { api, type speedtest } from "@/api";
import { FlashNotices, Page } from "@/react/components/page";
import { Button } from "@/react/components/ui/button";
import { Checkbox } from "@/react/components/ui/checkbox";
import { RadioGroup } from "@/react/components/ui/radio-group";
import { Select } from "@/react/components/ui/select";
import { Tag } from "@/react/components/ui/tag";
import { useFlashMessage } from "@/react/lib/use-flash-message";
import { useSession } from "@/react/state/session";
import { formatErr } from "@/utils/format";
import { paramsText } from "./format";
import { MatrixGrid, PairDetail, StarTable } from "./group-results";
import { ParamsForm } from "./params-form";
import { PHASE_LABEL, Section, loadParams, phaseTone } from "./pair-view";
import { isFinished, speedtestStore, useSpeedtestRun } from "./store";

const PARAMS_KEY = "ipannel.speedtest.group-params.v1";

const cache = { groupId: "", mode: "star" as "star" | "mesh", center: "", excluded: [] as string[], prefillNonce: 0 };

export function GroupView() {
  const session = useSession();
  const flash = useFlashMessage();
  const run = useSpeedtestRun();
  const [groupId, setGroupId] = useState(cache.groupId || session.groups[0]?.id || "");
  const [mode, setMode] = useState(cache.mode);
  const [center, setCenter] = useState(cache.center);
  const [excluded, setExcluded] = useState<string[]>(cache.excluded);
  const [params, setParams] = useState(() => loadParams(PARAMS_KEY, 5));
  const [picked, setPicked] = useState(-1);
  const [record, setRecord] = useState<speedtest.Record | null>(null);

  const groupRun = run && (run.kind === "star" || run.kind === "mesh") ? run : null;
  const running = !!run && !isFinished(run.phase);
  const group = session.groups.find((g) => g.id === groupId);
  const allHosts = useMemo(() => (groupId ? session.hostsOf(groupId).map((h) => h.name) : []), [groupId, session]);
  const hosts = allHosts.filter((h) => !excluded.includes(h));

  // 启动时分组可能还没加载，加载后补上默认分组
  useEffect(() => {
    if (session.groups.length && !session.groups.some((g) => g.id === groupId)) {
      setGroupId(session.groups[0].id);
    }
  }, [session.groups, groupId]);

  useEffect(() => {
    Object.assign(cache, { groupId, mode, center, excluded });
  }, [groupId, mode, center, excluded]);

  useEffect(() => {
    localStorage.setItem(PARAMS_KEY, JSON.stringify(params));
  }, [params]);

  useEffect(() => {
    if (!hosts.includes(center)) setCenter(hosts[0] || "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hosts.join("\u0000")]);

  const prefill = session.speedtestPrefill;
  useEffect(() => {
    if (!prefill?.groupId || prefill.nonce === cache.prefillNonce) return;
    cache.prefillNonce = prefill.nonce;
    setGroupId(prefill.groupId);
    setExcluded([]);
  }, [prefill?.nonce, prefill?.groupId]);

  // 完成后取记录，里面带每对的采样曲线
  useEffect(() => {
    setRecord(null);
    if (!groupRun || groupRun.phase !== "done" && groupRun.phase !== "stopped") return;
    if (!groupRun.recordId) return;
    let alive = true;
    void api
      .speedtestRecord(groupRun.recordId)
      .then((r) => alive && setRecord(r))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [groupRun?.recordId, groupRun?.phase]);

  const pairCount = mode === "star" ? Math.max(0, hosts.length - 1) : hosts.length * Math.max(0, hosts.length - 1);
  const estimate = pairCount * (params.duration + 3);

  async function start() {
    if (running || hosts.length < 2) return;
    flash.clear();
    setPicked(-1);
    const p = { ...params, direction: mode === "star" ? "bidir" : "forward" };
    speedtestStore.begin({ kind: mode, group: group?.name || "", params: p });
    try {
      const id = await api.speedtestStartGroup({
        group: group?.name || "",
        hosts,
        mode,
        center: mode === "star" ? center : "",
        params: p,
      });
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

  const pairs = groupRun?.pairs || [];
  const activeIndex = picked >= 0 ? picked : groupRun?.pairIndex ?? -1;
  const activePair = activeIndex >= 0 ? pairs[activeIndex] : undefined;
  const activeSamples =
    activeIndex >= 0 && activeIndex === groupRun?.pairIndex && groupRun.pairSamples.length
      ? groupRun.pairSamples
      : record?.pairs?.[activeIndex]?.samples || [];
  const runHosts = groupRun?.kind === "mesh" ? Array.from(new Set(pairs.flatMap((p) => [p.a, p.b]))) : [];
  const finishedCount = pairs.filter((p) => !["pending", "probe", "running"].includes(p.status)).length;

  const actions = running ? (
    <Button variant="danger" onClick={stop} disabled={!run?.id}>
      <Square className="size-4" />
      停止
    </Button>
  ) : (
    <Button variant="primary" onClick={start} disabled={hosts.length < 2 || (mode === "star" && !center)}>
      <Play className="size-4" />
      开始测速
    </Button>
  );

  return (
    <Page title="分组测速">
      <FlashNotices flash={flash} />
      <div className="flex flex-col gap-section">
        <Section title="分组与方式">
          <div className="flex flex-wrap items-center gap-3">
            <Select
              aria-label="分组"
              value={groupId}
              disabled={running}
              onChange={(v) => {
                setGroupId(v);
                setExcluded([]);
              }}
              options={session.groups.map((g) => ({ value: g.id, label: g.name }))}
              placeholder="选择分组"
              filterable
              className="w-56"
            />
            <RadioGroup
              value={mode}
              disabled={running}
              onChange={setMode}
              options={[
                { value: "star", label: "星型" },
                { value: "mesh", label: "矩阵" },
              ]}
            />
            {mode === "star" ? (
              <>
                <span className="text-sm text-muted">中心机</span>
                <Select
                  aria-label="中心机"
                  value={center}
                  disabled={running || hosts.length === 0}
                  onChange={setCenter}
                  options={hosts.map((h) => ({
                    value: h,
                    label: h,
                    keywords: session.hosts.find((x) => x.name === h)?.hostName,
                  }))}
                  filterable
                  className="w-48"
                />
              </>
            ) : null}
            {actions}
          </div>
          <p className="text-xs text-muted">
            {mode === "star"
              ? "星型：中心机依次和每台主机双向测一轮，适合看「这台机器到其它机器」的带宽。"
              : "矩阵：每两台之间各测一次 A→B，结果是一张发送方 × 接收方的表，测试轮数是主机数的平方级。"}
            分组测速只走局域网，内网不通的组合会标出原因并跳过；不包含本机。
          </p>
          {allHosts.length ? (
            <div className="flex flex-wrap gap-x-4 gap-y-2">
              {allHosts.map((h) => (
                <Checkbox
                  key={h}
                  checked={!excluded.includes(h)}
                  disabled={running}
                  onChange={(on) => setExcluded((cur) => (on ? cur.filter((x) => x !== h) : [...cur, h]))}
                >
                  {h}
                </Checkbox>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted">{groupId ? "该分组没有主机" : "还没有分组，先在主机列表里建分组"}</p>
          )}
          <p className="text-xs text-muted tabular-nums">
            已选 {hosts.length} 台，共 {pairCount} 轮，预计约 {Math.ceil(estimate / 60)} 分钟（不含首次上传 iperf3）
          </p>
        </Section>

        <Section title="参数">
          <ParamsForm value={params} onChange={setParams} disabled={running} fixedDirection={mode === "star" ? "bidir" : "forward"} />
        </Section>

        {groupRun ? (
          <Section
            title="结果"
            extra={
              <>
                <Tag tone={phaseTone(groupRun.phase)}>{PHASE_LABEL[groupRun.phase] || groupRun.phase}</Tag>
                <span className="min-w-0 truncate text-xs text-muted tabular-nums">
                  {groupRun.group ? `${groupRun.group} · ` : ""}
                  {groupRun.kind === "star" ? "星型" : "矩阵"} · 进度 {finishedCount}/{pairs.length}
                  {groupRun.params ? ` · ${paramsText(groupRun.params)}` : ""}
                </span>
              </>
            }
          >
            {groupRun.message ? (
              <p className={groupRun.phase === "failed" ? "text-sm text-danger" : "text-sm text-muted"}>{groupRun.message}</p>
            ) : null}
            {pairs.length ? (
              groupRun.kind === "star" ? (
                <StarTable
                  pairs={pairs}
                  protocol={groupRun.params?.protocol || "tcp"}
                  params={groupRun.params}
                  activeIndex={activeIndex} onPick={setPicked} />
              ) : (
                <MatrixGrid
                  hosts={runHosts}
                  pairs={pairs}
                  protocol={groupRun.params?.protocol || "tcp"}
                  params={groupRun.params}
                  activeIndex={activeIndex} onPick={setPicked} />
              )
            ) : null}
            {activePair ? (
              <PairDetail
                pair={activePair}
                samples={activeSamples}
                protocol={groupRun.params?.protocol || "tcp"}
                params={groupRun.params}
              />
            ) : null}
          </Section>
        ) : null}
      </div>
    </Page>
  );
}
