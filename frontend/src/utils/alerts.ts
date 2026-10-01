import type { monitor } from "@/api";
import { usageTone, USAGE_DANGER, USAGE_WARN, type UsageTone } from "@/react/lib/usage-tone";
import { formatBytes } from "@/utils/format";

/** 资源告警类型键（企微按类型开关的范围；conn 属连接告警，不在此列） */
export type ResourceAlertKind = "cpu" | "mem" | "disk" | "load";

/** 告警档位与圆环 / LED 分段条同一套分界（usage-tone.ts） */
export type AlertLevel = UsageTone;
/** 可选的起推档位 */
export type AlertStartLevel = "warn" | "danger";

const GB = 1024 * 1024 * 1024;
/** 磁盘只看容量大于它的分区：/boot/efi、/etc/pve 这类小分区常年接近写满，不参与告警 */
const DISK_MIN_TOTAL = 10 * GB;

export const LEVEL_LABEL: Record<AlertStartLevel, string> = {
  warn: "警告",
  danger: "危险",
};

/** 档位的起点百分比 */
export function levelPercent(level: AlertStartLevel): number {
  return level === "warn" ? USAGE_WARN : USAGE_DANGER;
}

export function levelRank(level: AlertLevel): number {
  if (level === "danger") return 2;
  if (level === "warn") return 1;
  return 0;
}

/** 设置页「通道设置」清单；kind 仅内部键，UI 只显示 name。
 *  全项目告警类型的单一来源：设置存储与企微开关均由此派生。 */
export const ALERT_RULES = [
  { kind: "cpu", name: "CPU", desc: `CPU 使用率，危险档 ≥ ${USAGE_DANGER}%` },
  { kind: "mem", name: "内存", desc: `内存使用率，危险档 ≥ ${USAGE_DANGER}%` },
  { kind: "disk", name: "磁盘", desc: `最满分区使用率，危险档 ≥ ${USAGE_DANGER}%` },
  { kind: "load", name: "负载", desc: `load1 / 核数，危险档 ≥ ${USAGE_DANGER}%` },
] as const;

/** 资源告警轮询间隔（hostResourceAlerts 与设置页说明共用） */
export const RESOURCE_POLL_MS = 5000;

/** 消息里「阈值」一栏的写法：当前档的分界 */
export function alertThresholdText(kind: ResourceAlertKind, level: AlertStartLevel): string {
  const pct = levelPercent(level);
  const label = LEVEL_LABEL[level];
  if (kind === "load") return `${label} ≥ ${pct / 100} × 核数`;
  return `${label} ≥ ${pct}%`;
}

const METRIC_SUBJECT: Record<ResourceAlertKind, string> = {
  cpu: "CPU 使用率",
  mem: "内存使用率",
  disk: `容量大于 ${DISK_MIN_TOTAL / GB} GB 的分区里，最满一个的使用率`,
  load: "1 分钟平均负载按核数折算的占比",
};

const LEVEL_ORDER: AlertStartLevel[] = ["warn", "danger"];

/** 订阅档位的规范形：按警告、危险排序去重，至少一档；兼容旧版单个字符串（"warn" 表示两档都推） */
export function normalizeAlertLevels(value: unknown): AlertStartLevel[] {
  if (value === "warn") return ["warn", "danger"];
  const list = Array.isArray(value) ? value : [];
  const out = LEVEL_ORDER.filter((level) => list.includes(level));
  return out.length ? out : ["danger"];
}

function levelText(level: AlertStartLevel): string {
  return `${LEVEL_LABEL[level]}档（≥ ${levelPercent(level)}%）`;
}

/** 设置页「通知什么」里每类指标的判定规则，随订阅的档位变化 */
export function alertRuleText(kind: ResourceAlertKind, levels: readonly AlertStartLevel[]): string {
  const subject = METRIC_SUBJECT[kind];
  const warn = levels.includes("warn");
  const danger = levels.includes("danger");
  if (warn && danger) return `${subject}进入${levelText("warn")}时推送，升到${levelText("danger")}再推一次`;
  if (warn) return `${subject}进入${levelText("warn")}时推送，升到危险档不再单独推送`;
  return `${subject}进入${levelText("danger")}时推送`;
}

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

