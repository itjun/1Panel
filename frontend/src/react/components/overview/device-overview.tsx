import type { ReactNode } from "react";
import { ResourceRing } from "@/react/components/ui/resource-ring";
import { usageTone } from "@/react/lib/usage-tone";
import "./device-overview.css";

export type OverviewMetric = {
  id: "cpu" | "memory" | "disk" | "load";
  label: string;
  text: string;
  detail?: string;
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
  const isPartialUnavailable = ordered.some(metric => metric.isUnavailable);
  const isLastReading = isUnavailable && ordered.some(metric => metric.text !== "—");
  const statusTone = isLoading || isUnavailable || isPartialUnavailable ? "unknown"
    : attention.some(metric => usageTone(metric.percent!) === "danger") ? "danger" : attention.length ? "warn" : "ok";

  return (
    <section className="device-overview-resources" aria-label="资源状态" aria-busy={isLoading}>
      <div className="device-overview-section-heading">
        <span className="device-overview-status" role="status" data-tone={statusTone}>
          <span className="device-overview-status-dot" aria-hidden="true" />
          {isLoading ? "采集中" : isUnavailable ? isLastReading ? "上次读数" : "采集异常"
            : isPartialUnavailable ? "部分采集异常" : attention.length ? `${attention.map(metric => metric.label).join("、")}偏高` : "运行正常"}
        </span>
      </div>
      <div className="device-overview-gauges">
        {ordered.map((metric) => {
          const isMetricUnavailable = isUnavailable || !!metric.isUnavailable;
          const metricTone = !isMetricUnavailable && Number.isFinite(metric.percent) && metric.percent! >= 0 ? usageTone(metric.percent!) : "unknown";
          return (
            <div className="device-overview-gauge" key={metric.id} data-metric={metric.id} data-tone={metricTone}
              tabIndex={metric.tooltip ? 0 : undefined} aria-label={metric.tooltip ? `${metric.label}明细` : undefined}
              data-tip={metric.tooltip ? `${isMetricUnavailable ? "上次读数\n" : ""}${metric.tooltip}` : undefined}>
              <ResourceRing value={isMetricUnavailable ? undefined : metric.percent} label={metric.label} valueText={metric.text}>
                <strong>{metric.text.endsWith("%") ? <>{metric.text.slice(0, -1)}<span className="resource-ring-unit">%</span></> : metric.text}</strong>
              </ResourceRing>
              <span className="device-overview-gauge-label">{metric.label}</span>
              <p>{metric.detail || "\u00a0"}</p>
              {metric.isUnavailable && !isUnavailable ? <span className="device-overview-reading-error">采集异常</span> : null}
            </div>
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
