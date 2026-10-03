/**
 * 测速任务的前端状态：模块级单例，切页 / 切模块后回来仍能看到进行中的曲线。
 * 后端同一时间只跑一个任务，这里也只保存一份。
 */
import { Events } from "@wailsio/runtime";
import { useSyncExternalStore } from "react";
import type { speedtest } from "@/api";

export type RunKind = "pair" | "star" | "mesh";

/** 与 internal/speedtest/service.go、batch.go 的事件结构对应 */
type StateEvent = {
  runId: string;
  phase: string;
  message: string;
  summary?: speedtest.Summary | null;
  recordId?: string;
};
type SampleEvent = { runId: string; pair: number; sample: speedtest.Sample };
type BatchEvent = {
  batchId: string;
  index: number;
  total: number;
  pair?: speedtest.PairResult | null;
  pairs?: speedtest.PairResult[] | null;
};

export type RunState = {
  id: string;
  kind: RunKind;
  /** prepare / provision / probe / running / done / failed / stopped */
  phase: string;
  message: string;
  startedAt: number;
  a?: string;
  b?: string;
  group?: string;
  params?: speedtest.Params;
  path?: speedtest.Candidate | null;
  samples: speedtest.Sample[];
  summary?: speedtest.Summary | null;
  recordId?: string;
  pairs: speedtest.PairResult[];
  pairIndex: number;
  pairSamples: speedtest.Sample[];
};

const FINISHED = new Set(["done", "failed", "stopped"]);

let state: RunState | null = null;
/** Start 调用已发出、ID 未返回期间先到的事件直接认领 */
let pending = false;
const listeners = new Set<() => void>();
let subscribed = false;

function emit() {
  for (const fn of listeners) fn();
}

function set(next: RunState | null) {
  state = next;
  emit();
}

function accepts(runId: string): boolean {
  if (!state) return false;
  if (state.id) return state.id === runId;
  if (pending) {
    state = { ...state, id: runId };
    return true;
  }
  return false;
}

function ensureSubscribed() {
  if (subscribed) return;
  subscribed = true;
  Events.On("speedtest-state", (ev: { data?: StateEvent }) => {
    const d = ev?.data;
    if (!d || !accepts(d.runId) || !state) return;
    set({
      ...state,
      phase: d.phase,
      message: d.message,
      summary: d.summary ?? state.summary,
      recordId: d.recordId || state.recordId,
    });
  });
  Events.On("speedtest-sample", (ev: { data?: SampleEvent }) => {
    const d = ev?.data;
    if (!d || !accepts(d.runId) || !state) return;
    if (d.pair >= 0) {
      const pairSamples = d.pair === state.pairIndex ? [...state.pairSamples, d.sample] : [d.sample];
      set({ ...state, pairIndex: d.pair, pairSamples });
    } else {
      set({ ...state, samples: [...state.samples, d.sample] });
    }
  });
  Events.On("speedtest-batch", (ev: { data?: BatchEvent }) => {
    const d = ev?.data;
    if (!d || !accepts(d.batchId) || !state) return;
    if (d.index < 0) {
      set({ ...state, pairs: d.pairs || [] });
      return;
    }
    if (!d.pair) return;
    const pairs = state.pairs.slice();
    pairs[d.index] = d.pair;
    const running = d.pair.status === "running";
    set({
      ...state,
      pairs,
      pairIndex: running ? d.index : state.pairIndex,
      pairSamples: running && d.index !== state.pairIndex ? [] : state.pairSamples,
    });
  });
}

export const speedtestStore = {
  get: () => state,
  isRunning: () => !!state && !FINISHED.has(state.phase),
  /** 发起前调用：清空上次结果并进入等待认领状态 */
  begin(init: Omit<RunState, "id" | "phase" | "message" | "startedAt" | "samples" | "pairs" | "pairIndex" | "pairSamples">) {
    ensureSubscribed();
    pending = true;
    set({
      ...init,
      id: "",
      phase: "prepare",
      message: "准备中",
      startedAt: Date.now(),
      samples: [],
      pairs: [],
      pairIndex: -1,
      pairSamples: [],
    });
  },
  /** Start 返回 ID 后确认 */
  confirm(id: string) {
    pending = false;
    if (state) set({ ...state, id });
  },
  fail(message: string) {
    pending = false;
    if (state) set({ ...state, phase: "failed", message });
  },
  /** 页面挂载时：后端仍有任务而前端没有状态（如重载页面），恢复一个占位 */
  adopt(id: string) {
    ensureSubscribed();
    if (state?.id === id) return;
    set({
      id,
      kind: "pair",
      phase: "running",
      message: "测速进行中",
      startedAt: Date.now(),
      samples: [],
      pairs: [],
      pairIndex: -1,
      pairSamples: [],
    });
  },
  subscribe(fn: () => void) {
    ensureSubscribed();
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};

export function useSpeedtestRun(): RunState | null {
  return useSyncExternalStore(speedtestStore.subscribe, speedtestStore.get, speedtestStore.get);
}

export function isFinished(phase: string | undefined): boolean {
  return !!phase && FINISHED.has(phase);
}
