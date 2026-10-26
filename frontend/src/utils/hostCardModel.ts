import { fullestDisk, isDiskFull, summarizeDisks } from "@/utils/alerts";
import { usageTone, type UsageTone } from "@/react/lib/usage-tone";
import { HOST_CARD_DETAILS_STALE_MS, HOST_CARD_STALE_MS, type HostCardEntry } from "./hostCardPoller";

export type HostCardMetric = { label: string; value?: number; tone?: UsageTone; detail: string };

function knownPercent(value: number | undefined): number | undefined {
  return value != null && Number.isFinite(value) && value >= 0 ? Math.min(value, 100) : undefined;
}

function isAgentVersionOlder(current: string, bundled: string): boolean {
  const currentVersion = current.trim().replace(/^v/, "");
  const bundledVersion = bundled.trim().replace(/^v/, "");
  if (!/^\d+\.\d+\.\d+$/.test(currentVersion) || !/^\d+\.\d+\.\d+$/.test(bundledVersion)) return false;
  const currentParts = currentVersion.split(".").map(Number);
  const bundledParts = bundledVersion.split(".").map(Number);
  for (let index = 0; index < currentParts.length; index++) {
    if (currentParts[index] !== bundledParts[index]) return currentParts[index] < bundledParts[index];
  }
  return false;
}

/** 可观察状态的唯一推导处：卡片、分组计数、全页计数使用同一口径。 */
export function hostCardView(entry: HostCardEntry | undefined, now: number, latestAgentVersion = "") {
  const snapshot = entry?.snapshot;
  const isStale = !!entry && now - entry.updatedAt > HOST_CARD_STALE_MS;
  const isUnavailable = !!entry?.error || isStale;
  const error = entry?.error || (isStale ? "数据已过期，等待刷新" : snapshot?.error || "");
  const connection = isUnavailable ? "unknown" : snapshot?.connection || "unknown";
  const agentState = isUnavailable ? "unknown" : snapshot?.agentState || "unknown";
  const isDetailsStale = !entry || now - entry.detailsAt > HOST_CARD_DETAILS_STALE_MS;
  const isSampleStale = !!snapshot?.overview && now - snapshot.sampledAt * 1000 > 30000;
  const overview = !isUnavailable && !isSampleStale && !snapshot?.error && !snapshot?.overviewError ? snapshot?.overview : null;
  const disks = !isUnavailable && !snapshot?.error && !isDetailsStale && !snapshot?.diskError ? snapshot?.disks : null;
  const disk = summarizeDisks(disks);
  const isDiskDanger = isDiskFull(disks);
  const fullDisk = isDiskDanger ? fullestDisk(disks) : null;
  const diskValue = knownPercent(fullDisk && fullDisk.total > 0 ? fullDisk.used / fullDisk.total * 100 : disk?.percent);
  const pending = entry ? "暂无有效读数" : "正在采集…";
  const overviewReason = error || snapshot?.overviewError || (isSampleStale ? "采样数据已过期" : pending);
  const diskReason = error || snapshot?.diskError || (isDetailsStale && entry ? "磁盘数据已过期，等待刷新" : pending);
  const metrics: HostCardMetric[] = [
    { label: "CPU", value: knownPercent(overview?.cpuPercent), detail: overview ? `${overview.cpuCount} 核心` : overviewReason },
    { label: "内存", value: knownPercent(overview && overview.memTotal > 0 ? overview.memPercent : undefined), detail: overview ? "内存使用率" : overviewReason },
    { label: "磁盘", value: diskValue, tone: isDiskDanger ? "danger" : undefined,
      detail: fullDisk ? `挂载点：${fullDisk.mount || fullDisk.filesystem}（危险分区）` : disk ? `${disk.count} ${disk.scope === "disk" ? "块物理盘" : "个分区"}` : diskReason },
  ];
  const isResourceAlert = metrics.some(metric => metric.value != null && (metric.tone || usageTone(metric.value)) !== "ok");
  const isMissingReadings = metrics.some(metric => metric.value == null);
  const isAttention = !isStale && !!entry && (!!error || connection === "failed" || agentState === "missing" ||
    agentState === "stopped" || isSampleStale || !!snapshot?.overviewError || !!snapshot?.diskError || isResourceAlert);
  const isUnknown = !isAttention && (connection !== "online" || agentState !== "running" || isMissingReadings);
  let agentLabel = "Agent 状态未知";
  if (agentState === "missing") agentLabel = "Agent 未安装";
  if (agentState === "stopped") agentLabel = "Agent 未运行";
  if (agentState === "running") {
    agentLabel = !isDetailsStale && snapshot?.agentVersion ? `Agent v${snapshot.agentVersion.replace(/^v/, "")}` : "Agent 运行中";
  }
  const isAgentOutdated = agentState === "running" && !isDetailsStale &&
    isAgentVersionOlder(snapshot?.agentVersion || "", latestAgentVersion);
  const connectionLabel = !entry ? "正在连接…" : connection === "online" ? "在线" :
    connection === "failed" ? "连接失败" : "状态未知";
  let statusLabel = connectionLabel;
  if (connection !== "failed" && agentState !== "missing" && agentState !== "stopped") {
    if (isStale || isSampleStale) statusLabel = "数据过期";
    else if (error) statusLabel = "采集异常";
    else if (snapshot?.overviewError) statusLabel = snapshot.overviewError.includes("尚无采样") ? "等待采样" : "采集异常";
    else if (snapshot?.diskError) statusLabel = "磁盘异常";
  }
  return {
    metrics, agentLabel, agentState, isAgentOutdated, statusLabel, connection, isAttention, isUnknown,
    tone: connection === "failed" ? "danger" : isStale || isUnknown ? "unknown" : isAttention ? "warn" : "ok",
    detail: error || snapshot?.overviewError || (isSampleStale ? "采样数据已过期" : "") || snapshot?.diskError || (isResourceAlert ? "资源占用偏高" : statusLabel),
    osRelease: overview?.osRelease,
  };
}

export function summarizeHostCards(names: string[], entries: Record<string, HostCardEntry>, now: number) {
  const summary = { normal: 0, attention: 0, unknown: 0 };
  for (const name of new Set(names)) {
    const view = hostCardView(entries[name], now);
    if (view.isAttention) summary.attention += 1;
    else if (view.isUnknown) summary.unknown += 1;
    else summary.normal += 1;
  }
  return summary;
}
