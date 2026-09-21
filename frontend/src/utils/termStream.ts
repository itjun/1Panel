/**
 * 终端本地流通道：一个终端会话一条独立 WebSocket。
 *
 * 每条连接的 sid 写在 URL 上，因此输入帧不再携带 session 路由字段，输出也不再
 * 经过应用层多路复用。每个 sid 的 WebSocket、二进制解码和输入/输出队列都放进
 * 一个 DedicatedWorker，UI 主线程只负责 xterm 的最终绘制。
 *
 * 失败兜底：拿不到端点或某条连接断开时，该 sid 单独回退 Wails binding；其它终端
 * 的 WebSocket、队列和重连计时器不受影响。输出由 Go 侧按 sid 选择 WS，否则回退
 * Wails Events，连接恢复后自动切回。
 */
import { api } from "@/api";

type PaneHandler = {
  data: (d: string) => void;
  exit: (sid: string, reason: string) => void;
};

type TermStreamState = {
  sid: string;
  pane: string;
  worker: Worker | null;
  opening: Promise<void> | null;
  workerRetryTimer: number;
  stopped: boolean;
  mode: "connecting" | "ready" | "down";
};

const paneHandlers = new Map<string, PaneHandler>();
const streams = new Map<string, TermStreamState>();
const fallbackChains = new Map<string, Promise<void>>();

let base = "";
let token = "";
let endpointPromise: Promise<void> | null = null;

export function registerPane(pane: string, h: PaneHandler): void {
  paneHandlers.set(pane, h);
}

export function unregisterPane(pane: string): void {
  paneHandlers.delete(pane);
}

/** 只加载公共端点；真正的 WebSocket 在每个 sid 的 Worker 中建立。 */
export function ensureTermStream(): Promise<void> {
  if (base && token) return Promise.resolve();
  if (endpointPromise) return endpointPromise;
  endpointPromise = (async () => {
    try {
      const info = JSON.parse(await api.termStreamEndpoint()) as { base: string; token: string };
      if (info.base && info.token) {
        base = info.base;
        token = info.token;
      }
    } catch {
      // 拿不到端点：所有 sid 使用原有 Wails 通道。
    }
  })().finally(() => {
    endpointPromise = null;
  });
  return endpointPromise;
}

type WorkerEvent =
  | { type: "ready" }
  | { type: "down" }
  | { type: "data"; data: string }
  | { type: "fallback"; data: string }
  | { type: "exit"; reason: string };

function queueFallback(sid: string, data: string): Promise<void> {
  const previous = fallbackChains.get(sid) || Promise.resolve();
  const current = previous.catch(() => {}).then(() => api.writeTerminal(sid, data));
  fallbackChains.set(sid, current);
  void current.finally(() => {
    if (fallbackChains.get(sid) === current) fallbackChains.delete(sid);
  }).catch(() => {});
  return current;
}

function scheduleWorkerRetry(state: TermStreamState): void {
  if (state.stopped || state.workerRetryTimer || !base || !token) return;
  state.workerRetryTimer = window.setTimeout(() => {
    state.workerRetryTimer = 0;
    if (streams.get(state.sid) === state && !state.stopped && !state.worker) {
      void connectTermStream(state.sid, state.pane);
    }
  }, 1500);
}

function postWorkerInput(state: TermStreamState, data: string): boolean {
  const worker = state.worker;
  if (!worker || state.stopped) return false;
  try {
    worker.postMessage({ type: "input", data });
    return true;
  } catch {
    state.worker = null;
    state.mode = "down";
    worker.terminate();
    scheduleWorkerRetry(state);
    return false;
  }
}

function handleWorkerEvent(
  state: TermStreamState,
  event: WorkerEvent,
  settle: () => void
): void {
  if (streams.get(state.sid) !== state || state.stopped) return;
  if (event.type === "ready") {
    state.mode = "ready";
    if (state.workerRetryTimer) {
      window.clearTimeout(state.workerRetryTimer);
      state.workerRetryTimer = 0;
    }
    settle();
    return;
  }
  if (event.type === "down") {
    state.mode = "down";
    settle();
    return;
  }
  if (event.type === "fallback") {
    void queueFallback(state.sid, event.data).catch(() => {});
    return;
  }
  const handler = paneHandlers.get(state.pane);
  if (event.type === "data") handler?.data(event.data);
  else if (event.type === "exit") handler?.exit(state.sid, event.reason);
}

