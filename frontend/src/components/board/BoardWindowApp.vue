<template>
  <BoardModeOverlay
    :group-name="groupName"
    :board-title="boardTitle"
    :hosts="hosts"
    :cards="cards"
    :trends="trends"
    @exit="onExit"
    @open-host="onOpenHost"
  />
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { Events, Window } from "@wailsio/runtime";
import { api } from "@/api";
import type { monitor, sshconfig } from "@/api";
import { UNGROUPED_ID } from "@/stores/app";
import { useSettingsStore } from "@/stores/settings";
import { formatErr, isAgentMissing } from "@/utils/format";
import { watchServiceSortKey } from "@/utils/watchServices";
import BoardModeOverlay, {
  type BoardAppSubItem,
  type BoardHostCard,
  type BoardHostTrend,
} from "@/components/board/BoardModeOverlay.vue";

const POLL_MS = 3000;
/** 近 1h 趋势与 overview 分开轮询，避免堵瞬时采集 */
const RANGE_POLL_MS = 30000;
const TREND_MAX_POINTS = 60;
const TREND_WINDOW_SEC = 3600;

function readGroupIdFromQuery(): string {
  const params = new URLSearchParams(location.search);
  return (params.get("groupId") || "").trim();
}

const settings = useSettingsStore();
const groupId = ref(readGroupIdFromQuery());
const groupName = ref("分组");
const boardTitle = ref("");
const hosts = ref<sshconfig.HostConfig[]>([]);

interface HostSnap {
  loading: boolean;
  overview?: monitor.Overview;
  disks?: monitor.DiskInfo[];
  error?: string;
  errorAt?: number;
}

const hostStates = ref<Record<string, HostSnap>>({});
/** 主机 → 服务名 → 实例数（探活表行数） */
const instanceCounts = ref<Record<string, Record<string, number>>>({});
const trends = ref<Record<string, BoardHostTrend>>({});
const inFlight = new Set<string>();
const rangeInFlight = new Set<string>();
const instInFlight = new Set<string>();
let alive = true;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let rangePollTimer: ReturnType<typeof setInterval> | null = null;

function errTimeSuffix(at?: number): string {
  if (!at) return "";
  const d = new Date(at);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `（${hh}:${mm}）`;
}

function withErrTime(err: string, at?: number): string {
  if (at) return err + errTimeSuffix(at);
  return err;
}

function buildAppSubItems(hostName: string): BoardAppSubItem[] | null {
  if (!settings.hasAppNotifyConfig(hostName)) return null;
  const subs = settings.listAppNotifySubs(hostName);
  const counts = instanceCounts.value[hostName] || {};
  return [...subs]
    .sort((a, b) => watchServiceSortKey(a) - watchServiceSortKey(b))
    .map((name) => ({
      name,
      count: counts[name] || 0,
    }));
}

const cards = computed<Record<string, BoardHostCard>>(() => {
  // 依赖订阅 map / 实例计数，hydrate 与探活刷新后能更新看板
  void settings.hostAppNotifySubs;
  void instanceCounts.value;
  const out: Record<string, BoardHostCard> = {};
  for (const h of hosts.value) {
    const s = hostStates.value[h.name] || { loading: true };
    out[h.name] = {
      loading: s.loading,
      overview: s.overview,
      disks: s.disks,
      error: s.error ? withErrTime(s.error, s.errorAt) : undefined,
      appSubItems: buildAppSubItems(h.name),
    };
  }
  return out;
});

/** 点数过多时均匀抽稀到约 maxN */
function downsample(values: number[], maxN: number): number[] {
  if (values.length <= maxN) return values;
  if (maxN < 2) return values.slice(0, maxN);
  const out: number[] = [];
  const last = values.length - 1;
  for (let i = 0; i < maxN; i++) {
    const idx = Math.round((i / (maxN - 1)) * last);
    out.push(values[idx]);
  }
  return out;
}

function emptyTrend(): BoardHostTrend {
  return { cpu: [], mem: [] };
}

async function loadMeta() {
  const gid = groupId.value;
  const [allHosts, groups] = await Promise.all([
    api.listHosts(),
    api.listGroups(),
  ]);
  if (!alive || gid !== groupId.value) return;

  if (gid === UNGROUPED_ID) {
    const assigned = new Set<string>();
    for (const g of groups) {
      for (const name of g.hosts || []) assigned.add(name);
    }
    hosts.value = allHosts.filter((h) => !assigned.has(h.name));
    groupName.value = "未分组";
    boardTitle.value = "";
  } else {
    const g = groups.find((x) => x.id === gid);
    groupName.value = g?.name || "分组";
    boardTitle.value = (g?.boardTitle || "").trim();
    const names = new Set(g?.hosts || []);
    hosts.value = allHosts.filter((h) => names.has(h.name));
  }

  try {
    await Window.SetTitle(`看板 · ${groupName.value}`);
  } catch {
    /* 忽略：标题已在创建窗时设过 */
  }

  const fresh: Record<string, HostSnap> = {};
  const freshTrends: Record<string, BoardHostTrend> = {};
  for (const h of hosts.value) {
    fresh[h.name] = hostStates.value[h.name] ?? { loading: true };
    freshTrends[h.name] = trends.value[h.name] ?? emptyTrend();
  }
  hostStates.value = fresh;
  trends.value = freshTrends;
  for (const h of hosts.value) {
    void loadOne(h.name, !fresh[h.name].overview);
    void loadRange(h.name);
    void loadInstances(h.name);
  }
}

