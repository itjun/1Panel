import type { monitor } from "@/api";
import { usageTone, USAGE_DANGER, USAGE_WARN, type UsageTone } from "@/react/lib/usage-tone";
import { formatBytes } from "@/utils/format";

/** 资源告警类型键（企微按类型开关的范围；conn 属连接告警，不在此列） */
export type ResourceAlertKind = "cpu" | "mem" | "disk" | "load" | "net" | "diskio";

/** 负载取哪个平均窗口 */
export type LoadWindow = "load1" | "load5" | "load15";

export const LOAD_WINDOW_LABEL: Record<LoadWindow, string> = {
  load1: "1 分钟",
  load5: "5 分钟",
  load15: "15 分钟",
};

/** 告警档位与圆环 / LED 分段条同一套分界（usage-tone.ts） */
export type AlertLevel = UsageTone;
/** 可选的起推档位 */
export type AlertStartLevel = "warn" | "danger";

const GB = 1024 * 1024 * 1024;
/** 磁盘只看容量大于它的分区：/boot/efi、/etc/pve 这类小分区常年接近写满，不参与告警 */
const DISK_MIN_TOTAL = 10 * GB;
/** 可用空间条件只看大分区：小分区按使用率就够了，否则 15 GB 的分区会常年报「可用 ≤ 20 GB」 */
const DISK_AVAIL_MIN_TOTAL = 100 * GB;
/** 可用空间的固定分界：≤ 20 GB 警告，≤ 10 GB 危险 */
export const DISK_AVAIL_GB: Record<AlertStartLevel, number> = { warn: 20, danger: 10 };
/** 网络按 1 Gbps 折算占比 */
export const NET_CAPACITY_BPS = 125_000_000;
/** 磁盘读写按 200 MB/s 折算占比 */
export const DISKIO_CAPACITY_BPS = 200_000_000;

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
  { kind: "disk", name: "磁盘", desc: `分区使用率或可用空间，危险档 ≥ ${USAGE_DANGER}%` },
  { kind: "load", name: "负载", desc: `平均负载 / 核数，危险档 ≥ ${USAGE_DANGER}%` },
  { kind: "net", name: "网络", desc: `收发速率按 1 Gbps 折算，危险档 ≥ ${USAGE_DANGER}%` },
  { kind: "diskio", name: "磁盘 IO", desc: `读写速率按 200 MB/s 折算，危险档 ≥ ${USAGE_DANGER}%` },
] as const;

/** 指标显示名 */
export const ALERT_KIND_LABEL = Object.fromEntries(
  ALERT_RULES.map((rule) => [rule.kind, rule.name])
) as Record<ResourceAlertKind, string>;

/** 资源告警轮询间隔（hostResourceAlerts 与设置页说明共用） */
export const RESOURCE_POLL_MS = 5000;

function mbps(bytesPerSec: number): string {
  return `${Math.round(bytesPerSec / 1_000_000)} MB/s`;
}

/** 某档在该指标上的分界，例如「≥ 60%」「≥ 0.6 × 核数」「≥ 75 MB/s」「可用 ≤ 20 GB」 */
function boundaryText(kind: ResourceAlertKind, level: AlertStartLevel, condition?: AlertCondition): string {
  const pct = levelPercent(level);
  if (condition === "avail") return `可用 ≤ ${DISK_AVAIL_GB[level]} GB`;
  switch (kind) {
    case "load":
      return `≥ ${pct / 100} × 核数`;
    case "net":
      return `≥ ${mbps((NET_CAPACITY_BPS * pct) / 100)}`;
    case "diskio":
      return `≥ ${mbps((DISKIO_CAPACITY_BPS * pct) / 100)}`;
    default:
      return `≥ ${pct}%`;
  }
}

/** 消息里「阈值」一栏的写法：当前档在触发条件上的分界 */
export function alertThresholdText(
  kind: ResourceAlertKind,
  level: AlertStartLevel,
  condition?: AlertCondition
): string {
  return `${LEVEL_LABEL[level]} ${boundaryText(kind, level, condition)}`;
}

function metricSubject(kind: ResourceAlertKind, loadWindow: LoadWindow): string {
  switch (kind) {
    case "cpu":
      return "CPU 使用率";
    case "mem":
      return "内存使用率";
    case "disk":
      return "磁盘";
    case "load":
      return `${LOAD_WINDOW_LABEL[loadWindow]}平均负载`;
    case "net":
      return "网卡接收或发送速率";
    case "diskio":
      return "磁盘读或写速率";
  }
}

const LEVEL_ORDER: AlertStartLevel[] = ["warn", "danger"];

/** 订阅档位的规范形：按警告、危险排序去重，至少一档；兼容旧版单个字符串（"warn" 表示两档都推） */
export function normalizeAlertLevels(value: unknown): AlertStartLevel[] {
  if (value === "warn") return ["warn", "danger"];
  const list = Array.isArray(value) ? value : [];
  const out = LEVEL_ORDER.filter((level) => list.includes(level));
  return out.length ? out : ["danger"];
}

function levelText(kind: ResourceAlertKind, level: AlertStartLevel): string {
  const boundary =
    kind === "disk"
      ? `使用率 ≥ ${levelPercent(level)}% 或${boundaryText(kind, level, "avail")}`
      : boundaryText(kind, level);
  return `${LEVEL_LABEL[level]}档（${boundary}）`;
}

