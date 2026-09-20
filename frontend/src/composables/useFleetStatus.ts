import {
  onBeforeUnmount,
  ref,
  toValue,
  watch,
  type ComputedRef,
  type Ref,
} from "vue";
import { api } from "@/api";
import type { main } from "@/api";
import {
  isCpuAlert,
  isDiskLow,
  isLoadAlert,
  isMemAlert,
} from "@/utils/alerts";
import { isAgentMissing } from "@/utils/format";

const POLL_MS = 15_000;

/**
 * 可达性三态：
 * - online：Agent 指标采到
 * - no_agent：SSH 通，但未装/未跑 Agent
 * - ssh_down：SSH 接不上或配置失败
 */
export type FleetReach = "online" | "no_agent" | "ssh_down";

/** 单台主机的轻量舰队状态（首页看板用） */
export type FleetHostStatus = {
  reach: FleetReach;
  /** 兼容旧调用：仅 Agent 在线为 true */
  online: boolean;
  alert: boolean;
  checkedAt: number;
};

export type FleetGroupSummary = {
  online: number;
  noAgent: number;
  sshDown: number;
  alert: number;
};

/**
 * 从 ListGroupOverview 快照判定三态与告警。
 * 优先用后端 notInstalled；字符串匹配作兜底。
 */
export function fleetStatusFromSnapshot(
  snap: main.HostOverviewSnapshot,
  checkedAt = Date.now()
): FleetHostStatus {
  if (!snap.error) {
    const ov = snap.overview;
    const alert =
      isCpuAlert(ov) ||
      isMemAlert(ov) ||
      isLoadAlert(ov) ||
      isDiskLow(snap.disks);
    return { reach: "online", online: true, alert, checkedAt };
  }

  const noAgent =
    !!snap.notInstalled || isAgentMissing(snap.error);
  if (noAgent) {
    return {
      reach: "no_agent",
      online: false,
      alert: false,
      checkedAt,
    };
  }
  return {
    reach: "ssh_down",
    online: false,
    alert: false,
    checkedAt,
  };
}

/** 按主机名列表汇总三态与告警数（缺状态跳过） */
export function summarizeFleet(
  hostNames: string[],
  statusByHost: Map<string, FleetHostStatus>
): FleetGroupSummary {
  let online = 0;
  let noAgent = 0;
  let sshDown = 0;
  let alert = 0;
  for (const name of hostNames) {
    const s = statusByHost.get(name);
    if (!s) continue;
    if (s.reach === "online") online += 1;
    else if (s.reach === "no_agent") noAgent += 1;
    else sshDown += 1;
    if (s.alert) alert += 1;
  }
  return { online, noAgent, sshDown, alert };
}

// ---------- 模块级单例：多处 useFleetStatus 共享同一份 Map / 同一轮询 ----------

const statusByHost = ref(new Map<string, FleetHostStatus>()) as Ref<
  Map<string, FleetHostStatus>
>;
const loading = ref(false);
const lastError = ref<string | null>(null);

let timer: ReturnType<typeof setInterval> | null = null;
let gen = 0;
let started = false;
/** 当前声明「需要轮询」的 enabled 源 */
const enabledSources: Array<Ref<boolean> | ComputedRef<boolean>> = [];
let visibilityBound = false;

function anyEnabled(): boolean {
  return enabledSources.some((s) => toValue(s));
}

function applyGroups(groups: main.GroupOverview[], checkedAt: number) {
  const next = new Map<string, FleetHostStatus>();
  for (const g of groups) {
    for (const snap of g.hosts || []) {
      if (!snap?.name) continue;
      next.set(snap.name, fleetStatusFromSnapshot(snap, checkedAt));
    }
  }
  statusByHost.value = next;
}

async function refreshNow() {
  const my = ++gen;
  loading.value = true;
  try {
    // ListGroupOverview 含各真实分组 + 未分组（__ungrouped__）
    const groups = await api.listGroupOverview();
    if (my !== gen) return;
    applyGroups(groups || [], Date.now());
    lastError.value = null;
  } catch (e) {
    if (my !== gen) return;
    lastError.value = e instanceof Error ? e.message : String(e);
  } finally {
    if (my === gen) loading.value = false;
  }
}

function stop() {
  started = false;
  gen += 1;
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

function start() {
  if (started) return;
  started = true;
  void refreshNow();
  timer = setInterval(() => {
    if (document.visibilityState === "hidden") return;
    void refreshNow();
  }, POLL_MS);
}

function onVisibility() {
  if (document.visibilityState === "hidden") {
    // 仅停定时器；保留已有 Map，可见时再 start
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    started = false;
    return;
  }
  if (anyEnabled()) {
    start();
  }
}

function syncEnabled() {
  if (anyEnabled() && document.visibilityState !== "hidden") {
    start();
  } else {
    stop();
  }
}

function ensureVisibilityListener() {
  if (visibilityBound || typeof document === "undefined") return;
  visibilityBound = true;
  document.addEventListener("visibilitychange", onVisibility);
}

/**
 * 舰队状态轮询：任一消费者 enabled 时每 15s 拉一次全量 ListGroupOverview。
 * 该接口会扫全部主机，首页/侧栏默认不要 enabled。
 * 多次调用共享同一份 statusByHost。
 */
export function useFleetStatus(opts: {
  enabled: Ref<boolean> | ComputedRef<boolean>;
}) {
  ensureVisibilityListener();

  enabledSources.push(opts.enabled);
  const stopWatch = watch(() => toValue(opts.enabled), syncEnabled, {
    immediate: true,
  });

  onBeforeUnmount(() => {
    stopWatch();
    const idx = enabledSources.indexOf(opts.enabled);
    if (idx >= 0) enabledSources.splice(idx, 1);
    syncEnabled();
  });

  return {
    statusByHost,
    loading,
    lastError,
    start,
    stop,
    refreshNow,
  };
}
