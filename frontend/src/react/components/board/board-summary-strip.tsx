import type { BoardSummary } from "@/utils/boardModel";

export function BoardSummaryStrip({ summary }: { summary: BoardSummary }) {
  const appDetail = summary.appCritical ? `${summary.appCritical} 项异常`
    : summary.appUnknown ? `${summary.appUnknown} 项待确认`
    : summary.appTargets ? `${summary.appHealthy} / ${summary.appTargets} 正常` : "未配置";
  return (
    <section className="board-summary" aria-label="看板运行摘要">
      <div className="board-summary__online">
        <strong>{summary.onlineHosts}<span> / {summary.totalHosts}</span></strong><span>主机在线</span>
      </div>
      <div className="board-summary__item"><span>正常</span><strong className="health-healthy">{summary.healthyHosts}</strong></div>
      <div className="board-summary__item"><span>注意</span><strong className="health-attention">{summary.attentionHosts}</strong></div>
      <div className="board-summary__item"><span>严重</span><strong className="health-critical">{summary.criticalHosts}</strong></div>
      <div className="board-summary__item"><span>待采集</span><strong>{summary.unknownHosts}</strong></div>
      <div className="board-summary__apps"><span>应用订阅</span><span className={summary.appCritical ? "health-critical" : summary.appUnknown ? "health-attention" : undefined}>{appDetail}</span></div>
    </section>
  );
}