/** 物理盘 / zpool 条目（lsblk 真实块设备或存储池） */
export function physicalDisks(
  disks?: monitor.DiskInfo[] | null
): monitor.DiskInfo[] {
  if (!disks?.length) return [];
  return disks.filter(isPhysicalDisk);
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

/** 一次读数：档位、占比（0–100+）、写进消息的文字 */
export type ResourceReading = { level: AlertLevel; percent: number; text: string };

/** 参与告警的磁盘：容量大于 10 GB 的挂载分区；没有挂载分区信息时退回物理盘 */
function alertDisks(disks?: monitor.DiskInfo[] | null): monitor.DiskInfo[] {
  const big = (list: monitor.DiskInfo[]) => list.filter((d) => (d.total || 0) > DISK_MIN_TOTAL);
  const mounts = big(mountDisks(disks));
  return mounts.length ? mounts : big(physicalDisks(disks));
}

function diskPercent(d: monitor.DiskInfo): number {
  const total = d.total || 0;
  return total > 0 ? ((d.used || 0) / total) * 100 : 0;
}

/** 磁盘里使用率最高的分区 */
export function fullestDisk(disks?: monitor.DiskInfo[] | null): monitor.DiskInfo | null {
  const list = alertDisks(disks);
  if (!list.length) return null;
  return [...list].sort((a, b) => diskPercent(b) - diskPercent(a))[0];
}

/** 资源读数的唯一出处：圆环、看板、告警推送都按这里的档位判断 */
export function resourceReading(
  kind: ResourceAlertKind,
  ov?: monitor.Overview | null,
  disks?: monitor.DiskInfo[] | null
): ResourceReading | null {
  let percent: number;
  let text: string;
  switch (kind) {
    case "cpu":
      if (!ov) return null;
      percent = ov.cpuPercent || 0;
      text = `${percent.toFixed(1)}%`;
      break;
    case "mem":
      if (!ov) return null;
      percent = ov.memPercent || 0;
      text = `${percent.toFixed(1)}%`;
      break;
    case "load": {
      const cores = ov?.cpuCount || 0;
      if (!ov || cores <= 0) return null;
      percent = ((ov.load1 || 0) / cores) * 100;
      text = `${(ov.load1 || 0).toFixed(2)} / ${cores} 核（${percent.toFixed(0)}%）`;
      break;
    }
    case "disk": {
      const d = fullestDisk(disks);
      if (!d) return null;
      percent = diskPercent(d);
      const mount = d.mount || d.filesystem || "磁盘";
      text = `${mount} 已用 ${percent.toFixed(1)}%（可用 ${formatBytes(d.avail || 0)}）`;
      break;
    }
  }
  return { level: usageTone(percent), percent, text };
}

function isDanger(kind: ResourceAlertKind, ov?: monitor.Overview | null, disks?: monitor.DiskInfo[] | null) {
  return resourceReading(kind, ov, disks)?.level === "danger";
}

/** 任一容量大于 10 GB 的分区使用率达到危险档 */
export function isDiskFull(disks?: monitor.DiskInfo[] | null): boolean {
  return isDanger("disk", null, disks);
}

export function isCpuAlert(ov?: monitor.Overview | null): boolean {
  return isDanger("cpu", ov);
}

export function isMemAlert(ov?: monitor.Overview | null): boolean {
  return isDanger("mem", ov);
}

export function isLoadAlert(ov?: monitor.Overview | null): boolean {
  return isDanger("load", ov);
}

export function diskFullMessage(host: string, disks?: monitor.DiskInfo[] | null): string {
  const reading = resourceReading("disk", null, disks);
  if (!reading) return `「${host}」磁盘使用率达到危险档（≥ ${USAGE_DANGER}%）`;
  return `「${host}」${reading.text}，达到危险档（≥ ${USAGE_DANGER}%）`;
}
