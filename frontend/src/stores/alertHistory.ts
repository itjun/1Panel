import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { api } from "@/api";
import type { alerthistory } from "@/api";

export type AlertEvent = alerthistory.Event;

export interface DayGroup {
  dayKey: string;
  /** 主体：YYYY-MM-DD */
  label: string;
  /** 辅助：今天 / 昨天 / 前天；更早为空 */
  relative: string;
  events: AlertEvent[];
}

function dayKeyOf(at: number): string {
  const d = new Date(at || 0);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function dayRelative(dayKey: string): string {
  const today = dayKeyOf(Date.now());
  const yesterday = dayKeyOf(Date.now() - 86400000);
  const dayBefore = dayKeyOf(Date.now() - 2 * 86400000);
  if (dayKey === today) return "今天";
  if (dayKey === yesterday) return "昨天";
  if (dayKey === dayBefore) return "前天";
  return "";
}

/** 按日分组（新日在前；日内保持新→旧） */
export function groupEventsByDay(events: AlertEvent[]): DayGroup[] {
  const map = new Map<string, AlertEvent[]>();
  for (const e of events) {
    const k = dayKeyOf(e.at || 0);
    const list = map.get(k);
    if (list) {
      list.push(e);
    } else {
      map.set(k, [e]);
    }
  }
  const keys = [...map.keys()].sort((a, b) => {
    if (a < b) return 1;
    if (a > b) return -1;
    return 0;
  });
  return keys.map((k) => ({
    dayKey: k,
    label: k,
    relative: dayRelative(k),
    events: map.get(k) || [],
  }));
}

export function formatAlertClock(at: number): string {
  if (!at) return "—";
  const d = new Date(at);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

export function formatAlertRelative(at: number): string {
  if (!at) return "";
  const diff = Date.now() - at;
  if (diff < 60_000) return "刚刚";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  return `${Math.floor(diff / 86_400_000)} 天前`;
}

export function alertKindLabel(kind: string): string {
  switch (kind) {
    case "mem":
      return "内存";
    case "cpu":
      return "CPU";
    case "disk":
      return "磁盘";
    case "load":
      return "负载";
    case "conn":
      return "连接";
    default:
      return kind || "告警";
  }
}

export function alertStateLabel(state: string): string {
  if (state === "up") return "已回落";
  return "超阈值";
}

export const useAlertHistoryStore = defineStore("alertHistory", () => {
  const events = ref<AlertEvent[]>([]);
  const unread = ref(0);
  const loading = ref(false);
  const drawerOpen = ref(false);
  /** 打开主机通知页时要滚动/高亮的事件 id */
  const focusEventId = ref("");

  const byDay = computed(() => groupEventsByDay(events.value));

  async function refresh(limit = 500) {
    loading.value = true;
    try {
      const [list, count] = await Promise.all([
        api.listAlertHistory(limit),
        api.unreadAlertCount(),
      ]);
      events.value = list;
      unread.value = count;
    } catch {
      /* 启动期或后端未就绪时忽略 */
    } finally {
      loading.value = false;
    }
  }

  async function listByHost(host: string, limit = 500): Promise<AlertEvent[]> {
    return api.listAlertHistoryByHost(host, limit);
  }

  async function markRead(id: string) {
    if (!id) return;
    await api.markAlertRead(id);
    await refresh();
  }

  async function markAllRead(host = "") {
    await api.markAllAlertsRead(host);
    await refresh();
  }

  async function clearAll() {
    await api.clearAlertHistory();
    await refresh();
  }

  function openDrawer() {
    drawerOpen.value = true;
    void refresh();
  }

  function closeDrawer() {
    drawerOpen.value = false;
  }

  function setFocusEventId(id: string) {
    focusEventId.value = (id || "").trim();
  }

  function clearFocusEventId() {
    focusEventId.value = "";
  }

  void refresh();

  return {
    events,
    unread,
    loading,
    drawerOpen,
    focusEventId,
    byDay,
    refresh,
    listByHost,
    markRead,
    markAllRead,
    clearAll,
    openDrawer,
    closeDrawer,
    setFocusEventId,
    clearFocusEventId,
  };
});
