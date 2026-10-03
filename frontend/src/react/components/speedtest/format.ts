import type { speedtest } from "@/api";

export const LOCAL_ID = "@local";

/** bit/s 自动换算为 Kbps / Mbps / Gbps（十进制，与 iperf3 一致） */
export function formatBps(bps: number | undefined, digits = 1): string {
  const v = Number(bps) || 0;
  if (v <= 0) return "—";
  if (v >= 1e9) return `${(v / 1e9).toFixed(digits + 1)} Gbps`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(digits)} Mbps`;
  return `${(v / 1e3).toFixed(digits)} Kbps`;
}

/** 图表纵轴：按最大值选单位，返回除数与单位名 */
export function pickBpsScale(maxBps: number): { divisor: number; unit: string } {
  if (maxBps >= 1e9) return { divisor: 1e9, unit: "Gbps" };
  if (maxBps >= 1e6 || maxBps <= 0) return { divisor: 1e6, unit: "Mbps" };
  return { divisor: 1e3, unit: "Kbps" };
}

export function formatMs(ms: number | undefined): string {
  const v = Number(ms) || 0;
  if (v <= 0) return "—";
  return v < 1 ? `${v.toFixed(2)} ms` : `${v.toFixed(1)} ms`;
}

export const RELATION_LABEL: Record<string, string> = {
  same: "同网段",
  routed: "跨网段内网",
  overlay: "虚拟内网",
  public: "公网",
  nat: "出口 IP（可能 NAT）",
};

export const DIRECTION_LABEL: Record<string, string> = {
  forward: "正向 A→B",
  reverse: "反向 B→A",
  bidir: "双向",
};

export function endpointLabel(id: string): string {
  return id === LOCAL_ID ? "本机" : id;
}

export function addrText(a: speedtest.Addr | null | undefined): string {
  if (!a) return "";
  return a.prefix > 0 ? `${a.ip}/${a.prefix}` : a.ip;
}

/** 参数摘要：TCP · 4 并发 · 10 秒 · 正向 */
export function paramsText(p: speedtest.Params): string {
  const parts = [
    (p.protocol || "tcp").toUpperCase(),
    `${p.parallel} 并发`,
    `${p.duration} 秒`,
    DIRECTION_LABEL[p.direction] || p.direction,
  ];
  if (p.protocol === "udp") {
    parts.push(p.udpBandwidthMbps > 0 ? `目标 ${p.udpBandwidthMbps} Mbps` : "不限速");
  }
  return parts.join(" · ");
}

export function formatTime(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** 两机结果的纯文本（复制用） */
export function summaryText(opts: {
  a: string;
  b: string;
  params: speedtest.Params;
  path?: speedtest.Candidate | null;
  summary?: speedtest.Summary | null;
}): string {
  const { a, b, params, path, summary } = opts;
  const lines = [
    `网络测速 ${endpointLabel(a)} ⇄ ${endpointLabel(b)}`,
    `参数：${paramsText(params)}`,
  ];
  if (path) {
    lines.push(`路径：${RELATION_LABEL[path.relation] || path.relation} ${path.target.ip}`);
  }
  if (summary) {
    if (summary.ab > 0) lines.push(`A→B 平均 ${formatBps(summary.ab)}，峰值 ${formatBps(summary.peakAB)}`);
    if (summary.ba > 0) lines.push(`B→A 平均 ${formatBps(summary.ba)}，峰值 ${formatBps(summary.peakBA)}`);
    if (summary.rttMs > 0) lines.push(`RTT ${formatMs(summary.rttMs)}`);
    if (params.protocol === "udp") {
      lines.push(`抖动 ${formatMs(summary.jitterMs)}，丢包 ${summary.lostPct.toFixed(2)}%`);
    } else {
      lines.push(`重传 ${summary.retransmits}`);
    }
  }
  return lines.join("\n");
}

export function defaultParams(duration = 10): speedtest.Params {
  return {
    protocol: "tcp",
    parallel: 4,
    duration,
    direction: "forward",
    udpBandwidthMbps: 1000,
    port: 0,
    omit: 1,
    windowKB: 0,
    mss: 0,
    congestion: "",
    interval: 1,
  };
}
