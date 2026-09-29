import type { monitor } from "@/api";
import {
  ALERT,
  isCpuAlert,
  isDiskLow,
  isLoadAlert,
  isMemAlert,
  summarizeDisks,
} from "@/utils/alerts";
import { formatBytes, formatMemCapacity } from "@/utils/format";
import {
  boardHealthOf,
  type BoardAppSubItem,
  type BoardHealth,
} from "@/utils/boardModel";
import { BoardSparkline } from "@/react/components/board/board-sparkline";
import { Meter } from "@/react/components/ui/meter";

export type BoardCardDensity = "lg" | "md" | "sm" | "xs" | "xxs";

function clampPct(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(100, v));
}

function healthLabelOf(health: BoardHealth): string {
  if (health === "healthy") return "正常";
  if (health === "attention") return "注意";
  if (health === "critical") return "严重";
  return "待采集";
}

function sparkHeightOf(density: BoardCardDensity): number {
  if (density === "lg") return 34;
  if (density === "md") return 28;
  if (density === "sm") return 23;
  if (density === "xs") return 18;
  return 14;
}

export function HostBoardCard({
  name,
  address = "",
  loading = false,
  overview = null,
  disks = null,
  error = null,
  cpuTrend = [],
  memTrend = [],
  appSubItems = null,
  appSubLoading = false,
  updatedAt,
  density = "md",
  onOpen,
}: {
  name: string;
  address?: string;
  loading?: boolean;
  overview?: monitor.Overview | null;
  disks?: monitor.DiskInfo[] | null;
  error?: string | null;
  cpuTrend?: number[];
  memTrend?: number[];
  appSubItems?: BoardAppSubItem[] | null;
  appSubLoading?: boolean;
  updatedAt?: number;
  density?: BoardCardDensity;
  onOpen?: (name: string) => void;
}) {
  const health = boardHealthOf({
    loading,
    overview,
    disks,
    error: error || undefined,
    appSubItems,
    appSubLoading,
    updatedAt,
  });
  const healthLabel = healthLabelOf(health);
  const items = appSubItems || [];
  const showAddress = density !== "xxs" && !!address;

  const cpuAlert = isCpuAlert(overview);
  const memAlert = isMemAlert(overview);
  const loadAlert = isLoadAlert(overview);
  const diskAlert = isDiskLow(disks);
  const diskSummary = summarizeDisks(disks);
  const diskPct = diskSummary?.percent ?? 0;
  const sparkHeight = sparkHeightOf(density);
  // 大屏卡片用 12 格 LED，其余沿用规范默认 8 格（DESIGN.md §4.7）
  const meterSegments = density === "lg" ? 12 : 8;

  let memUsageText = "—";
  if (overview) {
    memUsageText = `${formatBytes(overview.memUsed || 0)} / ${formatMemCapacity(overview.memTotal || 0)}`;
  }

  let diskUsageText = "—";
  if (diskSummary) {
    diskUsageText = `${formatBytes(diskSummary.used || 0)} / ${formatBytes(diskSummary.total || 0)}`;
  }

  let loadRatioText = "核均 —";
  let loadBarPct = 0;
  if (overview?.cpuCount) {
    loadRatioText = `核均 ${((overview.load1 || 0) / overview.cpuCount).toFixed(2)}`;
    loadBarPct = clampPct(
      ((overview.load1 || 0) / overview.cpuCount / ALERT.loadRatio) * 100,
    );
  }

  let updatedText = "待更新";
  if (updatedAt) {
    const d = new Date(updatedAt);
    updatedText = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
  }

  const className = [
    "host-board-card",
    `density-${density}`,
    `health-${health}`,
    loading && !overview && !error ? "is-loading" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <article
      className={className}
      role={onOpen ? "button" : "group"}
      tabIndex={onOpen ? 0 : undefined}
      aria-label={`${name}，${healthLabel}`}
      onDoubleClick={onOpen ? () => onOpen(name) : undefined}
      onKeyDown={
        onOpen
          ? (e) => {
              if (e.key === "Enter") onOpen(name);
            }
          : undefined
      }
    >
      <header className="host-board-card__head">
        <div className="host-board-card__identity">
          <span className="host-board-card__state-dot" aria-hidden="true" />
          <div className="host-board-card__title">
            <div className="host-board-card__name-line">
              <span className="host-board-card__name" data-tip={name} data-tip-overflow="">
                {name}
              </span>
              <span className="host-board-card__health">{healthLabel}</span>
            </div>
            {showAddress ? (
              <span className="host-board-card__addr">{address}</span>
            ) : null}
          </div>
        </div>
        <span className="host-board-card__updated">{updatedText}</span>
      </header>

      {error ? (
        <div className="host-board-card__state host-board-card__state--error">
          <strong>连接异常</strong>
          <span>{error}</span>
        </div>
      ) : !overview ? (
        <div className="host-board-card__state">
          <strong>{loading ? "正在采集" : "暂无数据"}</strong>
          <span>
            {loading ? "等待主机返回首个监控样本" : "请检查 Agent 或连接状态"}
          </span>
        </div>
      ) : (
        <div className="host-board-card__telemetry">
          <section className="metric-tile">
            <div className="metric-tile__top">
              <span className={`metric-tile__label${cpuAlert ? " is-alert" : ""}`}>
                CPU
              </span>
              <strong className={`metric-tile__value${cpuAlert ? " is-alert" : ""}`}>
                {(overview.cpuPercent || 0).toFixed(1)}%
              </strong>
            </div>
            <span className="metric-tile__sub">{overview.cpuCount || "—"} 核</span>
            <div className="metric-tile__visual">
              <BoardSparkline
                values={cpuTrend || []}
                alert={cpuAlert}
                height={sparkHeight}
              />
            </div>
          </section>

          <section className="metric-tile">
            <div className="metric-tile__top">
              <span className={`metric-tile__label${memAlert ? " is-alert" : ""}`}>
                内存
              </span>
              <strong className={`metric-tile__value${memAlert ? " is-alert" : ""}`}>
                {(overview.memPercent || 0).toFixed(1)}%
              </strong>
            </div>
            <span className="metric-tile__sub">{memUsageText}</span>
            <div className="metric-tile__visual">
              <BoardSparkline
                values={memTrend || []}
                alert={memAlert}
                height={sparkHeight}
              />
            </div>
          </section>

          <section className="metric-tile">
            <div className="metric-tile__top">
              <span className={`metric-tile__label${loadAlert ? " is-alert" : ""}`}>
                负载
              </span>
              <strong className={`metric-tile__value${loadAlert ? " is-alert" : ""}`}>
                {(overview.load1 || 0).toFixed(2)}
              </strong>
            </div>
            <span className="metric-tile__sub">{loadRatioText}</span>
            <Meter
              value={loadBarPct}
              segments={meterSegments}
              showValue={false}
              tone={loadAlert ? "danger" : "auto"}
              className="metric-tile__meter"
            />
          </section>

          <section className="metric-tile">
            <div className="metric-tile__top">
              <span className={`metric-tile__label${diskAlert ? " is-alert" : ""}`}>
                磁盘
              </span>
              <strong className={`metric-tile__value${diskAlert ? " is-alert" : ""}`}>
                {diskPct.toFixed(1)}%
              </strong>
            </div>
            <span className="metric-tile__sub">{diskUsageText}</span>
            <Meter
              value={clampPct(diskPct)}
              segments={meterSegments}
              showValue={false}
              tone={diskAlert ? "danger" : "auto"}
              className="metric-tile__meter"
            />
          </section>
        </div>
      )}

      <footer className="host-board-card__apps">
        <span className="host-board-card__apps-label">应用订阅</span>
        <div className="host-board-card__apps-list">
          {appSubLoading && !items.length ? (
            <span className="app-sub-empty">探活中…</span>
          ) : !items.length ? (
            <span className="app-sub-empty">未配置服务</span>
          ) : (
            items.map((item) => (
              <span
                key={item.name}
                className={`app-sub-pill is-${item.status}`}
              >
                <span>{item.name}</span>
                <b>{item.status === "unknown" ? "—" : item.count}</b>
              </span>
            ))
          )}
        </div>
      </footer>
    </article>
  );
}
