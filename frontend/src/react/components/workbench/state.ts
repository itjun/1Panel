import { useEffect, useState } from "react";
export type TrendRange = { minutes: number; custom?: [string, string] };
export type TrendMetric = "cpu" | "mem";
export type HostFocus = {
  range: TrendRange;
  metric: TrendMetric;
  processSort?: "cpu" | "rss";
  pid?: number;
};
const hostFocus = new Map<string, HostFocus>();
export function focusHost(host: string, patch: Partial<HostFocus>) {
  if (patch.range) pageState.set(`host-range:${host}`, patch.range);
  hostFocus.set(host, {
    range: { minutes: 30 },
    metric: "mem",
    ...hostFocus.get(host),
    ...patch,
  });
}
export function readHostFocus(host: string): HostFocus {
  return hostFocus.get(host) || { range: { minutes: 30 }, metric: "mem" };
}
/** Per-window navigation state; no changes to saved hosts or shared preferences. */
const pageState = new Map<string, unknown>();
export function useWorkbenchState<T>(key: string, fallback: T) {
  const [state, setState] = useState<T>(
    () => (pageState.get(key) as T | undefined) ?? fallback,
  );
  useEffect(() => {
    pageState.set(key, state);
  }, [key, state]);
  return [state, setState] as const;
}
export function useTrendWindow(range: TrendRange) {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 15000) * 15000);
  useEffect(() => {
    if (range.custom) return;
    const id = window.setInterval(
      () => setNow(Math.floor(Date.now() / 15000) * 15000),
      15000,
    );
    return () => clearInterval(id);
  }, [range.custom]);
  return range.custom
    ? {
        from: new Date(range.custom[0]).getTime(),
        to: new Date(range.custom[1]).getTime(),
      }
    : { from: now - range.minutes * 60000, to: now };
}
