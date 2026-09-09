import type { monitor } from "@/api";
import { formatBytes } from "@/utils/format";

/** 主机概览与分组监控共用的告警阈值 */
export const ALERT = {
  cpu: 90, // CPU% ≥
  mem: 85, // 内存% >
  loadRatio: 1.0, // load1 / 核数 >
  diskAvailBytes: 10 * 1024 * 1024 * 1024, // 任一分区可用 ≤ 10 GB
};

/** 资源告警类型键（企微按类型开关的范围；conn 属连接告警，不在此列） */
export type ResourceAlertKind = "cpu" | "mem" | "disk" | "load";

const GB = 1024 * 1024 * 1024;

/** 设置页「通道设置」清单；kind 仅内部键，UI 只显示 name。
 *  全项目告警类型的单一来源：设置存储与企微开关均由此派生。
 *  desc 由 ALERT 阈值派生，调阈值时文案自动同步。 */
export const ALERT_RULES = [
  { kind: "cpu", name: "CPU", desc: `CPU ≥ ${ALERT.cpu}%` },
  { kind: "mem", name: "内存", desc: `内存 > ${ALERT.mem}%` },
  { kind: "disk", name: "磁盘", desc: `任一分区可用 ≤ ${ALERT.diskAvailBytes / GB} GB` },
  { kind: "load", name: "负载", desc: `load1 / 核数 > ${ALERT.loadRatio}` },
] as const;

/** 全部资源告警类型（cpu/mem/disk/load） */
export const ALL_ALERT_KINDS: ResourceAlertKind[] = ALERT_RULES.map(
  (r) => r.kind
);

export function isResourceAlertKind(k: unknown): k is ResourceAlertKind {
  return ALL_ALERT_KINDS.includes(k as ResourceAlertKind);
}

/** 全部真实分区容量合计（按 filesystem 去重，避免同设备多挂载重复累计） */
export type DiskSummary = {
  total: number;
  used: number;
  avail: number;
  percent: number;
  count: number;
};

export function summarizeDisks(
  disks?: monitor.DiskInfo[] | null
): DiskSummary | null {
  if (!disks?.length) return null;
  const byFs = new Map<string, monitor.DiskInfo>();
  for (const d of disks) {
    const key = d.filesystem || d.mount;
    const prev = byFs.get(key);
    if (!prev || (d.total || 0) > (prev.total || 0)) {
      byFs.set(key, d);
    }
  }
  let total = 0;
  let used = 0;
  let avail = 0;
  for (const d of byFs.values()) {
    total += d.total || 0;
    used += d.used || 0;
    avail += d.avail || 0;
  }
  if (total <= 0) return null;
  return {
    total,
    used,
    avail,
    percent: (used / total) * 100,
    count: byFs.size,
  };
}

/** 取根分区（主机概览分区列表等仍可能用到） */
export function pickRootDisk(
  disks?: monitor.DiskInfo[] | null
): monitor.DiskInfo | null {
  if (!disks?.length) return null;
  return (
    disks.find((d) => d.mount === "/") ||
    [...disks].sort((a, b) => b.total - a.total)[0]
  );
}

/** 任一真实分区可用空间不足则告警 */
export function isDiskLow(disks?: monitor.DiskInfo[] | null): boolean {
  if (!disks?.length) return false;
  return disks.some((d) => (d.avail || 0) <= ALERT.diskAvailBytes);
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
  if (!disks?.length) {
    return `「${host}」磁盘可用不足 ${ALERT.diskAvailBytes / GB} GB`;
  }
  const worst = [...disks].sort((a, b) => (a.avail || 0) - (b.avail || 0))[0];
  const mount = worst.mount || "磁盘";
  return `「${host}」${mount} 可用 ${formatBytes(worst.avail)}，不足 ${ALERT.diskAvailBytes / GB} GB`;
}
