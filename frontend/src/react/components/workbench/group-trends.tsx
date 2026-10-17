import {
  AlertCircle,
  CheckCircle2,
  ChevronRight,
  HardDrive,
  Server,
} from "lucide-react";
import type { main } from "@/api";
import {
  isCpuAlert,
  isMemAlert,
  isLoadAlert,
  isDiskFull,
  summarizeDisks,
} from "@/utils/alerts";
import { NetworkRates } from "./network-rates";
import { ResourceTrends } from "./resource-trends";
import type { TrendMetric } from "./state";
import { currentGroupSample } from "@/utils/groupSnapshot";
export function snapshotAlerts(snap?: main.HostOverviewSnapshot) {
  if (!snap?.overview || snap.error || snap.notInstalled) return [];
  return [
    [isCpuAlert(snap.overview), "CPU"],
    [isMemAlert(snap.overview), "内存"],
    [isLoadAlert(snap.overview), "负载"],
    [isDiskFull(snap.disks), "磁盘"],
  ]
    .filter(([active]) => active)
    .map(([, label]) => String(label));
}
export function GroupTrends({
  names,
  snapshots,
  from,
  to,
  unavailable,
  sampledAt,
  onOpen,
}: {
  names: string[];
  snapshots: Map<string, main.HostOverviewSnapshot>;
  from: number;
  to: number;
  unavailable: boolean;
  sampledAt: number;
  onOpen: (host: string, metric?: TrendMetric) => void;
}) {
  return (
    <div
      className={`group-trend-grid${names.length === 1 ? " is-single" : ""}`}
    >
      {names.map((name) => {
        const snap = snapshots.get(name);
        const bad = unavailable || !!snap?.error || !!snap?.notInstalled;
        const sample = currentGroupSample(snap, unavailable);
        const ov = sample.overview;
        const alerts = snapshotAlerts(snap);
        const disk = summarizeDisks(sample.disks);
        const status = unavailable
          ? "采集更新失败"
          : snap?.notInstalled
            ? "Agent 未安装"
            : snap?.error
              ? "采集异常"
              : !ov
                ? "等待采样"
                : alerts.length
                  ? `${alerts.join("、")}达到危险档`
                  : "运行正常";
        return (
          <article className="group-trend-host" key={name}>
            <header className="group-trend-heading">
            <button
              type="button"
              className="group-trend-name"
              onClick={() => onOpen(name)}
            >
              <Server size={26} />
              <strong>{name}</strong>
              <ChevronRight size={16} />
            </button>
            <p
              className={`group-trend-status ${bad || alerts.length ? "text-danger" : ov ? "text-success-text" : "text-muted"}`}
              title={snap?.error}
            >
              {bad || alerts.length ? (
                <AlertCircle size={15} />
              ) : (
                <CheckCircle2 size={15} />
              )}{" "}
              {status}
            </p>
            </header>
            <ResourceTrends
              host={name}
              overview={snap?.overview}
              currentAvailable={!bad}
              from={from}
              to={to}
              onOpen={(metric) => onOpen(name, metric)}
            />
            <footer>
              <span>
                <HardDrive size={15} />
                磁盘 {disk ? `${disk.percent.toFixed(1)}%` : "—"}
              </span>
              <NetworkRates overview={ov} sampledAt={sampledAt} />
            </footer>
          </article>
        );
      })}
    </div>
  );
}
