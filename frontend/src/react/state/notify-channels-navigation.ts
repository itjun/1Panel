import { ALERT_RULES } from "@/utils/alerts";

export const PREVIEW_CATEGORIES = [
  ...ALERT_RULES.map((rule) => ({ id: rule.kind, label: rule.name })),
  { id: "app", label: "应用探活" },
] as const;

export const PREVIEW_STATES = [
  { id: "down", label: "告警" },
  { id: "up", label: "恢复" },
] as const;

export type PreviewCategory = (typeof PREVIEW_CATEGORIES)[number]["id"];
export type PreviewState = (typeof PREVIEW_STATES)[number]["id"];

export const CHANNEL_SECTIONS = [
  { id: "channels", label: "接收渠道" },
  { id: "wecom", label: "通知回调" },
  { id: "recovery", label: "通用提醒" },
  { id: "content", label: "消息内容" },
  { id: "preview", label: "消息预览" },
] as const;

export type ChannelSection = (typeof CHANNEL_SECTIONS)[number]["id"];
