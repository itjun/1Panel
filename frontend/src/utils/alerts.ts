import type { monitor } from "@/api";
import { formatBytes } from "@/utils/format";

/** 主机概览与分组监控共用的告警阈值 */
export const ALERT = {
  cpu: 90, // CPU% ≥
  mem: 85, // 内存% >
  loadRatio: 1.0, // load1 / 核数 >
  diskAvailBytes: 10 * 1024 * 1024 * 1024, // 根分区可用 ≤ 10 GB
};

/** 资源告警类型键（企微按类型开关的范围；conn 属连接告警，不在此列） */
export type ResourceAlertKind = "cpu" | "mem" | "disk" | "load";

const GB = 1024 * 1024 * 1024;

/** 通知页「报警规则」清单；kind 仅内部键，UI 只显示 name。
 *  全项目告警类型的单一来源：设置存储与企微开关均由此派生。
 *  desc 由 ALERT 阈值派生，调阈值时文案自动同步。 */
export const ALERT_RULES = [
  { kind: "cpu", name: "CPU", desc: `CPU ≥ ${ALERT.cpu}%` },
  { kind: "mem", name: "内存", desc: `内存 > ${ALERT.mem}%` },
  { kind: "disk", name: "磁盘", desc: `根分区可用 ≤ ${ALERT.diskAvailBytes / GB} GB` },
  { kind: "load", name: "负载", desc: `load1 / 核数 > ${ALERT.loadRatio}` },
] as const;

/** 全部资源告警类型（cpu/mem/disk/load） */
export const ALL_ALERT_KINDS: ResourceAlertKind[] = ALERT_RULES.map(
  (r) => r.kind
);

export function isResourceAlertKind(k: unknown): k is ResourceAlertKind {
  return ALL_ALERT_KINDS.includes(k as ResourceAlertKind);
}

export function pickRootDisk(
  disks?: monitor.DiskInfo[] | null
): monitor.DiskInfo | null {
  if (!disks?.length) return null;
  return (
    disks.find((d) => d.mount === "/") ||
    [...disks].sort((a, b) => b.total - a.total)[0]
  );
}

export function isDiskLow(disks?: monitor.DiskInfo[] | null): boolean {
  const d = pickRootDisk(disks);
  if (!d) return false;
  return d.avail <= ALERT.diskAvailBytes;
}

export function isCpuAlert(ov?: monitor.Overview | null): boolean {
  return !!ov && (ov.cpuPercent || 0) >= ALERT.cpu;
}

export function isMemAlert(ov?: monitor.Overview | null): boolean {
  return !!ov && (ov.memPercent || 0) > ALERT.mem;
}

export function isLoadAlert(ov?: monitor.Overview | null): boolean {
  if (!ov) return false;
  const n = ov.cpuCount || 0;
  return n > 0 && (ov.load1 || 0) / n > ALERT.loadRatio;
}

export function diskLowMessage(
  host: string,
  disks?: monitor.DiskInfo[] | null
): string {
  const d = pickRootDisk(disks);
  const mount = d?.mount || "/";
  const avail = d ? formatBytes(d.avail) : "—";
  return `「${host}」${mount} 可用 ${avail}，不足 10 GB`;
}
