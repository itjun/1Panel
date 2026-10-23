import type { agentcli, monitor } from "../api";
import { isCpuAlert, isDiskFull, isLoadAlert, isMemAlert } from "./alerts";
import { watchServiceSortKey } from "./watchServices";

/** 看板上的主机健康状态；attention 只表示数据/探活降级，不新增资源告警阈值。 */
export type BoardHealth = "healthy" | "attention" | "critical" | "unknown";

export type BoardAppSubStatus = "healthy" | "critical" | "unknown";

export interface BoardAppSubItem {
  name: string;
  count: number;
  status: BoardAppSubStatus;
}

export interface BoardHostCard {
  loading: boolean;
  overview?: monitor.Overview | null;
  disks?: monitor.DiskInfo[] | null;
  error?: string | null;
  /** null 表示该主机没有应用订阅配置；空数组表示已配置但当前没有服务。 */
  appSubItems?: BoardAppSubItem[] | null;
  /** 应用实例尚未完成首轮采集时为 true。 */
  appSubLoading?: boolean;
  /** 最近一次成功的主机指标采集时间。 */
  updatedAt?: number;
}

export interface BoardSummary {
  totalHosts: number;
  onlineHosts: number;
  healthyHosts: number;
  attentionHosts: number;
  criticalHosts: number;
  appTargets: number;
  appHealthy: number;
  appCritical: number;
  appUnknown: number;
}

const BOARD_STALE_AFTER_MS = 12_000;

/**
 * 从 Agent 的实例快照统计实际运行进程；DOWN 占位行不属于实例。
 * 运行数量和探活状态分开判断，采集未成功时不能把未知当成离线或正常。
 */
export function buildBoardAppSubItems(
  subscribed: string[] | null,
  instances: readonly agentcli.JavaAppInstance[] | undefined,
  instancesKnown: boolean
): BoardAppSubItem[] | null {
  if (subscribed === null) return null;
  const byService = new Map<string, Map<number, boolean>>();
  for (const row of instances || []) {
    const service = (row.service || "").trim();
    if (!service || !Number.isInteger(row.pid) || row.pid <= 0 || !row.processUp || row.status === "DOWN") continue;
    let processes = byService.get(service);
    if (!processes) {
      processes = new Map();
      byService.set(service, processes);
    }
    const healthy = row.status === "UP" && row.healthUp;
    // 同一进程只计一次；重复记录中只要存在异常，就不能标为正常。
    processes.set(row.pid, (processes.get(row.pid) ?? true) && healthy);
  }
  return [...subscribed]
    .map((name) => name.trim())
    .filter(Boolean)
    .sort((a, b) => watchServiceSortKey(a) - watchServiceSortKey(b))
    .map((name) => {
      const processes = byService.get(name);
      const count = processes?.size ?? 0;
      return {
        name,
        count,
        status: !instancesKnown
          ? "unknown"
          : count > 0 && [...processes!.values()].every(Boolean)
            ? "healthy"
            : "critical",
      };
    });
}

function resourceCritical(card: BoardHostCard): boolean {
  const ov = card.overview;
  if (!ov) return false;
  return (
    isCpuAlert(ov) ||
    isMemAlert(ov) ||
    isLoadAlert(ov) ||
    isDiskFull(card.disks)
  );
}

function appCritical(card: BoardHostCard): boolean {
  return !!card.appSubItems?.some((item) => item.status === "critical");
}

function appUnknown(card: BoardHostCard): boolean {
  return (
    !!card.appSubLoading ||
    !!card.appSubItems?.some((item) => item.status === "unknown")
  );
}

/** 卡片和顶部摘要共用的状态判定，避免两处颜色与数字不一致。 */
export function boardHealthOf(
  card: BoardHostCard,
  now = Date.now()
): BoardHealth {
  if (card.error) return "critical";
  if (!card.overview) return card.loading ? "unknown" : "attention";
  if (resourceCritical(card) || appCritical(card)) return "critical";
  if (
    appUnknown(card) ||
    !card.updatedAt ||
    now - card.updatedAt > BOARD_STALE_AFTER_MS
  ) {
    return "attention";
  }
  return "healthy";
}

export function summarizeBoardCards(
  cards: Record<string, BoardHostCard>,
  now = Date.now()
): BoardSummary {
  const summary: BoardSummary = {
    totalHosts: 0,
    onlineHosts: 0,
    healthyHosts: 0,
    attentionHosts: 0,
    criticalHosts: 0,
    appTargets: 0,
    appHealthy: 0,
    appCritical: 0,
    appUnknown: 0,
  };

  for (const card of Object.values(cards)) {
    summary.totalHosts += 1;
    if (card.overview && !card.error) summary.onlineHosts += 1;

    switch (boardHealthOf(card, now)) {
      case "healthy":
        summary.healthyHosts += 1;
        break;
      case "attention":
        summary.attentionHosts += 1;
        break;
      case "critical":
        summary.criticalHosts += 1;
        break;
      case "unknown":
        break;
    }

    for (const item of card.appSubItems || []) {
      summary.appTargets += 1;
      if (item.status === "healthy") summary.appHealthy += 1;
      else if (item.status === "critical") summary.appCritical += 1;
      else summary.appUnknown += 1;
    }
  }

  return summary;
}
