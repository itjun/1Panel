import type { NotifySection } from "@/react/state/session";
import { isAppKind, type Incident } from "@/react/lib/alert-incidents";

export type NotifySource = "metric" | "app" | "cert";
export type MessageSection = "metricMessages" | "appMessages" | "certMessages";

export const NOTIFY_SOURCE = {
  metric: {
    label: "主机系统",
    title: "主机系统消息",
    description: "CPU、内存、磁盘、负载等资源告警",
    messages: "metricMessages",
    subscriptions: "metricSubs",
    rules: "metricRules",
    subscriptionLabel: "主机订阅",
  },
  app: {
    label: "应用服务",
    title: "应用服务消息",
    description: "服务探活异常与恢复记录",
    messages: "appMessages",
    subscriptions: "appSubs",
    rules: "appRules",
    subscriptionLabel: "应用订阅",
  },
  cert: {
    label: "证书提醒",
    title: "证书提醒消息",
    description: "证书到期、过期与续期记录",
    messages: "certMessages",
    subscriptions: "certRules",
    rules: "certRules",
    subscriptionLabel: "提醒规则",
  },
} as const;

/** 未知的旧系统事件仍保留在主机系统，不能因新分类丢掉历史。 */
export function notifySourceOf(kind: string): NotifySource {
  if (kind === "cert") return "cert";
  return isAppKind(kind) ? "app" : "metric";
}

export function messageSectionOf(kind: string): MessageSection {
  return NOTIFY_SOURCE[notifySourceOf(kind)].messages;
}

export function sourceForSection(section: NotifySection): NotifySource {
  if (section.startsWith("app")) return "app";
  if (section.startsWith("cert")) return "cert";
  return "metric";
}

export function unreadIncidents(incidents: Incident[]) {
  const counts: Record<NotifySource, number> = { metric: 0, app: 0, cert: 0 };
  for (const incident of incidents)
    if (incident.unread) counts[notifySourceOf(incident.kind)]++;
  return counts;
}

export function unreadEventIds(
  incidents: Incident[],
  events: { id: string; read: boolean }[],
): string[] {
  const ids = new Set(incidents.flatMap((incident) => incident.eventIds));
  return events
    .filter((event) => ids.has(event.id) && !event.read)
    .map((event) => event.id);
}

export function selectedIncident(
  visible: Incident[],
  selectedId: string,
  focusId: string,
): Incident | undefined {
  return (
    visible.find((incident) => incident.id === focusId) ||
    visible.find((incident) => incident.id === selectedId) ||
    visible[0]
  );
}
