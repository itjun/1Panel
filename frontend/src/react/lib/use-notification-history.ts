import { useQuery } from "@tanstack/react-query";
import { Events } from "@wailsio/runtime";
import { useEffect, useMemo } from "react";
import { api } from "@/api";
import { buildIncidents } from "@/react/lib/alert-incidents";
import { unreadIncidents } from "@/react/lib/notify-model";

/** 一级栏负责刷新事件；所有通知视图共享同一份缓存与未读口径。 */
export function useNotificationHistory(observe = false) {
  const query = useQuery({
    queryKey: ["alerts"],
    queryFn: () => api.listAlertHistory(0),
    staleTime: 10_000,
    refetchInterval: observe ? 15_000 : false,
  });
  const { refetch } = query;
  useEffect(() => {
    if (!observe) return;
    const refresh = () => {
      void refetch();
    };
    window.addEventListener("alerts-changed", refresh);
    const off = Events.On("alert-history-updated", refresh);
    return () => {
      window.removeEventListener("alerts-changed", refresh);
      off();
    };
  }, [observe, refetch]);
  const incidents = useMemo(
    () => buildIncidents(query.data || []),
    [query.data],
  );
  const unread = useMemo(() => unreadIncidents(incidents), [incidents]);
  return { ...query, incidents, unread };
}

export function notificationHistoryChanged() {
  window.dispatchEvent(new Event("alerts-changed"));
}