async function loadInstances(name: string) {
  if (!settings.hasAppNotifyConfig(name)) return;
  if (instInFlight.has(name)) return;
  if (!alive) return;
  const prev = hostStates.value[name];
  if (prev?.error && isAgentMissing(prev.error)) return;
  instInFlight.add(name);
  try {
    const rows = await api.agentWatchInstances(name);
    if (!alive) return;
    const counts: Record<string, number> = {};
    for (const r of rows || []) {
      const svc = (r.service || "").trim();
      if (!svc) continue;
      counts[svc] = (counts[svc] || 0) + 1;
    }
    instanceCounts.value = {
      ...instanceCounts.value,
      [name]: counts,
    };
  } catch {
    if (!alive) return;
    // 探活失败时保留上次计数，避免闪空
  } finally {
    instInFlight.delete(name);
  }
}

async function loadOne(name: string, showSkeleton: boolean, force = false) {
  if (inFlight.has(name)) return;
  if (!alive) return;
  const prev = hostStates.value[name];
  if (!force && prev?.error && isAgentMissing(prev.error)) return;
  inFlight.add(name);
  if (showSkeleton) {
    hostStates.value[name] = { loading: true };
  }
  try {
    const [ov, disks] = await Promise.all([
      api.collectOverview(name),
      api.collectDisks(name),
    ]);
    if (!alive) return;
    hostStates.value[name] = {
      loading: false,
      overview: ov,
      disks: disks ?? [],
      error: undefined,
    };
    // overview 后到时：若已有 cpu 趋势但 mem 因缺 memTotal 为空，补拉一次 range
    const t = trends.value[name];
    if (ov.memTotal > 0 && t && t.cpu.length > 0 && t.mem.length === 0) {
      void loadRange(name);
    }
  } catch (e) {
    if (!alive) return;
    hostStates.value[name] = {
      loading: false,
      error: formatErr(e),
      errorAt: Date.now(),
    };
  } finally {
    inFlight.delete(name);
  }
}

async function loadRange(name: string) {
  if (rangeInFlight.has(name)) return;
  if (!alive) return;
  rangeInFlight.add(name);
  try {
    const now = Math.floor(Date.now() / 1000);
    const r = await api.agentRange(name, now - TREND_WINDOW_SEC, now, "auto");
    if (!alive) return;
    const pts = r.points || [];
    const memTotal = hostStates.value[name]?.overview?.memTotal || 0;

    const cpuRaw: number[] = [];
    const memRaw: number[] = [];
    for (const p of pts) {
      cpuRaw.push(Number(p.cpuPercent) || 0);
      if (memTotal > 0) {
        memRaw.push(((Number(p.memUsed) || 0) / memTotal) * 100);
      }
    }

    trends.value = {
      ...trends.value,
      [name]: {
        cpu: downsample(cpuRaw, TREND_MAX_POINTS),
        mem: memTotal > 0 ? downsample(memRaw, TREND_MAX_POINTS) : [],
      },
    };
  } catch {
    if (!alive) return;
    // agent 失败 / 未装：趋势空，瞬时值照常
    trends.value = {
      ...trends.value,
      [name]: emptyTrend(),
    };
  } finally {
    rangeInFlight.delete(name);
  }
}

function startPoll() {
  stopPoll();
  pollTimer = setInterval(() => {
    if (!alive) return;
    for (const h of hosts.value) {
      void loadOne(h.name, false);
      void loadInstances(h.name);
    }
  }, POLL_MS);
}

function stopPoll() {
  if (pollTimer != null) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

function startRangePoll() {
  stopRangePoll();
  // 挂载后立即由 loadMeta 拉一次；此处只定时
  rangePollTimer = setInterval(() => {
    if (!alive) return;
    void settings.hydrateNotifySubs();
    for (const h of hosts.value) {
      void loadRange(h.name);
    }
  }, RANGE_POLL_MS);
}

function stopRangePoll() {
  if (rangePollTimer != null) {
    clearInterval(rangePollTimer);
    rangePollTimer = null;
  }
}

function onOpenHost(name: string) {
  void Events.Emit("board-open-host", { name });
}

async function onExit() {
  const gid = groupId.value;
  try {
    await api.closeBoardWindow(gid);
  } catch {
    try {
      await Window.Close();
    } catch {
      /* 忽略 */
    }
  }
}

onMounted(() => {
  void settings.hydrateNotifySubs();
  void loadMeta();
  startPoll();
  startRangePoll();
});

onBeforeUnmount(() => {
  stopPoll();
  stopRangePoll();
  alive = false;
});
</script>
