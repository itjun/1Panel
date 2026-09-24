/**
 * 记录工具切换耗时、后台调用次数和事件监听数。
 * 只写入 localStorage，不画到界面上。
 */

const KEY = "1pannel-ux-perf";

export interface UxPerfState {
  startedAt: number;
  calls: number;
  listeners: number;
  byName: Record<string, number>;
  switches: { at: number; tool: string; ms: number }[];
}

const state: UxPerfState = {
  startedAt: Date.now(),
  calls: 0,
  listeners: 0,
  byName: {},
  switches: [],
};

let flushTimer = 0;

export function noteBackendCall(name: string) {
  state.calls += 1;
  state.byName[name] = (state.byName[name] || 0) + 1;
  scheduleFlush();
}

export function noteListener(delta: number) {
  state.listeners += delta;
  if (state.listeners < 0) state.listeners = 0;
  scheduleFlush();
}

/** 工具切换从点击处理到下一帧绘制的耗时 */
export function noteSwitch(tool: string, ms: number) {
  state.switches.push({
    at: Date.now(),
    tool,
    ms: Math.round(ms),
  });
  if (state.switches.length > 40) state.switches.shift();
  flushUxPerf();
}

function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = window.setTimeout(() => {
    flushTimer = 0;
    flushUxPerf();
  }, 500);
}

export function flushUxPerf() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* 隐私模式等写不进去时忽略 */
  }
}
