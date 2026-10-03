import { useMemo } from "react";
import type { speedtest } from "@/api";
import { ChartHost, lineOption } from "@/react/components/monitor/charts";
import { readThemeColor } from "@/react/lib/utils";
import { formatBps, formatMs, pickBpsScale } from "./format";

/**
 * 实时吞吐曲线：A→B（A 发送）橙色 io-write，B→A（A 接收）浅蓝 io-read，
 * 与监控面板「发送 / 接收」语义一致。分流视图用同色细线。
 */
export function LiveChart({
  samples: all,
  streams = false,
  height = 280,
}: {
  samples: speedtest.Sample[];
  streams?: boolean;
  height?: number;
}) {
  const option = useMemo(() => {
    // -O 预热段结束后 iperf3 从 0 重新计时，预热点与正式点混画会出现重复时刻
    const live = all.filter((s) => !s.omitted);
    const samples = live.length ? live : all;
    const hasAB = samples.some((s) => s.ab > 0);
    const hasBA = samples.some((s) => s.ba > 0);
    let peak = 0;
    for (const s of samples) peak = Math.max(peak, s.ab, s.ba);
    const { divisor, unit } = pickBpsScale(peak);
    const x = samples.map((s) => `${s.t.toFixed(s.t % 1 === 0 ? 0 : 1)}s`);
    const write = readThemeColor("--color-io-write", "#f08a24");
    const read = readThemeColor("--color-io-read", "#1d8cf8");
    const scale = (v: number) => Number((v / divisor).toFixed(3));

    type S = { name: string; data: number[]; color: string; thin?: boolean };
    const list: S[] = [];
    if (hasAB || !hasBA) list.push({ name: "A→B", data: samples.map((s) => scale(s.ab)), color: write });
    if (hasBA) list.push({ name: "B→A", data: samples.map((s) => scale(s.ba)), color: read });
    if (streams) {
      const nAB = Math.max(0, ...samples.map((s) => s.streamsAB?.length || 0));
      const nBA = Math.max(0, ...samples.map((s) => s.streamsBA?.length || 0));
      for (let i = 0; i < nAB; i++) {
        list.push({ name: `A→B #${i + 1}`, data: samples.map((s) => scale(s.streamsAB?.[i] || 0)), color: write, thin: true });
      }
      for (let i = 0; i < nBA; i++) {
        list.push({ name: `B→A #${i + 1}`, data: samples.map((s) => scale(s.streamsBA?.[i] || 0)), color: read, thin: true });
      }
    }

    const base = lineOption(
      x,
      list.map((s) => ({ name: s.name, data: s.data })),
      {
        yFormatter: (v) => `${v.toFixed(v >= 100 ? 0 : 2)} ${unit}`,
        axisFormatter: (v) => `${v} ${unit}`,
      },
    );
    return {
      ...base,
      animation: false,
      color: list.map((s) => s.color),
      series: list.map((s) => ({
        name: s.name,
        type: "line" as const,
        showSymbol: false,
        smooth: true,
        data: s.data,
        lineStyle: s.thin ? { width: 1, opacity: 0.35 } : { width: 1.75 },
        areaStyle: !s.thin && list.length <= 2 ? { opacity: 0.06 } : undefined,
        z: s.thin ? 1 : 2,
      })),
    };
  }, [all, streams]);

  return (
    <div style={{ height }} className="w-full">
      <ChartHost option={option} />
    </div>
  );
}

function Stat({ label, value, swatch }: { label: string; value: string; swatch?: "read" | "write" }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="flex items-center gap-1.5 text-xs text-muted">
        {swatch === "write" ? <span aria-hidden className="h-0.5 w-3 bg-io-write" /> : null}
        {swatch === "read" ? <span aria-hidden className="h-0.5 w-3 bg-io-read" /> : null}
        {label}
      </span>
      <span className="truncate text-base font-semibold text-ink tabular-nums">{value}</span>
    </div>
  );
}

/** 指标条：当前 / 平均 / 峰值，TCP 加重传与 RTT，UDP 加抖动与丢包 */
export function StatStrip({
  samples,
  summary,
  protocol,
  fallbackRtt,
}: {
  samples: speedtest.Sample[];
  summary?: speedtest.Summary | null;
  protocol: string;
  fallbackRtt?: number;
}) {
  const live = samples.filter((s) => !s.omitted);
  const last = samples[samples.length - 1];
  const mean = (pick: (s: speedtest.Sample) => number) =>
    live.length ? live.reduce((acc, s) => acc + pick(s), 0) / live.length : 0;
  const peak = (pick: (s: speedtest.Sample) => number) => live.reduce((acc, s) => Math.max(acc, pick(s)), 0);

  const avgAB = summary?.ab || mean((s) => s.ab);
  const avgBA = summary?.ba || mean((s) => s.ba);
  const peakAB = summary?.peakAB || peak((s) => s.ab);
  const peakBA = summary?.peakBA || peak((s) => s.ba);
  const hasAB = avgAB > 0 || (last?.ab || 0) > 0;
  const hasBA = avgBA > 0 || (last?.ba || 0) > 0;
  const retrans = summary ? summary.retransmits : live.reduce((acc, s) => acc + (s.retransmits || 0), 0);
  const rtt = summary?.rttMs || last?.rttMs || fallbackRtt || 0;
  const jitter = summary?.jitterMs || last?.jitterMs || 0;
  const lost = summary ? summary.lostPct : last?.lostPct || 0;

  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(120px,1fr))] gap-card">
      {hasAB || !hasBA ? (
        <>
          {summary ? null : <Stat label="A→B 当前" value={formatBps(last?.ab)} swatch="write" />}
          <Stat label="A→B 平均" value={formatBps(avgAB)} swatch={summary ? "write" : undefined} />
          <Stat label="A→B 峰值" value={formatBps(peakAB)} />
        </>
      ) : null}
      {hasBA ? (
        <>
          {summary ? null : <Stat label="B→A 当前" value={formatBps(last?.ba)} swatch="read" />}
          <Stat label="B→A 平均" value={formatBps(avgBA)} swatch={summary ? "read" : undefined} />
          <Stat label="B→A 峰值" value={formatBps(peakBA)} />
        </>
      ) : null}
      {protocol === "udp" ? (
        <>
          <Stat label="抖动" value={formatMs(jitter)} />
          <Stat label="丢包" value={`${(lost || 0).toFixed(2)}%`} />
        </>
      ) : (
        <>
          <Stat label="重传" value={String(retrans || 0)} />
          <Stat label="RTT" value={formatMs(rtt)} />
        </>
      )}
    </div>
  );
}
