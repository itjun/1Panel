import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api } from "@/api";
import type { monitor } from "@/api";
import { Button } from "@/react/components/ui/button";
import { Card } from "@/react/components/ui/card";
import { Checkbox } from "@/react/components/ui/checkbox";
import { Tag, type TagTone } from "@/react/components/ui/tag";
import { FlashNotices, Notice, Page } from "@/react/components/page";
import { useFlashMessage, type FlashMessage } from "@/react/lib/use-flash-message";
import { cn, readThemeColor, seriesColorList } from "@/react/lib/utils";
import { ChartHost } from "@/react/components/monitor/charts";
import type * as echarts from "echarts";
import { copyText } from "@/utils/clipboard";
import { bytesToKBps, formatBytes, formatErr, formatRateKBps } from "@/utils/format";

const IP_COLLAPSE_LIMIT = 3;
const PAGE_SIZE = 100;

type IpGroupKey = "private" | "public" | "docker";

function pureIp(raw: string): string {
  if (!raw) return "";
  const noParen = raw.split("(")[0].trim();
  return noParen.split("/")[0].trim();
}

function uniqIps(list: string[] | undefined | null): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of list || []) {
    const ip = pureIp(raw);
    if (!ip || seen.has(ip)) continue;
    seen.add(ip);
    out.push(ip);
  }
  return out;
}

function ConnState({ state }: { state: string }) {
  const s = (state || "").toUpperCase();
  let tone: TagTone = "neutral";
  if (s === "ESTABLISHED" || s === "ESTAB") {
    tone = "ok";
  } else if (s === "LISTEN" || s === "LISTENING") {
    tone = "info";
  } else if (s.includes("WAIT") || s === "CLOSE" || s === "CLOSED") {
    tone = "warn";
  }
  return (
    <Tag tone={tone} className="font-mono">
      {state || "—"}
    </Tag>
  );
}

function IfaceState({ state }: { state: string }) {
  const up = (state || "").toUpperCase() === "UP";
  return <Tag tone={up ? "ok" : "neutral"}>{state || "—"}</Tag>;
}

function kindLabel(k: string) {
  if (k === "physical") return "物理";
  if (k === "docker") return "Docker";
  if (k === "virtual") return "虚拟";
  if (k === "loopback") return "回环";
  if (k === "other") return "其他";
  return k || "—";
}

function ifaceIpv4List(list: string[] | undefined | null): string[] {
  return (list || []).map((x) => pureIp(x)).filter(Boolean);
}

type ListenScope = "all" | "local" | "specific";

/** 按最后一个冒号拆出主机与端口，兼容 [::]:22、127.0.0.53%lo:53、*:80 */
function splitHostPort(addr: string): { host: string; port: string } {
  const raw = (addr || "").trim();
  const idx = raw.lastIndexOf(":");
  if (idx < 0) return { host: raw, port: "" };
  return { host: raw.slice(0, idx), port: raw.slice(idx + 1) };
}

function listenScope(host: string): ListenScope {
  const bare = host.replace(/^\[/, "").replace(/\]$/, "").split("%")[0];
  if (bare === "" || bare === "*" || bare === "0.0.0.0" || bare === "::") return "all";
  if (bare.startsWith("127.") || bare === "::1") return "local";
  return "specific";
}

function ListenScopeTag({ scope }: { scope: ListenScope }) {
  if (scope === "all") return <Tag tone="info">所有网卡</Tag>;
  if (scope === "local") return <Tag>仅本机</Tag>;
  return <Tag>指定地址</Tag>;
}

type ColumnHeader = {
  key: string;
  label: string;
  /** 数值列右对齐（DESIGN.md §4.4） */
  align?: "right";
  /** 地址、MAC 等需要纵向对齐的列用等宽字体 */
  mono?: boolean;
  /** 表头悬停说明 */
  tip?: string;
};

const RX_TIP =
  "流入：从外面进到这台机器的数据。比如用户访问时发来的请求、nginx 从后端服务拿回来的内容";
const TX_TIP =
  "流出：从这台机器发出去的数据。比如把网页、接口结果返回给用户；云服务器按流量收费，一般收的就是流出";
const TRAFFIC_VERDICT_TIP =
  "判断方法：拿最近 3 天的流入 : 流出比例，和过去 30 天每天比例的中位数（平时水平）比。偏离 1.6 倍标橙，偏离 2.5 倍标红；比例正常时再看近 7 天总量比前 7 天涨跌超过一半没有";
const TRAFFIC_USAGE_TIP =
  "这台机器主网卡（通常是 eth0）在一段时间里流入和流出的数据总量；包含内网机器之间的传输，不含机器自己跟自己的通信（lo）";

