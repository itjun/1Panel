import type { speedtest } from "@/api";
import { formatBps, formatMs, linkSpeedText } from "./format";

export type Grade = "great" | "good" | "fair" | "poor";
export type PointTone = "ok" | "warn" | "danger" | "info";
export type VerdictPoint = { tone: PointTone; text: string };
export type Verdict = { grade: Grade; label: string; headline: string; points: VerdictPoint[] };

export const GRADE_LABEL: Record<Grade, string> = { great: "很快", good: "正常", fair: "偏慢", poor: "很差" };
export const GRADE_TONE: Record<Grade, "ok" | "info" | "warn" | "danger"> = {
  great: "ok",
  good: "info",
  fair: "warn",
  poor: "danger",
};
const GRADE_ORDER: Grade[] = ["great", "good", "fair", "poor"];
/** 超过任何常见物理网卡（万兆）且远超已知网卡上限时，视为同宿主机内部转发 */
const VIRTUAL_MBPS = 12000;

function worse(a: Grade, b: Grade): Grade {
  return GRADE_ORDER[Math.max(GRADE_ORDER.indexOf(a), GRADE_ORDER.indexOf(b))];
}

function bytesText(bps: number): string {
  const B = bps / 8;
  if (B >= 1e9) return `${(B / 1e9).toFixed(1)} GB`;
  if (B >= 1e6) return `${(B / 1e6).toFixed(B >= 1e7 ? 0 : 1)} MB`;
  return `${(B / 1e3).toFixed(0)} KB`;
}

function durationText(sec: number): string {
  if (sec < 1) return "不到 1 秒";
  if (sec < 60) return `约 ${Math.round(sec)} 秒`;
  if (sec < 3600) return `约 ${Math.round(sec / 60)} 分钟`;
  return `约 ${(sec / 3600).toFixed(1)} 小时`;
}

function speedGrade(mbps: number, lan: boolean): Grade {
  if (lan) return mbps >= 900 ? "great" : mbps >= 500 ? "good" : mbps >= 100 ? "fair" : "poor";
  return mbps >= 500 ? "great" : mbps >= 100 ? "good" : mbps >= 20 ? "fair" : "poor";
}

/**
 * 把一次测速结果翻译成大白话：等级 + 一句结论 + 逐条解释。
 * 方向取慢的那一边定级，有网卡协商速率时按「用到了网卡上限的几成」评，否则按经验阈值。
 */
