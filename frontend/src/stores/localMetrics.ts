import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { api } from "@/api";
import type { localsys } from "@/api";
import { bytesToKBps } from "@/utils/format";

const POLL_MS = 2000;
/** 曲线落点节流（秒） */
const CHART_GRAIN_SEC = 5;
const WINDOW = 100;

export type CpuPoint = {
  time: string;
  total: number;
  perf: number;
  eff: number;
};
export type MemPoint = { time: string; phys: number; swap: number };
export type IOPoint = { time: string; read: number; write: number };

function liveTimeLabel(ms: number): string {
  return new Date(ms).toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

/**
 * 本机指标静默采集：客户端运行即轮询，内存滑动窗口。
 * CPU：全核心 + 性能核 + 能效核；内存：物理 + 交换；磁盘 IO。
 */
export const useLocalMetricsStore = defineStore("localMetrics", () => {
  const overview = ref<localsys.Overview | null>(null);
  const error = ref<string | null>(null);
  const loading = ref(false);

  const cpuSeries = ref<CpuPoint[]>([]);
  const memSeries = ref<MemPoint[]>([]);
  const ioSeries = ref<IOPoint[]>([]);
  const ioRates = ref({ readBps: 0, writeBps: 0, iops: 0 });
  const memTotalBytes = ref(0);
  const swapTotalBytes = ref(0);

  let lastDisk: { read: number; write: number; count: number; ts: number } | null =
    null;
  let lastChartAt = 0;
  let timer: ReturnType<typeof setInterval> | null = null;
  let started = false;
  let tickGen = 0;

  const hasData = computed(() => !!overview.value);
  const hasCpuClusters = computed(() => {
    const o = overview.value;
    return !!o && (o.perfCores > 0 || o.effCores > 0);
  });

  function takeChartSlot(now: number): boolean {
    const need = CHART_GRAIN_SEC * 1000;
    if (lastChartAt > 0 && now - lastChartAt < need) return false;
    lastChartAt = now;
    return true;
  }

  function pushDiskIO(data: localsys.Overview, appendChart: boolean) {
    const now = Date.now();
    const read = Number(data.diskReadBytes) || 0;
    const write = Number(data.diskWriteBytes) || 0;
    const count = Number(data.diskIOCount) || 0;
    const prev = lastDisk;
    lastDisk = { read, write, count, ts: now };
    if (!prev || now <= prev.ts || read < prev.read || write < prev.write) {
      if (appendChart) {
        ioSeries.value = [
          ...ioSeries.value,
          { time: liveTimeLabel(now), read: 0, write: 0 },
        ].slice(-WINDOW);
      }
      return;
    }
    const dt = now - prev.ts;
    ioRates.value = {
      readBps: ((read - prev.read) / dt) * 1000,
      writeBps: ((write - prev.write) / dt) * 1000,
      iops: Math.round(((count - prev.count) / dt) * 1000),
    };
    if (!appendChart) return;
    ioSeries.value = [
      ...ioSeries.value,
      {
        time: liveTimeLabel(now),
        read: bytesToKBps(read - prev.read, dt),
        write: bytesToKBps(write - prev.write, dt),
      },
    ].slice(-WINDOW);
  }

  function pushCpuMem(data: localsys.Overview) {
    const time = liveTimeLabel(Date.now());
    cpuSeries.value = [
      ...cpuSeries.value,
      {
        time,
        total: Number(data.cpuPercent) || 0,
        perf: Number(data.perfCpuPercent) || 0,
        eff: Number(data.effCpuPercent) || 0,
      },
    ].slice(-WINDOW);
    memSeries.value = [
      ...memSeries.value,
      {
        time,
        phys: Number(data.memUsed) || 0,
        swap: Number(data.swapUsed) || 0,
      },
    ].slice(-WINDOW);
  }

  function ingest(data: localsys.Overview) {
    overview.value = data;
    const total = Number(data.memTotal) || 0;
    if (total > 0 && total !== memTotalBytes.value) {
      memTotalBytes.value = total;
    }
    const swapTotal = Number(data.swapTotal) || 0;
    if (swapTotal !== swapTotalBytes.value) {
      swapTotalBytes.value = swapTotal;
    }
    const append = takeChartSlot(Date.now());
    pushDiskIO(data, append);
    if (append) pushCpuMem(data);
  }

  async function tick() {
    const my = ++tickGen;
    if (!overview.value) loading.value = true;
    try {
      const data = await api.localSysOverview();
      if (my !== tickGen) return;
      ingest(data);
      error.value = null;
    } catch (e) {
      if (my !== tickGen) return;
      error.value = e instanceof Error ? e.message : String(e);
    } finally {
      if (my === tickGen) loading.value = false;
    }
  }

  function start() {
    if (started) return;
    started = true;
    void tick();
    timer = setInterval(() => void tick(), POLL_MS);
  }

  function stop() {
    started = false;
    tickGen += 1;
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  return {
    overview,
    error,
    loading,
    hasData,
    hasCpuClusters,
    cpuSeries,
    memSeries,
    ioSeries,
    ioRates,
    memTotalBytes,
    swapTotalBytes,
    start,
    stop,
    tick,
  };
});
