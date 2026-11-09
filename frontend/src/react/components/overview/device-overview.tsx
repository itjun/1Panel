import type { CSSProperties, ReactNode } from "react";
import { ResourceRing } from "@/react/components/ui/resource-ring";
import { usageTone } from "@/react/lib/usage-tone";
import { OverviewDetails as DetailPopup } from "@/react/components/local/overview-details";
import "@/react/components/local/overview-page.css";
import "./device-overview.css";

export type OverviewMetric = {
  id: "cpu" | "memory" | "disk" | "load";
  label: string;
  text: string;
  detail?: string;
  secondary?: string;
  tooltip?: string;
  percent?: number;
  isUnavailable?: boolean;
};

const METRIC_ORDER = ["load", "cpu", "memory", "disk"];

export function OverviewResources({ metrics, isUnavailable = false, isLoading = false }: {
  metrics: OverviewMetric[];
  isUnavailable?: boolean;
  isLoading?: boolean;
}) {
  const ordered = [...metrics].sort((a, b) => METRIC_ORDER.indexOf(a.id) - METRIC_ORDER.indexOf(b.id));
  const attention = ordered.filter(metric => !isUnavailable && !metric.isUnavailable &&
    Number.isFinite(metric.percent) && usageTone(metric.percent!) !== "ok");
  const attentionLabels = attention.map(metric => metric.label);
  const isPartialUnavailable = ordered.some(metric => metric.isUnavailable);
  const isLastReading = isUnavailable && ordered.some(metric => metric.text !== "—");
  const statusTone = isLoading || isUnavailable || isPartialUnavailable ? "unknown"
    : attention.some(metric => usageTone(metric.percent!) === "danger") ? "danger" : attentionLabels.length ? "warn" : "ok";

  return (
    <section className="device-overview-resources" aria-label="资源状态" aria-busy={isLoading}>
      <div className="device-overview-section-heading">
        <span className="device-overview-status" role="status" data-tone={statusTone}>
          <span className="device-overview-status-dot" aria-hidden="true" />
          {isLoading ? "采集中" : isUnavailable ? isLastReading ? "上次读数" : "采集异常"
            : isPartialUnavailable ? "部分采集异常" : attentionLabels.length ? `${attentionLabels.join("、")}偏高` : "运行正常"}
        </span>
      </div>
      <div className="local-summary-resources remote-summary-resources" style={{ "--resource-count": ordered.length } as CSSProperties}>
        {ordered.map((metric) => {
          const isMetricUnavailable = isUnavailable || !!metric.isUnavailable;
          const metricTone = !isMetricUnavailable && Number.isFinite(metric.percent) && metric.percent! >= 0 ? usageTone(metric.percent!) : "unknown";
          return (
            <article className="local-summary-resource" key={metric.id} data-metric={metric.id} data-tone={metricTone}>
              <DetailPopup label={`${metric.label}详情`} trigger={
                <ResourceRing value={isMetricUnavailable ? undefined : metric.percent} label={metric.label} valueText={metric.text}>
                  <strong>{metric.text}</strong><span>{metric.label}</span>
                </ResourceRing>
              }>
                <h2>{metric.label}</h2>
                {isMetricUnavailable ? <p className="device-overview-reading-error">{metric.text !== "—" ? "上次读数" : "暂无有效读数"}</p> : null}
                <p className="remote-summary-reading">{metric.tooltip || "暂无明细数据"}</p>
              </DetailPopup>
              <p>{metric.detail || "暂无数据"}</p>
              {metric.secondary ? <p className="local-summary-secondary">{metric.secondary}</p> : null}
              {metric.isUnavailable && !isUnavailable ? <span className="device-overview-reading-error">采集异常</span> : null}
            </article>
          );
        })}
      </div>
    </section>
  );
}

export function OverviewConnections({ privateIP, publicIP, isUnavailable = false }: {
  privateIP?: string;
  publicIP?: string;
  isUnavailable?: boolean;
}) {
  return (
    <section className="device-overview-connections" aria-label="当前连接">
      {isUnavailable ? <p className="device-overview-reading-error" role="status">网络采集异常</p> : null}
      <dl>
        <div><dt>内网</dt><dd>{privateIP || "—"}</dd></div>
        <div><dt>公网</dt><dd>{publicIP || "—"}</dd></div>
      </dl>
    </section>
  );
}

export function OverviewDetails({ children }: { children: ReactNode }) {
  return (
    <section className="device-overview-details" aria-label="系统信息">
      <div className="device-overview-details-body">{children}</div>
    </section>
  );
}
