import { useSyncExternalStore } from "react";
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

export function previewSection(state: PreviewState, category?: PreviewCategory) {
  return category ? `preview-${state}-${category}` as const : `preview-${state}` as const;
}

export const CHANNEL_SECTIONS = [
  { id: "channels", label: "接收渠道" },
  { id: "wecom", label: "通知回调" },
  { id: "recovery", label: "通用提醒" },
  { id: "content", label: "消息内容" },
  { id: "preview", label: "消息预览" },
] as const;

export type ChannelSection = (typeof CHANNEL_SECTIONS)[number]["id"] | ReturnType<typeof previewSection>;

// Scroll position stays outside page history and persisted notification settings.
let active: ChannelSection | null = null;
const listeners = new Set<() => void>();
const requests = new Set<(section: ChannelSection) => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function setChannelReadingSection(section: ChannelSection | null) {
  if (active === section) return;
  active = section;
  listeners.forEach((listener) => listener());
}

export function useChannelReadingSection() {
  return useSyncExternalStore(subscribe, () => active ?? "channels");
}

export function requestChannelSection(section: ChannelSection) {
  requests.forEach((request) => request(section));
}

export function subscribeChannelNavigation(request: (section: ChannelSection) => void) {
  requests.add(request);
  return () => { requests.delete(request); };
}

export const channelScroll = {
  attribute: "data-channel-section",
  firstSection: "channels",
  setReadingSection: setChannelReadingSection,
  subscribeNavigation: subscribeChannelNavigation,
} as const;