/** 设置页「通知什么」里每类指标的判定规则，随订阅的档位变化 */
export function alertRuleText(
  kind: ResourceAlertKind,
  levels: readonly AlertStartLevel[],
  loadWindow: LoadWindow = "load1"
): string {
  const subject = metricSubject(kind, loadWindow);
  const warn = levels.includes("warn");
  const danger = levels.includes("danger");
  if (warn && danger) {
    return `${subject}进入${levelText(kind, "warn")}时推送，升到${levelText(kind, "danger")}再推一次`;
  }
  if (warn) return `${subject}进入${levelText(kind, "warn")}时推送，升到危险档不再单独推送`;
  return `${subject}进入${levelText(kind, "danger")}时推送`;
}

/** 全部资源告警类型 */
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

/** 圆环、看板标红用的读数（只有 CPU / 内存 / 磁盘使用率 / load1）；告警推送用 alertReading */
export function resourceReading(
  kind: "cpu" | "mem" | "disk" | "load",
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

function isDanger(kind: "cpu" | "mem" | "disk" | "load", ov?: monitor.Overview | null, disks?: monitor.DiskInfo[] | null) {
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

/** 告警由哪个条件触发：缺省为占比，avail 为磁盘可用空间 */
export type AlertCondition = "avail";

/** 相邻两拍算出的速率（字节 / 秒） */
export type AlertRates = { rx: number; tx: number; read: number; write: number };

/** 告警读数：档位、读数文字、触发条件；severity 越大越严重，用来取峰值 */
export type AlertReading = {
  level: AlertLevel;
  text: string;
  severity: number;
  condition?: AlertCondition;
};

export type AlertSample = {
  ov?: monitor.Overview | null;
  disks?: monitor.DiskInfo[] | null;
  /** 第一拍或计数器回绕时为 null */
  rates?: AlertRates | null;
};

function worse(a: AlertReading | null, b: AlertReading | null): AlertReading | null {
  if (!a) return b;
  if (!b) return a;
  const rank = levelRank(b.level) - levelRank(a.level);
  if (rank !== 0) return rank > 0 ? b : a;
  return b.severity > a.severity ? b : a;
}

/** 可用空间折成和占比同一把尺：20 GB 对应 60，10 GB 对应 85，越少越大 */
function availSeverity(availGb: number): number {
  const { warn, danger } = DISK_AVAIL_GB;
  return USAGE_WARN + ((warn - availGb) * (USAGE_DANGER - USAGE_WARN)) / (warn - danger);
}

function availLevel(availGb: number): AlertLevel {
  if (availGb <= DISK_AVAIL_GB.danger) return "danger";
  if (availGb <= DISK_AVAIL_GB.warn) return "warn";
  return "ok";
}

function diskAlertReading(disks?: monitor.DiskInfo[] | null): AlertReading | null {
  let out: AlertReading | null = null;
  for (const d of alertDisks(disks)) {
    const pct = diskPercent(d);
    const mount = d.mount || d.filesystem || "磁盘";
    out = worse(out, {
      level: usageTone(pct),
      severity: pct,
      text: `${mount} 已用 ${pct.toFixed(1)}%（可用 ${formatBytes(d.avail || 0)}）`,
    });
    if ((d.total || 0) >= DISK_AVAIL_MIN_TOTAL) {
      const availGb = (d.avail || 0) / GB;
      out = worse(out, {
        level: availLevel(availGb),
        severity: availSeverity(availGb),
        text: `${mount} 可用 ${formatBytes(d.avail || 0)}（已用 ${pct.toFixed(1)}%）`,
        condition: "avail",
      });
    }
  }
  return out;
}

function rateReading(
  pairs: [label: string, bytesPerSec: number][],
  capacity: number
): AlertReading {
  const [label, rate] = pairs.reduce((a, b) => (b[1] > a[1] ? b : a));
  const pct = (rate / capacity) * 100;
  return {
    level: usageTone(pct),
    severity: pct,
    text: `${label} ${(rate / 1_000_000).toFixed(1)} MB/s（${pct.toFixed(0)}%）`,
  };
}

/** 告警推送的判定：每类指标可有多个条件，取最差的一档；分界固定 60 / 85 */
export function alertReading(
  kind: ResourceAlertKind,
  sample: AlertSample,
  loadWindow: LoadWindow = "load1"
): AlertReading | null {
  const { ov, disks, rates } = sample;
  switch (kind) {
    case "cpu":
    case "mem": {
      if (!ov) return null;
      const pct = (kind === "cpu" ? ov.cpuPercent : ov.memPercent) || 0;
      return { level: usageTone(pct), severity: pct, text: `${pct.toFixed(1)}%` };
    }
    case "load": {
      const cores = ov?.cpuCount || 0;
      if (!ov || cores <= 0) return null;
      const load = ov[loadWindow] || 0;
      const pct = (load / cores) * 100;
      return {
        level: usageTone(pct),
        severity: pct,
        text: `${loadWindow} ${load.toFixed(2)} / ${cores} 核（${pct.toFixed(0)}%）`,
      };
    }
    case "disk":
      return diskAlertReading(disks);
    case "net":
      if (!rates) return null;
      return rateReading(
        [
          ["接收", rates.rx],
          ["发送", rates.tx],
        ],
        NET_CAPACITY_BPS
      );
    case "diskio":
      if (!rates) return null;
      return rateReading(
        [
          ["读取", rates.read],
          ["写入", rates.write],
        ],
        DISKIO_CAPACITY_BPS
      );
  }
}
