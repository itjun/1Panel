/** 可订阅应用探活通知的服务清单（与 watch.yml 默认服务、AppsView 一致） */

export const WATCH_SERVICE_ORDER = [
  "im",
  "oss",
  "csp",
  "std",
  "zhetai",
  "fpl",
  "ai-agent",
  "sapi-agent",
] as const;

export type WatchServiceName = (typeof WATCH_SERVICE_ORDER)[number];

export type WatchServiceGroupKey = "pro" | "private" | "other";

export interface WatchServiceMeta {
  name: WatchServiceName;
  /** 展示名；默认与 name 相同 */
  label: string;
  group: WatchServiceGroupKey;
  runtime: "java" | "bun";
}

export const WATCH_SERVICE_META: WatchServiceMeta[] = [
  { name: "im", label: "im", group: "pro", runtime: "java" },
  { name: "oss", label: "oss", group: "pro", runtime: "java" },
  { name: "csp", label: "csp", group: "pro", runtime: "java" },
  { name: "std", label: "std", group: "pro", runtime: "java" },
  { name: "zhetai", label: "zhetai", group: "private", runtime: "java" },
  { name: "fpl", label: "fpl", group: "private", runtime: "java" },
  { name: "ai-agent", label: "ai-agent", group: "other", runtime: "bun" },
  { name: "sapi-agent", label: "sapi-agent", group: "other", runtime: "java" },
];

export const WATCH_SERVICE_GROUPS: {
  key: WatchServiceGroupKey;
  title: string;
}[] = [
  { key: "pro", title: "标准版服务" },
  { key: "private", title: "私有化服务" },
  { key: "other", title: "云组件服务" },
];

/**
 * 应用探活订阅规则（「通知 → 设置」展示用）。
 * 仅已订阅服务触发；通道与 appWatchAlerts 边沿判定一致。
 */
export const APP_NOTIFY_RULES = [
  {
    kind: "process",
    name: "进程",
    desc: "进程层探活失败（无进程 / 连续失败达阈值）",
  },
  {
    kind: "health",
    name: "健康检查",
    desc: "HTTP 健康检查非 200（如 /actuator/health、/health）",
  },
  {
    kind: "ingress",
    name: "入口",
    desc: "已开启入口探活且入口探测失败",
  },
  {
    kind: "recover",
    name: "恢复",
    desc: "上述异常全部恢复后发送回落通知",
  },
] as const;

const KNOWN = new Set<string>(WATCH_SERVICE_ORDER);

export function isWatchServiceName(v: unknown): v is WatchServiceName {
  return typeof v === "string" && KNOWN.has(v);
}

export function watchServiceSortKey(name: string): number {
  const idx = WATCH_SERVICE_ORDER.indexOf(name as WatchServiceName);
  if (idx >= 0) return idx;
  return WATCH_SERVICE_ORDER.length + 1;
}

/** 告警历史 / 企微 kind：app:<service> */
export function appAlertKind(service: string): string {
  return `app:${(service || "").trim()}`;
}

export function parseAppAlertKind(kind: string): string {
  const k = (kind || "").trim();
  if (k.startsWith("app:")) return k.slice(4);
  return "";
}
