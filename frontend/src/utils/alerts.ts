import type { monitor } from "@/api";
import { formatBytes } from "@/utils/format";

/** 主机概览与分组监控共用的告警阈值 */
export const ALERT = {
  cpu: 90, // CPU% ≥
  mem: 85, // 内存% >
  loadRatio: 1.0, // load1 / 核数 >
  diskAvailBytes: 10 * 1024 * 1024 * 1024, // 根分区可用 ≤ 10 GB
};

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