function startWorker(state: TermStreamState): Promise<void> {
  return new Promise<void>((resolve) => {
    let worker: Worker;
    try {
      worker = new Worker(new URL("../workers/termStreamWorker.ts", import.meta.url), {
        type: "module",
      });
    } catch {
      state.mode = "down";
      resolve();
      return;
    }
    state.worker = worker;
    let settled = false;
    const settle = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    const failWorker = () => {
      if (streams.get(state.sid) !== state || state.stopped) return;
      if (state.worker === worker) state.worker = null;
      state.mode = "down";
      worker.terminate();
      settle();
      scheduleWorkerRetry(state);
    };
    worker.onmessage = (event: MessageEvent<WorkerEvent>) => {
      handleWorkerEvent(state, event.data, settle);
    };
    worker.onerror = () => {
      failWorker();
    };
    worker.onmessageerror = () => {
      failWorker();
    };
    try {
      worker.postMessage({ type: "connect", base, token, sid: state.sid });
    } catch {
      failWorker();
    }
  });
}

/** 为一个 PTY sid 建立独立的 WebSocket；重复调用只复用该 sid 自己的连接。 */
export function connectTermStream(sid: string, pane: string): Promise<void> {
  if (!sid) return Promise.resolve();
  let state = streams.get(sid);
  if (!state) {
    state = {
      sid,
      pane,
      worker: null,
      opening: null,
      workerRetryTimer: 0,
      stopped: false,
      mode: "connecting",
    };
    streams.set(sid, state);
  } else {
    state.pane = pane;
    state.stopped = false;
  }
  if (state.worker) return state.opening || Promise.resolve();
  if (state.opening) return state.opening;

  const opening = (async () => {
    await ensureTermStream();
    if (!state || state.stopped || !base || !token) return;
    state.mode = "connecting";
    await startWorker(state);
  })().catch(() => {
    // 失败时保持 Wails 回退；输入入口会按 sid 串行发送。
  });
  state.opening = opening;
  void opening.finally(() => {
    if (state && state.opening === opening) state.opening = null;
  }).catch(() => {});
  return opening;
}

/** 关闭指定终端的本地流，不会影响任何其它 sid。 */
export function closeTermStream(sid: string): void {
  const state = streams.get(sid);
  if (!state) return;
  state.stopped = true;
  streams.delete(sid);
  if (state.workerRetryTimer) window.clearTimeout(state.workerRetryTimer);
  state.workerRetryTimer = 0;
  try {
    state.worker?.postMessage({ type: "stop" });
  } catch {
    // Worker 已经失效时直接终止即可。
  }
  state.worker?.terminate();
  state.worker = null;
}

/** 终端输入：Worker 可用时只 postMessage，不在 UI 线程触碰 WebSocket。 */
function termWrite(sid: string, d: string): boolean {
  const state = streams.get(sid);
  if (!state || state.stopped || !state.worker) return false;
  return postWorkerInput(state, d);
}

// 保留旧调用名，避免组件侧把输入误认为异步网络事务。
export function termWriteQueued(sid: string, d: string): Promise<boolean> {
  return Promise.resolve(termWrite(sid, d));
}

/** 终端输入统一入口：流通道失败时仅按当前 sid 串行回退 binding。 */
export function termWriteFast(sid: string, d: string): Promise<void> | undefined {
  const state = streams.get(sid);
  if (state?.mode === "ready") {
    const previous = fallbackChains.get(sid);
    if (previous) {
      return previous.catch(() => {}).then(() => {
        const current = streams.get(sid);
        if (current?.mode === "ready" && current.worker && !current.stopped) {
          if (postWorkerInput(current, d)) return;
        }
        return queueFallback(sid, d);
      });
    }
    if (postWorkerInput(state, d)) return undefined;
    return queueFallback(sid, d);
  }
  if (state?.mode === "connecting" && termWrite(sid, d)) return undefined;
  return queueFallback(sid, d);
}
