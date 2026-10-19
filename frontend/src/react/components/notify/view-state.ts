import { useEffect, useState } from "react";
import type { Incident } from "@/react/lib/alert-incidents";
import type { NotifySource } from "@/react/lib/notify-model";

const views = new Map<string, unknown>();
export function useNotifyView<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(() => {
    if (views.has(key)) return views.get(key) as T;
    try {
      const saved = sessionStorage.getItem(`1pannel.notify.${key}`);
      if (saved) return { ...initial, ...JSON.parse(saved) };
    } catch {
      /* 本轮仍可使用内存状态 */
    }
    return initial;
  });
  useEffect(() => {
    views.set(key, value);
    try {
      sessionStorage.setItem(`1pannel.notify.${key}`, JSON.stringify(value));
    } catch {
      /* 保留内存状态 */
    }
  }, [key, value]);
  return [value, setValue] as const;
}

export type SubscriptionFocus = { host: string; field: string };
const focuses: Partial<Record<NotifySource, SubscriptionFocus>> = {};
let lastSource: NotifySource = "metric";
export function rememberMessageSource(source: NotifySource) {
  lastSource = source;
}
export function lastMessageSource() {
  return lastSource;
}
export function setSubscriptionFocus(
  source: NotifySource,
  incident?: Incident,
) {
  focuses[source] = incident
    ? {
        host: incident.host,
        field: source === "app" ? incident.service : incident.kind,
      }
    : undefined;
}
export function subscriptionFocus(source: NotifySource) {
  return focuses[source];
}