export function evaluate(opts: {
  summary?: speedtest.Summary | null;
  protocol: string;
  path?: speedtest.Candidate | null;
  params?: speedtest.Params | null;
}): Verdict | null {
  const { summary: s, protocol, path, params } = opts;
  if (!s) return null;
  const udp = protocol === "udp";
  const dirs = [
    { name: "A→B", bps: s.ab || 0 },
    { name: "B→A", bps: s.ba || 0 },
  ].filter((d) => d.bps > 0);
  if (dirs.length === 0) {
    return {
      grade: "poor",
      label: GRADE_LABEL.poor,
      headline: "没有测到任何数据",
      points: [{ tone: "danger", text: "两台机器之间没传过去数据，可能是防火墙拦截或连接中途断开，换个端口或检查防火墙后再试。" }],
    };
  }

  const slow = dirs.reduce((m, d) => (d.bps < m.bps ? d : m));
  const fast = dirs.reduce((m, d) => (d.bps > m.bps ? d : m));
  const mbps = slow.bps / 1e6;
  const lan = path ? path.kind === "lan" : true;
  const link = lan ? path?.linkMbps || 0 : 0;
  const points: VerdictPoint[] = [];
  let grade: Grade;

  // 速度
  if (mbps >= VIRTUAL_MBPS && lan && (!link || mbps > link * 1.3)) {
    grade = "great";
    points.push({
      tone: "info",
      text: `速度${link ? `超过了网卡上限（${linkSpeedText(link)}）` : "超过了万兆网卡的极限"}，说明数据根本没走网线：两台很可能是同一台宿主机上的虚拟机 / 容器，测的是机器内部的虚拟网络，不代表真实网络。`,
    });
  } else if (link) {
    const ratio = mbps / link;
    const pct = Math.min(100, Math.round(ratio * 100));
    const nic = `${linkSpeedText(link)} 网卡`;
    if (ratio >= 0.85) {
      grade = "great";
      points.push({ tone: "ok", text: `已经跑满了 ${nic}（用到 ${pct}%），网络没有瓶颈。想更快只能换更快的网卡和交换机。` });
    } else if (ratio >= 0.6) {
      grade = "good";
      points.push({ tone: "ok", text: `用到了 ${nic}的 ${pct}%，属于正常水平，日常使用感觉不到差别。` });
    } else if (ratio >= 0.3) {
      grade = "fair";
      points.push({ tone: "warn", text: `只用到 ${nic}的 ${pct}%，有一半左右的速度没发挥出来。` });
    } else {
      grade = "poor";
      points.push({ tone: "danger", text: `只用到 ${nic}的 ${pct}%，远低于应有的速度，中间链路很可能有问题。` });
    }
  } else {
    grade = speedGrade(mbps, lan);
    const ref = lan
      ? { great: "千兆内网已经跑满", good: "达到千兆内网的一半以上，够用", fair: "对内网来说偏慢，千兆网线应能跑到 900 Mbps 以上", poor: "对内网来说非常慢，正常千兆内网能到 900 Mbps 以上" }
      : { great: "公网速度很快，大文件传输没压力", good: "公网速度正常，日常同步、备份够用", fair: "公网速度偏慢，传大文件要耐心等", poor: "公网速度很慢，只适合传小文件" };
    points.push({ tone: grade === "great" || grade === "good" ? "ok" : grade === "fair" ? "warn" : "danger", text: `${ref[grade]}。` });
  }

  // UDP 被目标带宽封顶
  const target = params?.udpBandwidthMbps || 0;
  if (udp && target > 0 && fast.bps / 1e6 >= target * 0.9 && (!link || target < link * 0.9)) {
    points.push({ tone: "info", text: `UDP 是按设定的目标带宽（${target} Mbps）发送的，结果被这个值封顶了，实际上限可能更高；想测极限请调高目标带宽或改用 TCP。` });
  }

  // 双向差异
  if (dirs.length === 2 && slow.bps / fast.bps < 0.6) {
    points.push({
      tone: "warn",
      text: `两个方向差距很大（${fast.name} ${formatBps(fast.bps)}，${slow.name} ${formatBps(slow.bps)}），慢的那个方向可能是某一端网卡、网线或上行带宽受限。`,
    });
    grade = worse(grade, "good");
  }

  // 稳定性
  if (udp) {
    const lost = s.lostPct || 0;
    const atLimit = link > 0 && target >= link * 0.9;
    if (lost < 0.1) points.push({ tone: "ok", text: "几乎不丢包，传输很稳。" });
    else if (lost < 1) points.push({ tone: "ok", text: `丢包 ${lost.toFixed(2)}%，很轻微${atLimit ? "（目标带宽顶到了网卡上限，有少量丢包是正常的）" : ""}。` });
    else if (lost < 5) {
      points.push({ tone: "warn", text: `丢包 ${lost.toFixed(2)}%，视频通话、远程桌面这类实时应用可能会卡顿${atLimit ? "；目标带宽已顶到网卡上限，调低一点再测可排除这个因素" : ""}。` });
      grade = worse(grade, "good");
    } else {
      points.push({ tone: "danger", text: `丢包 ${lost.toFixed(2)}%，很严重，实时应用基本没法用${atLimit ? "；目标带宽已顶到网卡上限，可先调低再测" : ""}。` });
      grade = worse(grade, "fair");
    }
    const jitter = s.jitterMs || 0;
    if (jitter >= 30) {
      points.push({ tone: "danger", text: `抖动 ${formatMs(jitter)}，延迟忽高忽低，语音、视频会断断续续。` });
      grade = worse(grade, "fair");
    } else if (jitter >= 10) points.push({ tone: "warn", text: `抖动 ${formatMs(jitter)}，略有起伏。` });
  } else {
    const retrans = s.retransmits || 0;
    const rate = retrans / Math.max(1, s.seconds || params?.duration || 1);
    if (retrans === 0) points.push({ tone: "ok", text: "没有重传，数据一次就送到了，连接很稳。" });
    else if (rate < 50) points.push({ tone: "ok", text: `偶尔重传（共 ${retrans} 次），属于正常现象。` });
    else if (rate < 500) {
      points.push({ tone: "warn", text: `重传较多（共 ${retrans} 次），链路上有轻微丢包或拥堵，速度会有波动。` });
      grade = worse(grade, "good");
    } else {
      points.push({ tone: "danger", text: `重传非常多（共 ${retrans} 次），链路丢包严重，速度会忽快忽慢。` });
      grade = worse(grade, "fair");
    }
  }

  // 延迟
  const rtt = s.rttMs || path?.rttMs || 0;
  if (rtt > 0) {
    const t = formatMs(rtt);
    if (lan) {
      if (rtt < 1) points.push({ tone: "ok", text: `延迟 ${t}，非常低，操作几乎没有等待感。` });
      else if (rtt < 5) points.push({ tone: "ok", text: `延迟 ${t}，内网正常水平。` });
      else points.push({ tone: "warn", text: `延迟 ${t}，对内网来说偏高，数据可能绕了路或中间设备很忙。` });
    } else if (rtt < 30) points.push({ tone: "ok", text: `延迟 ${t}，很低，远程操作很跟手。` });
    else if (rtt < 100) points.push({ tone: "ok", text: `延迟 ${t}，一般，远程操作能用。` });
    else points.push({ tone: "warn", text: `延迟 ${t}，偏高，远程敲命令会感觉慢半拍。` });
  }

  // CPU 瓶颈
  const cpu = Math.max(s.cpuClient || 0, s.cpuServer || 0);
  if (cpu >= 90) {
    points.push({ tone: "warn", text: `测速时有一端 CPU 占用到了 ${Math.round(cpu)}%，机器自己忙不过来，速度可能是被 CPU 拖慢的，而不是网络慢。` });
  }

  // 建议
  if (grade === "fair" || grade === "poor") {
    if (!udp && (params?.parallel || 0) < 4) points.push({ tone: "info", text: "建议把并发数调到 4–8 再测一次，单条连接往往跑不满带宽。" });
    if (lan && !link) points.push({ tone: "info", text: "没读到网卡速率（可能是无线网或虚拟网卡），无线速度波动大，建议插网线再测。" });
    else if (lan) points.push({ tone: "info", text: "可以检查网线（建议超五类及以上）、交换机端口，以及两端网卡是否协商到了应有的速率。" });
  }

  const tenGB = (10 * 8e9) / slow.bps;
  return {
    grade,
    label: GRADE_LABEL[grade],
    headline: `每秒能传约 ${bytesText(slow.bps)}，一个 10 GB 的文件${durationText(tenGB)}传完`,
    points,
  };
}
