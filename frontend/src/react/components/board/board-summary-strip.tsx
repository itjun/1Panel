import type { BoardSummary } from "@/utils/boardModel";

function twoDigits(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

export function BoardSummaryStrip({ summary }: { summary: BoardSummary }) {
  let appDetail = "未配置";
  if (summary.appCritical) appDetail = `${summary.appCritical} 项异常`;
  else if (summary.appUnknown) appDetail = `${summary.appUnknown} 项待确认`;
  else if (summary.appTargets) appDetail = "全部正常";

  let appsClass = "board-summary__item board-summary__item--apps";
  if (summary.appCritical > 0) appsClass += " is-critical";
  else if (summary.appUnknown > 0) appsClass += " is-attention";

  return (
    <section className="board-summary" aria-label="看板运行摘要">
      <div className="board-summary__lead">
        <span className="board-summary__live-dot" aria-hidden="true" />
        <div>
          <span className="board-summary__eyebrow">实时运行概览</span>
          <strong className="board-summary__live">LIVE</strong>
        </div>
      </div>

      <div className="board-summary__items">
        <div className="board-summary__item">
          <span className="board-summary__label">监控主机</span>
          <strong className="board-summary__value">{twoDigits(summary.totalHosts)}</strong>
          <span className="board-summary__detail">{summary.onlineHosts} 台在线</span>
        </div>

        <div className="board-summary__item is-healthy">
          <span className="board-summary__label">正常</span>
          <strong className="board-summary__value">{twoDigits(summary.healthyHosts)}</strong>
          <span className="board-summary__detail">运行稳定</span>
        </div>

        <div className="board-summary__item is-attention">
          <span className="board-summary__label">注意</span>
          <strong className="board-summary__value">{twoDigits(summary.attentionHosts)}</strong>
          <span className="board-summary__detail">数据待确认</span>
        </div>

        <div className="board-summary__item is-critical">
          <span className="board-summary__label">严重</span>
          <strong className="board-summary__value">{twoDigits(summary.criticalHosts)}</strong>
          <span className="board-summary__detail">需要处理</span>
        </div>

        <div className="board-summary__item is-unknown">
          <span className="board-summary__label">待采集</span>
          <strong className="board-summary__value">{twoDigits(summary.unknownHosts)}</strong>
          <span className="board-summary__detail">等待首个样本</span>
        </div>

        <div className={appsClass}>
          <span className="board-summary__label">应用订阅</span>
          <strong className="board-summary__value">
            {summary.appTargets ? `${summary.appHealthy}/${summary.appTargets}` : "—"}
          </strong>
          <span className="board-summary__detail">{appDetail}</span>
        </div>
      </div>
    </section>
  );
}
