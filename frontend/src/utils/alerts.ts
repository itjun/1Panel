import type { monitor } from "@/api";
import { formatBytes } from "@/utils/format";

/** 主机概览与分组监控共用的告警阈值 */
export const ALERT = {
  cpu: 90, // CPU% ≥
  mem: 85, // 内存% >
  loadRatio: 2.0, // load1 / 核数 >（200%）
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
  { kind: "disk", name: "磁盘", desc: `大分区/物理盘可用 ≤ ${ALERT.diskAvailBytes / GB} GB` },
  { kind: "load", name: "负载", desc: `load1 / 核数 > ${ALERT.loadRatio}（${ALERT.loadRatio * 100}%）` },
] as const;

/** 全部资源告警类型（cpu/mem/disk/load） */
export const ALL_ALERT_KINDS: ResourceAlertKind[] = ALERT_RULES.map(
  (r) => r.kind
);

export function isResourceAlertKind(k: unknown): k is ResourceAlertKind {
  return ALL_ALERT_KINDS.includes(k as ResourceAlertKind);
}

/** 磁盘容量汇总（优先物理盘/zpool；无则回退挂载分区） */
export type DiskSummary = {
  total: number;
  used: number;
  avail: number;
  percent: number;
  count: number;
  /** 汇总口径：disk=物理盘/池；mount=挂载分区 */
  scope: "disk" | "mount";
};

function isPhysicalDisk(d: monitor.DiskInfo): boolean {
  return d.kind === "disk";
}

/** 挂载分区（不含物理盘/池条目） */
export function mountDisks(
  disks?: monitor.DiskInfo[] | null
): monitor.DiskInfo[] {
  if (!disks?.length) return [];
  return disks.filter((d) => !isPhysicalDisk(d));
}

function sumUniqueByFilesystem(list: monitor.DiskInfo[]): DiskSummary | null {
  const byFs = new Map<string, monitor.DiskInfo>();
  for (const d of list) {
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
    scope: "mount",
  };
}

export function summarizeDisks(
  disks?: monitor.DiskInfo[] | null
): DiskSummary | null {
  if (!disks?.length) return null;
  const physical = disks.filter(isPhysicalDisk);
  if (physical.length) {
    const sum = sumUniqueByFilesystem(physical);
    if (sum) return { ...sum, scope: "disk" };
  }
  return sumUniqueByFilesystem(mountDisks(disks));
}

/** 取根分区（主机概览分区列表等仍可能用到） */
export function pickRootDisk(
  disks?: monitor.DiskInfo[] | null
): monitor.DiskInfo | null {
  const mounts = mountDisks(disks);
  if (!mounts.length) return null;
  return (
    mounts.find((d) => d.mount === "/") ||
    [...mounts].sort((a, b) => b.total - a.total)[0]
  );
}

/** 任一足够大的盘/分区可用空间不足则告警。
 *  总量 ≤ 阈值的挂载（如 /boot/efi、efivarfs、/etc/pve）永远凑不出「可用 > 10GB」，
 *  不得参与告警，否则 Proxmox 等主机磁盘会常年假红。 */
export function isDiskLow(disks?: monitor.DiskInfo[] | null): boolean {
  if (!disks?.length) return false;
  const thr = ALERT.diskAvailBytes;
  return disks.some(
    (d) => (d.total || 0) > thr && (d.avail || 0) <= thr
  );
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
  const thr = ALERT.diskAvailBytes;
  const candidates = (disks || []).filter((d) => (d.total || 0) > thr);
  if (!candidates.length) {
    return `「${host}」磁盘可用不足 ${ALERT.diskAvailBytes / GB} GB`;
  }
  const worst = [...candidates].sort(
    (a, b) => (a.avail || 0) - (b.avail || 0)
  )[0];
  const mount = worst.mount || worst.filesystem || "磁盘";
  return `「${host}」${mount} 可用 ${formatBytes(worst.avail)}，不足 ${ALERT.diskAvailBytes / GB} GB`;
}
