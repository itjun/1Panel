import type { monitor } from "../api";
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

/** 近 1 小时 CPU/内存趋势（0–100），供 sparkline。 */
export interface BoardHostTrend {
  cpu: number[];
  mem: number[];
}

export interface BoardSummary {
  totalHosts: number;
  onlineHosts: number;
  healthyHosts: number;
  attentionHosts: number;
  criticalHosts: number;
  unknownHosts: number;
  appTargets: number;
  appHealthy: number;
  appCritical: number;
  appUnknown: number;
}

export interface BoardGridShape {
  cols: number;
  rows: number;
  cardWidth: number;
  cardHeight: number;
}

const BOARD_STALE_AFTER_MS = 12_000;
const BOARD_GAP = 12;
const BOARD_TARGET_RATIO = 1.55;

/**
 * 把设置中的服务名和探活实例计数合成卡片使用的数据。
 * 未完成首轮采集时必须保留 unknown，不能把缺失的 map 键当成 0。
 */
export function buildBoardAppSubItems(
  subscribed: string[] | null,
  counts: Record<string, number> | undefined,
  countsKnown: boolean
): BoardAppSubItem[] | null {
  if (subscribed === null) return null;
  return [...subscribed]
    .map((name) => name.trim())
    .filter(Boolean)
    .sort((a, b) => watchServiceSortKey(a) - watchServiceSortKey(b))
    .map((name) => {
      const raw = counts?.[name];
      const count = Number.isFinite(Number(raw)) ? Math.max(0, Number(raw)) : 0;
      return {
        name,
        count,
        status: !countsKnown
          ? "unknown"
          : count > 0
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
    unknownHosts: 0,
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
        summary.unknownHosts += 1;
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

/**
 * 根据实际看板尺寸选择列数。候选列数以可读性为先，尽量避免 7 台主机被硬塞成 3×3。
 * 不返回 capacity，也不需要补隐藏空卡。
 */
export function pickBoardGrid(
  hostCount: number,
  width: number,
  height: number
): BoardGridShape {
  const count = Math.max(1, Math.floor(hostCount));
  const safeWidth = Math.max(320, width || 1440);
  const safeHeight = Math.max(180, height || 720);
  const minCardWidth = safeWidth < 900 ? 240 : safeWidth < 1500 ? 290 : 330;
  const maxCols = Math.max(1, Math.min(count, Math.floor((safeWidth + BOARD_GAP) / minCardWidth)));

  let best: BoardGridShape | null = null;
  let bestScore = Number.POSITIVE_INFINITY;

  for (let cols = 1; cols <= maxCols; cols += 1) {
    const rows = Math.ceil(count / cols);
    const cardWidth = (safeWidth - BOARD_GAP * (cols - 1)) / cols;
    const cardHeight = (safeHeight - BOARD_GAP * (rows - 1)) / rows;
    const ratio = cardWidth / Math.max(cardHeight, 1);
    const tooShort = Math.max(0, 150 - cardHeight) / 150;
    const tooNarrow = Math.max(0, minCardWidth - cardWidth) / minCardWidth;
    const score =
      Math.abs(Math.log(Math.max(ratio, 0.1) / BOARD_TARGET_RATIO)) +
      tooShort * 2 +
      tooNarrow * 4;

    if (score < bestScore) {
      bestScore = score;
      best = { cols, rows, cardWidth, cardHeight };
    }
  }

  return best || {
    cols: 1,
    rows: count,
    cardWidth: safeWidth,
    cardHeight: safeHeight / count,
  };
}

/** 供卡片选择 CSS 密度；订阅行在所有档位都保留。 */
export function boardDensityOf(
  shape: BoardGridShape
): "lg" | "md" | "sm" | "xs" | "xxs" {
  if (shape.cardWidth >= 500 && shape.cardHeight >= 250) return "lg";
  if (shape.cardWidth >= 370 && shape.cardHeight >= 185) return "md";
  if (shape.cardWidth >= 285 && shape.cardHeight >= 145) return "sm";
  if (shape.cardWidth >= 225 && shape.cardHeight >= 115) return "xs";
  return "xxs";
}