function SimpleRows({
  headers,
  rows,
}: {
  headers: ColumnHeader[];
  rows: { id: string; cells: ReactNode[]; className?: string }[];
}) {
  return (
    <div className="surface-float overflow-auto">
      <table className="w-full border-collapse text-left text-sm">
        <thead className="sticky top-0 z-[1] bg-surface text-xs font-normal text-muted">
          <tr className="h-table-head border-b border-line">
            {headers.map((header) => (
              <th
                key={header.key}
                className={cn("px-3 font-normal", header.align === "right" && "text-right")}
              >
                {header.tip ? (
                  <span
                    data-tip={header.tip}
                    className="cursor-help underline decoration-dotted underline-offset-4"
                  >
                    {header.label}
                  </span>
                ) : (
                  header.label
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr className="h-table-row">
              <td className="px-3 text-muted" colSpan={headers.length || 1}>
                暂无数据
              </td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr
                key={row.id}
                className={row.className || "h-table-row border-t border-line hover:bg-raised"}
              >
                {row.cells.map((cell, index) => {
                  const header = headers[index];
                  return (
                    <td
                      key={index}
                      className={cn(
                        "max-w-[360px] truncate px-3 align-middle",
                        header?.align === "right" && "text-right tabular-nums",
                        header?.mono && "font-mono",
                      )}
                    >
                      {cell}
                    </td>
                  );
                })}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

function IpCopyButton({
  ip,
  tag,
  flash,
}: {
  ip: string;
  tag?: string;
  flash: FlashMessage;
}) {
  return (
    <button
      type="button"
      data-tip={`点击复制 ${ip}`}
      className="-mx-2 inline-flex max-w-full items-center gap-2 rounded-control px-2 py-1 text-left hover:bg-raised"
      onClick={() => {
        void copyText(ip)
          .then(() => flash.showToast(`已复制 ${ip}`))
          .catch((e) => flash.showError(`复制失败: ${formatErr(e)}`));
      }}
    >
      {tag ? <Tag tone="accent">{tag}</Tag> : null}
      <span className="min-w-0 truncate font-mono text-sm">{ip}</span>
    </button>
  );
}

function AddressField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-xs text-muted">{label}</div>
      <div className="mt-1 flex flex-col items-start">{children}</div>
    </div>
  );
}

function IpList({
  ips,
  expanded,
  onToggle,
  flash,
}: {
  ips: string[];
  expanded: boolean;
  onToggle: () => void;
  flash: FlashMessage;
}) {
  if (!ips.length) {
    return <span className="py-1 text-sm text-muted">—</span>;
  }
  const visible =
    expanded || ips.length <= IP_COLLAPSE_LIMIT ? ips : ips.slice(0, IP_COLLAPSE_LIMIT);
  const hasMore = ips.length > IP_COLLAPSE_LIMIT;
  return (
    <>
      {visible.map((ip) => (
        <IpCopyButton key={ip} ip={ip} flash={flash} />
      ))}
      {hasMore ? (
        <button
          type="button"
          className="-mx-2 rounded-control px-2 py-1 text-xs text-accent hover:bg-raised"
          onClick={onToggle}
        >
          {expanded ? "收起" : `+${ips.length - IP_COLLAPSE_LIMIT}`}
        </button>
      ) : null}
    </>
  );
}

const AGG_BUCKET_SEC = 300;
/** agent Range 超过 2000 桶（约 6.9 天）会抽样，按 6 天分段请求才能拿到全部桶 */
const TRAFFIC_CHUNK_SEC = 6 * 86400;
const TRAFFIC_REFRESH_MS = 5 * 60 * 1000;
const TRAFFIC_CHART_DAYS = 15;
/** 判断「平时比例」用的天数（完整自然日） */
const TRAFFIC_BASELINE_DAYS = 30;
const TRAFFIC_MIN_BASELINE_DAYS = 7;
/** 最近几天的比例偏离平时多少倍算「偏多」「激增」 */
const RATIO_WARN_FACTOR = 1.6;
const RATIO_DANGER_FACTOR = 2.5;
/** 近 7 天总量低于此值视为几乎无流量 */
const TRAFFIC_QUIET_BYTES = 100 * 1024 * 1024;

type TrafficVerdict = { tone: TagTone; label: string; detail: string };
type TrafficRole = { label: string; detail: string };
type DayMark = { tone: TagTone; label: string } | null;

/** 流入 : 流出，统一写成大数在前的「x : 1」或「1 : x」 */
function formatRatio(ratio: number): string {
  if (!Number.isFinite(ratio) || ratio <= 0) return "—";
  if (ratio >= 1) return `${ratio.toFixed(1)} : 1`;
  return `1 : ${(1 / ratio).toFixed(1)}`;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid];
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

/** 按「比例偏离平时的倍数」给出单日标记；比例正常返回 null */
function markByRatio(ratio: number, baseline: number): DayMark {
  const dev = ratio / baseline;
  if (dev >= RATIO_DANGER_FACTOR) return { tone: "danger", label: "流入激增" };
  if (dev >= RATIO_WARN_FACTOR) return { tone: "warn", label: "流入偏多" };
  if (dev <= 1 / RATIO_DANGER_FACTOR) return { tone: "danger", label: "流出激增" };
  if (dev <= 1 / RATIO_WARN_FACTOR) return { tone: "warn", label: "流出偏多" };
  return null;
}

function judgeRole(inBytes: number, outBytes: number): TrafficRole {
  const ratio = outBytes > 0 ? inBytes / outBytes : Number.POSITIVE_INFINITY;
  if (ratio > 1.5) {
    return {
      label: "流入型",
      detail: "收进来的比发出去的多，像数据库、日志收集、备份目标、下载任务这类机器",
    };
  }
  if (ratio < 1 / 1.5) {
    return {
      label: "流出型",
      detail: "发出去的比收进来的多，像网站源站、文件下载、对外接口这类机器",
    };
  }
  return {
    label: "转发型",
    detail: "流入和流出差不多，像 nginx 反向代理、网关这类转发数据的机器",
  };
}

/**
 * 综合判断：先看最近 3 个完整日的流入流出比例是否偏离平时（中位数），
 * 比例正常再看近 7 天总量相对前 7 天的涨跌。
 */
function judgeTraffic(
  fullIn: number[],
  fullOut: number[],
  weekChange: number | null,
): { verdict: TrafficVerdict; baseline: number } {
  const days = fullIn.length;
  if (days < TRAFFIC_MIN_BASELINE_DAYS) {
    return {
      verdict: {
        tone: "neutral",
        label: "数据不足",
        detail: `至少需要 ${TRAFFIC_MIN_BASELINE_DAYS} 天完整数据才能判断，目前只有 ${days} 天`,
      },
      baseline: 0,
    };
  }

  let in7 = 0;
  let out7 = 0;
  for (let i = days - 7; i < days; i += 1) {
    in7 += fullIn[i];
    out7 += fullOut[i];
  }
  if (in7 + out7 < TRAFFIC_QUIET_BYTES) {
    return {
      verdict: {
        tone: "neutral",
        label: "几乎无流量",
        detail: "近 7 天流量不到 100 MB，机器可能闲置，或者服务没在运行",
      },
      baseline: 0,
    };
  }

  const ratios: number[] = [];
  for (let i = 0; i < days; i += 1) {
    if (fullIn[i] > 0 && fullOut[i] > 0) ratios.push(fullIn[i] / fullOut[i]);
  }
  const baseline = ratios.length ? median(ratios) : 1;

  let in3 = 0;
  let out3 = 0;
  for (let i = days - 3; i < days; i += 1) {
    in3 += fullIn[i];
    out3 += fullOut[i];
  }
  const recent = out3 > 0 ? in3 / out3 : Number.POSITIVE_INFINITY;
  const ratioText = `最近 3 天流入 : 流出为 ${formatRatio(recent)}，平时约 ${formatRatio(baseline)}。`;
  const mark = markByRatio(recent, baseline);
  if (mark?.label === "流入激增") {
    return {
      verdict: {
        tone: "danger",
        label: "流入激增",
        detail: `${ratioText}收进来的数据比平时多很多，检查是否被攻击、接口被刷或有人在大量上传`,
      },
      baseline,
    };
  }
  if (mark?.label === "流入偏多") {
    return {
      verdict: {
        tone: "warn",
        label: "流入偏多",
        detail: `${ratioText}收进来的数据比平时多，留意有没有异常请求或上传任务`,
      },
      baseline,
    };
  }
  if (mark?.label === "流出激增") {
    return {
      verdict: {
        tone: "danger",
        label: "流出激增",
        detail: `${ratioText}发出去的数据比平时多很多，检查是否有大文件被频繁下载、数据被拖走，或机器被入侵后在对外发包`,
      },
      baseline,
    };
  }
  if (mark?.label === "流出偏多") {
    return {
      verdict: {
        tone: "warn",
        label: "流出偏多",
        detail: `${ratioText}发出去的数据比平时多，留意有没有大文件下载或缓存命中变化`,
      },
      baseline,
    };
  }

  if (weekChange !== null && weekChange >= 1) {
    return {
      verdict: {
        tone: "warn",
        label: "流量翻倍",
        detail: `比例正常，但近 7 天总量是前 7 天的 ${(1 + weekChange).toFixed(1)} 倍，确认是业务增长还是异常请求`,
      },
      baseline,
    };
  }
  if (weekChange !== null && weekChange >= 0.5) {
    return {
      verdict: {
        tone: "info",
        label: "流量上涨",
        detail: `比例正常，近 7 天总量比前 7 天多了 ${Math.round(weekChange * 100)}%`,
      },
      baseline,
    };
  }
  if (weekChange !== null && weekChange <= -0.5) {
    return {
      verdict: {
        tone: "info",
        label: "流量下降",
        detail: `比例正常，但近 7 天总量比前 7 天少了 ${Math.round(-weekChange * 100)}%，确认服务是否正常、有没有掉线`,
      },
      baseline,
    };
  }
  return {
    verdict: {
      tone: "ok",
      label: "正常",
      detail: `流入流出比例和平时一样（约 ${formatRatio(baseline)}），总量也稳定`,
    },
    baseline,
  };
}

type TrafficBucket = { ts: number; rxBytes: number; txBytes: number };

async function loadTrafficBuckets(host: string, from: number, to: number): Promise<TrafficBucket[]> {
  const chunks: [number, number][] = [];
  for (let start = from; start < to; start += TRAFFIC_CHUNK_SEC) {
    chunks.push([start, Math.min(start + TRAFFIC_CHUNK_SEC, to)]);
  }
  const results = await Promise.all(
    chunks.map(([start, end]) => api.agentRange(host, start, end, "agg")),
  );
  // 相邻分段边界上的桶会重复，按 ts 去重
  const byTs = new Map<number, TrafficBucket>();
  for (const r of results) {
    for (const p of r.points || []) {
      byTs.set(p.ts, {
        ts: p.ts,
        rxBytes: (p.netRxKBps || 0) * AGG_BUCKET_SEC * 1024,
        txBytes: (p.netTxKBps || 0) * AGG_BUCKET_SEC * 1024,
      });
    }
  }
  return [...byTs.values()].sort((a, b) => a.ts - b.ts);
}

function formatMonthDay(sec: number): string {
  const d = new Date(sec * 1000);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${mm}-${dd}`;
}

function formatHourMinute(sec: number): string {
  const d = new Date(sec * 1000);
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mi}`;
}

function TrafficUsage({ host }: { host: string }) {
  const query = useQuery({
    queryKey: ["traffic-usage", host],
    queryFn: () => {
      const now = new Date();
      const nowSec = Math.floor(now.getTime() / 1000);
      const monthStart = Math.floor(new Date(now.getFullYear(), now.getMonth(), 1).getTime() / 1000);
      const baselineStart = Math.floor(
        new Date(now.getFullYear(), now.getMonth(), now.getDate() - TRAFFIC_BASELINE_DAYS).getTime() /
          1000,
      );
      const from = Math.min(monthStart, baselineStart);
      return loadTrafficBuckets(host, from, nowSec);
    },
    refetchInterval: TRAFFIC_REFRESH_MS,
  });

  const usage = useMemo(() => {
    const buckets = query.data || [];
    const now = new Date();
    const nowSec = Math.floor(now.getTime() / 1000);
    const todayStart = Math.floor(
      new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() / 1000,
    );
    const monthStart = Math.floor(new Date(now.getFullYear(), now.getMonth(), 1).getTime() / 1000);
    const earliest = buckets.length ? buckets[0].ts : 0;
    const latestEnd = buckets.length ? buckets[buckets.length - 1].ts + AGG_BUCKET_SEC : 0;

    const windows = [
      { key: "today", label: "今天", from: todayStart },
      { key: "7d", label: "近 7 天", from: nowSec - 7 * 86400 },
      { key: "month", label: "本月", from: monthStart },
      { key: "30d", label: "近 30 天", from: nowSec - 30 * 86400 },
    ].map((w) => {
      let rx = 0;
      let tx = 0;
      for (const b of buckets) {
        if (b.ts < w.from) continue;
        rx += b.rxBytes;
        tx += b.txBytes;
      }
      return { ...w, rx, tx, partial: earliest > w.from };
    });

    // 近 7 天与前 7 天的环比；前 7 天数据不全时不比
    let weekChange: number | null = null;
    const prevWeekFrom = nowSec - 14 * 86400;
    const prevWeekTo = nowSec - 7 * 86400;
    if (earliest && earliest <= prevWeekFrom) {
      let prevTotal = 0;
      for (const b of buckets) {
        if (b.ts >= prevWeekFrom && b.ts < prevWeekTo) {
          prevTotal += b.rxBytes + b.txBytes;
        }
      }
      const week = windows[1];
      if (prevTotal > 0) {
        weekChange = (week.rx + week.tx - prevTotal) / prevTotal;
      }
    }

    // 按本地自然日分组（含今天）；agent 还没开始采集的日子留空，不画成 0
    const dayStarts: number[] = [];
    for (let i = TRAFFIC_BASELINE_DAYS; i >= 0; i -= 1) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
      dayStarts.push(Math.floor(d.getTime() / 1000));
    }
    const allRx: (number | null)[] = dayStarts.map(() => null);
    const allTx: (number | null)[] = dayStarts.map(() => null);
    for (const b of buckets) {
      for (let i = dayStarts.length - 1; i >= 0; i -= 1) {
        if (b.ts >= dayStarts[i]) {
          allRx[i] = (allRx[i] || 0) + b.rxBytes;
          allTx[i] = (allTx[i] || 0) + b.txBytes;
          break;
        }
      }
    }

    // 判定只用完整日：去掉今天；agent 开始采集的第一天多半不满一天，也去掉
    const fullIn: number[] = [];
    const fullOut: number[] = [];
    const firstDataDay = allRx.findIndex((v) => v !== null);
    for (let i = 0; i < dayStarts.length - 1; i += 1) {
      if (allRx[i] === null) continue;
      if (i === firstDataDay && earliest > dayStarts[i]) continue;
      fullIn.push(allRx[i] || 0);
      fullOut.push(allTx[i] || 0);
    }
    const { verdict, baseline } = judgeTraffic(fullIn, fullOut, weekChange);
    const week = windows[1];
    const role = week.rx + week.tx > 0 ? judgeRole(week.rx, week.tx) : null;

    const chartFrom = dayStarts.length - TRAFFIC_CHART_DAYS;
    const dayRx = allRx.slice(chartFrom);
    const dayTx = allTx.slice(chartFrom);
    const dayLabels = dayStarts.slice(chartFrom).map((ts, i) => {
      if (i === TRAFFIC_CHART_DAYS - 1) return "今天";
      return formatMonthDay(ts);
    });
    // 图上逐日标记偏离平时比例的日子；今天未满一天不标
    const dayMarks: DayMark[] = dayRx.map((rx, i) => {
      const tx = dayTx[i];
      if (!baseline || i === TRAFFIC_CHART_DAYS - 1 || !rx || !tx) return null;
      return markByRatio(rx / tx, baseline);
    });

    return {
      windows,
      weekChange,
      earliest,
      latestEnd,
      dayLabels,
      dayRx,
      dayTx,
      dayMarks,
      verdict,
      role,
    };
  }, [query.data]);

  const chartOption = useMemo(
    () => buildDailyTrafficOption(usage.dayLabels, usage.dayRx, usage.dayTx, usage.dayMarks),
    [usage],
  );

  let weekChangeText = "";
  if (usage.weekChange !== null) {
    const pct = Math.round(usage.weekChange * 100);
    if (pct > 0) {
      weekChangeText = `较前 7 天 ↑${pct}%`;
    } else if (pct < 0) {
      weekChangeText = `较前 7 天 ↓${-pct}%`;
    } else {
      weekChangeText = "与前 7 天持平";
    }
  }

  if (query.isLoading) {
    return <p className="text-sm text-muted">加载中…</p>;
  }
  if (query.error) {
    return <p className="text-sm text-muted">agent 未就绪，无法统计流量</p>;
  }

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Tag tone={usage.verdict.tone} title={TRAFFIC_VERDICT_TIP}>
          {usage.verdict.label}
        </Tag>
        {usage.role ? <Tag title={usage.role.detail}>{usage.role.label}</Tag> : null}
        <span className="text-sm text-muted">{usage.verdict.detail}</span>
      </div>
      <div className="gap-card grid grid-cols-2 xl:grid-cols-4">
        {usage.windows.map((w) => (
          <div key={w.key} className="min-w-0">
            <div className="text-xs text-muted">
              {w.label}
              {w.partial ? <span className="ml-2">自 {formatMonthDay(usage.earliest)} 起</span> : null}
            </div>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="font-mono text-base font-semibold text-ink">
                {formatBytes(w.rx + w.tx)}
              </span>
              {w.key === "7d" && weekChangeText ? (
                <span className="text-xs text-muted">{weekChangeText}</span>
              ) : null}
            </div>
            <div className="mt-0.5 flex gap-3 font-mono text-xs">
              <span className="text-io-read" data-tip={RX_TIP}>
                流入 {formatBytes(w.rx)}
              </span>
              <span className="text-io-write" data-tip={TX_TIP}>
                流出 {formatBytes(w.tx)}
              </span>
            </div>
          </div>
        ))}
      </div>
      <div className="mt-4 h-[220px] min-w-0">
        <ChartHost option={chartOption} />
      </div>
      <p className="mt-2 text-xs text-muted">
        近 {TRAFFIC_CHART_DAYS} 天每日流量；今天未满一天，用虚线段表示；日期标橙表示当天比例偏离平时，标红表示严重偏离。按 agent 5 分钟聚合统计
        {usage.latestEnd ? `，截至 ${formatHourMinute(usage.latestEnd)}` : ""}
      </p>
    </>
  );
}

function buildDailyTrafficOption(
  labels: string[],
  rx: (number | null)[],
  tx: (number | null)[],
  marks: DayMark[],
): echarts.EChartsOption {
  const warn = readThemeColor("--color-warn", "#d35a00");
  const danger = readThemeColor("--color-danger", "#d54941");
  const markColor = (mark: DayMark) => {
    if (mark?.tone === "danger") return danger;
    if (mark?.tone === "warn") return warn;
    return null;
  };
  const muted = readThemeColor("--color-muted", "#5c6b80");
  const line = readThemeColor("--color-line", "#dce3ee");
  const ink = readThemeColor("--color-ink", "#1b2433");
  const surface = readThemeColor("--color-surface", "#ffffff");
  const [rxColor, txColor] = seriesColorList(["流入", "流出"]);

  const last = labels.length - 1;
  // 完整日用实线；今天未满一天，单独用虚线接在昨天后面，免得看成断崖下跌
  const fullDays = (data: (number | null)[]) => data.map((v, i) => (i === last ? null : v));
  const todaySegment = (data: (number | null)[]) => data.map((v, i) => (i >= last - 1 ? v : null));

  const dot = (color: string) =>
    `<span style="display:inline-block;width:8px;height:8px;border-radius:4px;margin-right:6px;background:${color}"></span>`;

  // 同名系列在图例里一起开关：实线段与今天的虚线段共用「流入」「流出」两个名字
  const lineSeries = (name: string, color: string, data: (number | null)[]) => [
    {
      name,
      type: "line" as const,
      data: fullDays(data),
      color,
      symbol: "circle",
      symbolSize: 6,
      lineStyle: { width: 2 },
    },
    {
      name,
      type: "line" as const,
      data: todaySegment(data),
      color,
      symbol: "circle",
      symbolSize: 6,
      lineStyle: { width: 2, type: "dashed" as const },
    },
  ];

  return {
    grid: { left: 8, right: 24, top: 28, bottom: 8, containLabel: true },
    tooltip: {
      trigger: "axis",
      backgroundColor: surface,
      borderColor: line,
      textStyle: { color: ink, fontSize: 12 },
      formatter: (params) => {
        const list = Array.isArray(params) ? params : [params];
        const i = list[0]?.dataIndex ?? 0;
        const title = i === last ? "今天（未满一天）" : labels[i];
        if (rx[i] === null && tx[i] === null) return `${title}<br/>无数据`;
        const rows = [
          `${dot(rxColor)}流入 ${formatBytes(rx[i] || 0)}`,
          `${dot(txColor)}流出 ${formatBytes(tx[i] || 0)}`,
          `合计 ${formatBytes((rx[i] || 0) + (tx[i] || 0))}`,
        ];
        if (rx[i] && tx[i]) {
          rows.push(`流入 : 流出 ${formatRatio((rx[i] || 0) / (tx[i] || 1))}`);
        }
        const color = markColor(marks[i]);
        if (marks[i] && color) {
          rows.push(`<span style="color:${color}">${marks[i]?.label}，比例偏离平时</span>`);
        }
        return [title, ...rows].join("<br/>");
      },
    },
    legend: {
      top: 0,
      right: 0,
      data: ["流入", "流出"],
      textStyle: { fontSize: 12, color: muted },
    },
    xAxis: {
      type: "category",
      data: labels,
      axisLabel: {
        fontSize: 12,
        color: (_value?: string | number, index?: number) => {
          return markColor(marks[index ?? -1]) || muted;
        },
      },
      axisLine: { lineStyle: { color: line } },
      axisTick: { show: false },
      boundaryGap: false,
    },
    yAxis: {
      type: "value",
      axisLabel: { fontSize: 12, color: muted, formatter: (v: number) => formatBytes(v, 0) },
      splitLine: { lineStyle: { color: line } },
    },
    series: [...lineSeries("流入", rxColor, rx), ...lineSeries("流出", txColor, tx)],
  };
}

export function NetworkPage({ host }: { host: string }) {
  const [filter, setFilter] = useState("");
  const [onlyEstab, setOnlyEstab] = useState(false);
  const [onlySlow, setOnlySlow] = useState(false);
  const [page, setPage] = useState(1);
  const flash = useFlashMessage();
  const [ipExpanded, setIpExpanded] = useState<Record<IpGroupKey, boolean>>({
    private: false,
    public: false,
    docker: false,
  });

  const query = useQuery({
    queryKey: ["net", host],
    queryFn: () => api.collectNetwork(host),
    refetchInterval: 8000,
  });
  const snap = query.data;

  const prevBytes = useRef<{ ts: number; byName: Record<string, { rx: number; tx: number }> } | null>(
    null,
  );
  const [ifaceRates, setIfaceRates] = useState<Record<string, { rx: number; tx: number }>>({});

  // 切换主机时丢弃上一台的基准，避免跨主机求差
  useEffect(() => {
    prevBytes.current = null;
    setIfaceRates({});
  }, [host]);

  useEffect(() => {
    if (!snap || !query.dataUpdatedAt) return;
    const ts = query.dataUpdatedAt;
    const prev = prevBytes.current;
    const byName: Record<string, { rx: number; tx: number }> = {};
    const rates: Record<string, { rx: number; tx: number }> = {};
    for (const n of snap.interfaces || []) {
      const rx = n.rxBytes || 0;
      const tx = n.txBytes || 0;
      byName[n.name] = { rx, tx };
      const old = prev?.byName[n.name];
      if (prev && old && ts > prev.ts) {
        const dt = ts - prev.ts;
        rates[n.name] = { rx: bytesToKBps(rx - old.rx, dt), tx: bytesToKBps(tx - old.tx, dt) };
      }
    }
    if (prev && ts <= prev.ts) return;
    prevBytes.current = { ts, byName };
    setIfaceRates(rates);
  }, [snap, query.dataUpdatedAt]);

  const privateIPs = useMemo(() => uniqIps(snap?.privateIPs), [snap?.privateIPs]);
  const publicIPs = useMemo(() => uniqIps(snap?.publicIPs), [snap?.publicIPs]);
  const dockerIPs = useMemo(() => uniqIps(snap?.dockerIPs), [snap?.dockerIPs]);

  const listenRows = useMemo(() => {
    const rows = (snap?.connections || [])
      .filter((c) => String(c.state || "").toUpperCase().startsWith("LISTEN"))
      .map((c) => {
        const { host: bindHost, port } = splitHostPort(c.localAddr || "");
        return { conn: c, bindHost, port, scope: listenScope(bindHost) };
      });
    rows.sort((a, b) => {
      const diff = (Number(a.port) || 0) - (Number(b.port) || 0);
      if (diff !== 0) return diff;
      return a.bindHost.localeCompare(b.bindHost);
    });
    return rows;
  }, [snap?.connections]);

  const listenAllCount = listenRows.filter((r) => r.scope === "all").length;
  const listenLocalCount = listenRows.filter((r) => r.scope === "local").length;

  const filteredConns = useMemo(() => {
    let list: monitor.NetConnection[] = (snap?.connections || []).filter(
      (c) => !String(c.state || "").toUpperCase().startsWith("LISTEN"),
    );
    if (onlySlow) list = list.filter((c) => c.slow);
    if (onlyEstab) {
      list = list.filter((c) =>
        String(c.state || "")
          .toUpperCase()
          .includes("ESTAB"),
      );
    }
    const q = filter.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (c) =>
          (c.process || "").toLowerCase().includes(q) ||
          (c.localAddr || "").toLowerCase().includes(q) ||
          (c.remoteAddr || "").toLowerCase().includes(q) ||
          (c.state || "").toLowerCase().includes(q) ||
          String(c.pid).includes(q),
      );
    }
    return list;
  }, [snap?.connections, onlySlow, onlyEstab, filter]);

  const pageCount = Math.max(1, Math.ceil(filteredConns.length / PAGE_SIZE) || 1);
  const safePage = Math.min(page, pageCount);
  const pageRows = filteredConns.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  useEffect(() => {
    if (page !== safePage) setPage(safePage);
  }, [page, safePage]);

  useEffect(() => {
    setPage(1);
  }, [filter, onlyEstab, onlySlow, host]);

  function toggleIp(key: IpGroupKey) {
    setIpExpanded((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  const slowList = snap?.slowConnections || [];
  const gatewayIp = pureIp(snap?.defaultGateway || "");
  const egressIp = pureIp(snap?.egressPublicIP || "");
  const otherPublicIPs = publicIPs.filter((ip) => ip !== egressIp);
  const connNonListen = Math.max(0, (snap?.connTotal ?? 0) - (snap?.connListen ?? 0));

  return (
    <Page
      title="网络"
      actions={
        slowList.length ? <Tag tone="danger">卡顿连接 {slowList.length}</Tag> : null
      }
      onRefresh={() => void query.refetch()}
      refreshing={query.isFetching}
    >
      {query.error ? <Notice text={formatErr(query.error)} /> : null}
      <FlashNotices flash={flash} />

      {!snap && query.isLoading ? <p className="text-sm text-muted">加载中…</p> : null}

      {snap ? (
        <div className="gap-section flex flex-col">
          <Card className="p-0">
            <h3 className="mb-3 text-sm font-semibold text-ink">地址</h3>
            <div className="gap-card grid md:grid-cols-3 xl:grid-cols-5">
              <AddressField label="内网 IP">
                <IpList
                  ips={privateIPs}
                  expanded={ipExpanded.private}
                  onToggle={() => toggleIp("private")}
                  flash={flash}
                />
              </AddressField>
              <AddressField label="出口 IP">
                {egressIp ? (
                  <>
                    <IpCopyButton ip={egressIp} tag="出口" flash={flash} />
                    {snap.egressPublicLoc ? (
                      <span className="text-xs text-muted">{snap.egressPublicLoc}</span>
                    ) : null}
                  </>
                ) : (
                  <span className="py-1 text-sm text-muted">—</span>
                )}
              </AddressField>
              <AddressField label="公网 IP">
                <IpList
                  ips={otherPublicIPs}
                  expanded={ipExpanded.public}
                  onToggle={() => toggleIp("public")}
                  flash={flash}
                />
              </AddressField>
              <AddressField label="默认网关">
                {gatewayIp ? (
                  <IpCopyButton ip={gatewayIp} flash={flash} />
                ) : (
                  <span className="py-1 text-sm text-muted">—</span>
                )}
              </AddressField>
              <AddressField label="Docker 网桥">
                <IpList
                  ips={dockerIPs}
                  expanded={ipExpanded.docker}
                  onToggle={() => toggleIp("docker")}
                  flash={flash}
                />
              </AddressField>
            </div>
          </Card>

          {slowList.length ? (
            <Card className="p-0">
              <h3 className="mb-3 text-sm font-semibold text-danger">疑似网络卡顿连接</h3>
              <SimpleRows
                headers={[
                  { key: "process", label: "进程" },
                  { key: "pid", label: "PID", align: "right" },
                  { key: "local", label: "本地", mono: true },
                  { key: "remote", label: "远端", mono: true },
                  { key: "recvQ", label: "Recv-Q", align: "right" },
                  { key: "sendQ", label: "Send-Q", align: "right" },
                  { key: "rtt", label: "RTT", align: "right" },
                  { key: "reason", label: "原因" },
                ]}
                rows={slowList.map((conn, index) => ({
                  id: `slow-${index}-${conn.pid}-${conn.localAddr}-${conn.remoteAddr}`,
                  className: "h-table-row border-t border-line bg-danger-soft",
                  cells: [
                    conn.process || "—",
                    conn.pid || "—",
                    conn.localAddr || "—",
                    conn.remoteAddr || "—",
                    conn.recvQ ?? 0,
                    conn.sendQ ?? 0,
                    conn.rttMs ? `${conn.rttMs.toFixed(1)}ms` : "—",
                    conn.slowReason || "—",
                  ],
                }))}
              />
            </Card>
          ) : null}

          <Card className="p-0">
            <div className="mb-3 flex items-center gap-2">
              <h3 className="text-sm font-semibold text-ink">网卡</h3>
              <span className="text-sm text-muted">{(snap.interfaces || []).length}</span>
              <span className="ml-auto text-xs text-muted">速率为近 8 秒均值</span>
            </div>
            <SimpleRows
              headers={[
                { key: "name", label: "接口" },
                { key: "kind", label: "类型" },
                { key: "state", label: "状态" },
                { key: "mtu", label: "MTU", align: "right" },
                { key: "mac", label: "MAC", mono: true },
                { key: "ipv4", label: "IPv4", mono: true },
                { key: "rx", label: "流入", align: "right", tip: RX_TIP },
                { key: "tx", label: "流出", align: "right", tip: TX_TIP },
              ]}
              rows={(snap.interfaces || []).map((n) => ({
                id: n.name,
                cells: [
                  n.name || "—",
                  kindLabel(n.kind),
                  <IfaceState key="state" state={n.state || ""} />,
                  n.mtu || "—",
                  n.mac || "—",
                  <div key="ips" className="flex flex-col gap-0.5 whitespace-normal">
                    {ifaceIpv4List(n.ipv4).length
                      ? ifaceIpv4List(n.ipv4).map((ip) => <span key={ip}>{ip}</span>)
                      : "—"}
                  </div>,
                  <span
                    key="rx"
                    className="font-mono tabular-nums text-io-read"
                    data-tip={`开机累计 ${formatBytes(n.rxBytes || 0)}`}
                  >
                    {ifaceRates[n.name] ? formatRateKBps(ifaceRates[n.name].rx) : "—"}
                  </span>,
                  <span
                    key="tx"
                    className="font-mono tabular-nums text-io-write"
                    data-tip={`开机累计 ${formatBytes(n.txBytes || 0)}`}
                  >
                    {ifaceRates[n.name] ? formatRateKBps(ifaceRates[n.name].tx) : "—"}
                  </span>,
                ],
              }))}
            />
          </Card>

          <Card className="p-0">
            <h3 className="mb-3 text-sm font-semibold text-ink">
              <span
                data-tip={TRAFFIC_USAGE_TIP}
                className="cursor-help underline decoration-dotted underline-offset-4"
              >
                流量用量
              </span>
            </h3>
            <TrafficUsage host={host} />
          </Card>

          <Card className="p-0">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-semibold text-ink">监听端口</h3>
              <span className="text-sm text-muted">{listenRows.length}</span>
              <span className="ml-auto flex items-center gap-2">
                <Tag tone="info">所有网卡 {listenAllCount}</Tag>
                <Tag>仅本机 {listenLocalCount}</Tag>
              </span>
            </div>
            <SimpleRows
              headers={[
                { key: "port", label: "端口", align: "right" },
                { key: "bind", label: "绑定地址", mono: true },
                { key: "scope", label: "范围" },
                { key: "process", label: "进程" },
                { key: "pid", label: "PID", align: "right" },
                { key: "backlog", label: "Backlog", align: "right" },
              ]}
              rows={listenRows.map((row, index) => ({
                id: `listen-${index}-${row.conn.pid}-${row.conn.localAddr}`,
                cells: [
                  <span key="port" className="font-mono font-semibold">
                    {row.port || "—"}
                  </span>,
                  row.bindHost || "—",
                  <ListenScopeTag key="scope" scope={row.scope} />,
                  row.conn.process || "—",
                  row.conn.pid || "—",
                  row.conn.sendQ ?? 0,
                ],
              }))}
            />
          </Card>

          <Card className="p-0">
            <div className="mb-3 flex flex-wrap items-center gap-4">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold text-ink">连接</h3>
                <span className="text-sm text-muted">{connNonListen}</span>
                <span className="text-sm text-muted">
                  已建立 {snap.connEstablished ?? 0} · TIME_WAIT {snap.connTimeWait ?? 0}
                </span>
              </div>
              <input
                className="motion-field h-8 w-[220px] rounded-control px-3 text-ink"
                placeholder="过滤 进程/地址/状态..."
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              />
              <Checkbox checked={onlyEstab} onChange={setOnlyEstab}>
                只看已建立
              </Checkbox>
              <Checkbox checked={onlySlow} onChange={setOnlySlow}>
                只看卡顿
              </Checkbox>
              <span className="text-sm text-muted">共 {filteredConns.length} 条</span>
            </div>
            <SimpleRows
              headers={[
                { key: "state", label: "状态" },
                { key: "process", label: "进程" },
                { key: "pid", label: "PID", align: "right" },
                { key: "local", label: "本地地址", mono: true },
                { key: "remote", label: "远端地址", mono: true },
                { key: "recvQ", label: "Recv-Q", align: "right" },
                { key: "sendQ", label: "Send-Q", align: "right" },
                { key: "rtt", label: "RTT", align: "right" },
              ]}
              rows={pageRows.map((conn, index) => {
                const seq = (safePage - 1) * PAGE_SIZE + index + 1;
                return {
                  id: `conn-${seq}-${conn.pid}-${conn.localAddr}-${conn.remoteAddr}`,
                  className: conn.slow
                    ? "h-table-row border-t border-line bg-danger-soft"
                    : "h-table-row border-t border-line hover:bg-raised",
                  cells: [
                    <span key="state" className="inline-flex items-center gap-1">
                      <ConnState state={conn.state || ""} />
                      {conn.slow ? (
                        <Tag tone="danger" title={conn.slowReason || undefined}>
                          卡顿
                        </Tag>
                      ) : null}
                    </span>,
                    conn.process || "—",
                    conn.pid || "—",
                    conn.localAddr || "—",
                    conn.remoteAddr || "—",
                    conn.recvQ ?? 0,
                    conn.sendQ ?? 0,
                    conn.rttMs ? `${conn.rttMs.toFixed(1)}ms` : "—",
                  ],
                };
              })}
            />
            <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
              <span className="text-muted">
                第 {safePage} / {pageCount} 页 · 每页 {PAGE_SIZE} 条
              </span>
              <Button disabled={safePage <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                上一页
              </Button>
              <Button
                disabled={safePage >= pageCount}
                onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
              >
                下一页
              </Button>
            </div>
          </Card>
        </div>
      ) : null}
    </Page>
  );
}
