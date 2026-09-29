import { useSyncExternalStore } from "react";
import { api, type localsys } from "@/api";
import { bytesToKBps } from "@/utils/format";

const POLL_MS = 2000;
/** 曲线落点节流（秒） */
const CHART_GRAIN_SEC = 5;
const WINDOW = 100;

/** 单值曲线点：CPU 为百分比，负载为 load1 */
export type ValuePoint = { time: string; value: number };
/** 内存曲线点：已用与交换已用，单位字节 */
export type MemPoint = { time: string; used: number; swap: number };
/** 读写速率，单位 KB/s（与远端监控一致，配 formatRateKBps / binaryAxis(-1)） */
export type IOPoint = { time: string; read: number; write: number };
/** 网络收发速率，单位 KB/s */
export type NetPoint = { time: string; rx: number; tx: number };

export type LocalMetricsState = {
  overview: localsys.Overview | null;
  error: string | null;
  cpuSeries: ValuePoint[];
  loadSeries: ValuePoint[];
  memSeries: MemPoint[];
  netSeries: NetPoint[];
  ioSeries: IOPoint[];
};

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function liveTimeLabel(ms: number): string {
  const d = new Date(ms);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

/*
 * 采样缓冲放在模块级：页面卸载不丢，切走再切回曲线连续。
 * 首个订阅者触发轮询，之后在应用生命周期内一直采样，不随订阅者清零停表。
 */
let state: LocalMetricsState = {
  overview: null,
  error: null,
  cpuSeries: [],
  loadSeries: [],
  memSeries: [],
  netSeries: [],
  ioSeries: [],
};
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;
let inflight: Promise<void> | null = null;
let lastChartAt = 0;
let lastDisk: { read: number; write: number; ts: number } | null = null;
let lastNet: { rx: number; tx: number; ts: number } | null = null;

function setState(patch: Partial<LocalMetricsState>) {
  state = { ...state, ...patch };
  for (const listener of listeners) listener();
}

function appendPoint<T>(list: T[], point: T): T[] {
  return [...list, point].slice(-WINDOW);
}

/** 磁盘 IO 需要上一次累计值才能算速率：无基准或计数回绕时只记基准、不落点 */
function nextIoSeries(data: localsys.Overview, now: number, time: string): IOPoint[] {
  const read = Number(data.diskReadBytes) || 0;
  const write = Number(data.diskWriteBytes) || 0;
  const prev = lastDisk;
  lastDisk = { read, write, ts: now };
  if (!prev) return state.ioSeries;
  if (now <= prev.ts || read < prev.read || write < prev.write) return state.ioSeries;
  const dt = now - prev.ts;
  return appendPoint(state.ioSeries, {
    time,
    read: bytesToKBps(read - prev.read, dt),
    write: bytesToKBps(write - prev.write, dt),
  });
}

/** 网络流量同磁盘 IO：无基准或计数回绕时只记基准、不落点 */
function nextNetSeries(data: localsys.Overview, now: number, time: string): NetPoint[] {
  const rx = Number(data.netRxBytes) || 0;
  const tx = Number(data.netTxBytes) || 0;
  const prev = lastNet;
  lastNet = { rx, tx, ts: now };
  if (!prev) return state.netSeries;
  if (now <= prev.ts || rx < prev.rx || tx < prev.tx) return state.netSeries;
  const dt = now - prev.ts;
  return appendPoint(state.netSeries, {
    time,
    rx: bytesToKBps(rx - prev.rx, dt),
    tx: bytesToKBps(tx - prev.tx, dt),
  });
}

function ingest(data: localsys.Overview) {
  const now = Date.now();
  const needAppend = lastChartAt === 0 || now - lastChartAt >= CHART_GRAIN_SEC * 1000;
  if (!needAppend) {
    setState({ overview: data, error: null });
    return;
  }
  lastChartAt = now;
  const time = liveTimeLabel(now);
  setState({
    overview: data,
    error: null,
    cpuSeries: appendPoint(state.cpuSeries, { time, value: Number(data.cpuPercent) || 0 }),
    loadSeries: appendPoint(state.loadSeries, { time, value: Number(data.load1) || 0 }),
    memSeries: appendPoint(state.memSeries, {
      time,
      used: Number(data.memUsed) || 0,
      swap: Number(data.swapUsed) || 0,
    }),
    netSeries: nextNetSeries(data, now, time),
    ioSeries: nextIoSeries(data, now, time),
  });
}

function tick(): Promise<void> {
  if (inflight) return inflight;
  inflight = api
    .localSysOverview()
    .then(ingest)
    .catch((e: unknown) => {
      setState({ error: e instanceof Error ? e.message : String(e) });
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!timer) {
    void tick();
    timer = setInterval(() => void tick(), POLL_MS);
  }
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot() {
  return state;
}

/** 立即采一次（页面刷新按钮用），与定时轮询共用同一次请求 */
export function refreshLocalMetrics(): Promise<void> {
  return tick();
}

/** 本机指标：最新 Overview + CPU / 负载 / 内存 / 流量 / 磁盘 IO 滑动窗口（概览与监控页共享） */
export function useLocalMetrics(): LocalMetricsState {
  return useSyncExternalStore(subscribe, getSnapshot);
}
