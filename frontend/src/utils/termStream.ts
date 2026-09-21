/**
 * 终端本地流通道：一个终端会话一条独立 WebSocket。
 *
 * 每条连接的 sid 写在 URL 上，因此输入帧不再携带 session 路由字段，输出也不再
 * 经过应用层多路复用。输入/输出使用二进制帧：首字节是类型，后面直接是 UTF-8
 * 内容，避免每个按键都 JSON.stringify / JSON.parse。
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
  socket: WebSocket | null;
  opening: Promise<void> | null;
  reconnectTimer: number;
  heartbeatTimer: number;
  stopped: boolean;
  isDown: boolean;
  decoder: TextDecoder;
};

const paneHandlers = new Map<string, PaneHandler>();
const streams = new Map<string, TermStreamState>();
const fallbackChains = new Map<string, Promise<void>>();
const encoder = new TextEncoder();

let base = "";
let token = "";
let endpointPromise: Promise<void> | null = null;

const FRAME_DATA = 1;
const FRAME_EXIT = 2;
const FRAME_INPUT = 1;

export function registerPane(pane: string, h: PaneHandler): void {
  paneHandlers.set(pane, h);
}

export function unregisterPane(pane: string): void {
  paneHandlers.delete(pane);
}

/** 只加载公共端点；真正的 WebSocket 在每个 sid 建立后单独创建。 */
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

function isCurrent(state: TermStreamState, socket: WebSocket): boolean {
  return streams.get(state.sid) === state && state.socket === socket && !state.stopped;
}

function clearHeartbeat(state: TermStreamState): void {
  if (state.heartbeatTimer) {
    window.clearInterval(state.heartbeatTimer);
    state.heartbeatTimer = 0;
  }
}

function scheduleReconnect(state: TermStreamState): void {
  if (state.stopped || state.reconnectTimer || !base || !token) return;
  state.reconnectTimer = window.setTimeout(() => {
    state.reconnectTimer = 0;
    void connectTermStream(state.sid, state.pane);
  }, 1500);
}

function dispatchLegacyJSON(state: TermStreamState, raw: string): void {
  if (raw === "p") return;
  try {
    const f = JSON.parse(raw) as {
      k?: string;
      p?: { pane?: string; sid?: string; d?: string; reason?: string };
    };
    const pane = f.p?.pane || state.pane;
    const handler = paneHandlers.get(pane);
    if (f.k === "data") handler?.data(f.p?.d || "");
    else if (f.k === "exit") handler?.exit(f.p?.sid || state.sid, f.p?.reason || "");
  } catch {
    // 忽略坏帧。
  }
}

function dispatchBinary(state: TermStreamState, data: ArrayBuffer): void {
  const bytes = new Uint8Array(data);
  if (bytes.length === 0) return;
  const handler = paneHandlers.get(state.pane);
  if (bytes[0] === FRAME_DATA) {
    const text = state.decoder.decode(bytes.subarray(1), { stream: true });
    if (text) handler?.data(text);
  } else if (bytes[0] === FRAME_EXIT) {
    const reason = new TextDecoder().decode(bytes.subarray(1));
    handler?.exit(state.sid, reason);
  }
}

function openSocket(state: TermStreamState): Promise<void> {
  if (state.stopped || !base || !token) return Promise.resolve();

  return new Promise<void>((resolve) => {
    const url = base.replace(/^http/, "ws") +
      `/ws?t=${encodeURIComponent(token)}&sid=${encodeURIComponent(state.sid)}`;
    let socket: WebSocket;
    try {
      socket = new WebSocket(url);
    } catch {
      state.isDown = true;
      resolve();
      scheduleReconnect(state);
      return;
    }
    socket.binaryType = "arraybuffer";
    state.socket = socket;
    let settled = false;
    const settle = () => {
      if (settled) return;
      settled = true;
      resolve();
    };

    socket.onopen = () => {
      if (!isCurrent(state, socket)) {
        socket.close();
        settle();
        return;
      }
      state.isDown = false;
      if (state.reconnectTimer) {
        window.clearTimeout(state.reconnectTimer);
        state.reconnectTimer = 0;
      }
      clearHeartbeat(state);
      state.heartbeatTimer = window.setInterval(() => {
        if (socket.readyState === WebSocket.OPEN) socket.send("p");
      }, 3000);
      settle();
    };

    socket.onmessage = (event: MessageEvent<ArrayBuffer | Blob | string>) => {
      if (!isCurrent(state, socket)) return;
      if (typeof event.data === "string") {
        dispatchLegacyJSON(state, event.data);
      } else if (event.data instanceof ArrayBuffer) {
        dispatchBinary(state, event.data);
      } else {
        void event.data.arrayBuffer().then((data) => {
          if (isCurrent(state, socket)) dispatchBinary(state, data);
        });
      }
    };

    socket.onclose = () => {
      if (!isCurrent(state, socket)) {
        settle();
        return;
      }
      state.isDown = true;
      clearHeartbeat(state);
      state.socket = null;
      settle();
      scheduleReconnect(state);
    };
    socket.onerror = () => {
      if (isCurrent(state, socket)) state.isDown = true;
      // 浏览器随后会触发 onclose；只在 onclose 中安排重连，避免双计时器。
    };
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
      socket: null,
      opening: null,
      reconnectTimer: 0,
      heartbeatTimer: 0,
      stopped: false,
      isDown: true,
      decoder: new TextDecoder(),
    };
    streams.set(sid, state);
  } else {
    state.pane = pane;
    state.stopped = false;
  }
  if (state.socket?.readyState === WebSocket.OPEN) return Promise.resolve();
  if (state.opening) return state.opening;

  const opening = (async () => {
    await ensureTermStream();
    if (!state || state.stopped || !base || !token) return;
    await openSocket(state);
  })().catch(() => {
    // 失败时保持 Wails 回退；onclose 会负责重连。
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
  if (state.reconnectTimer) window.clearTimeout(state.reconnectTimer);
  clearHeartbeat(state);
  streams.delete(sid);
  const socket = state.socket;
  state.socket = null;
  try {
    socket?.close();
  } catch {
    // ignore
  }
}

/** 终端输入：连接可用时同步 send，单字节/多字节都不等待服务端响应。 */
function termWrite(sid: string, d: string): boolean {
  const state = streams.get(sid);
  const socket = state?.socket;
  if (!state || state.isDown || !socket || socket.readyState !== WebSocket.OPEN) return false;
  try {
    const data = encoder.encode(d);
    const frame = new Uint8Array(data.length + 1);
    frame[0] = FRAME_INPUT;
    frame.set(data, 1);
    socket.send(frame);
    return true;
  } catch {
    state.isDown = true;
    return false;
  }
}

// 保留旧调用名，避免组件侧把输入误认为异步网络事务；现在只做一次同步 send。
export function termWriteQueued(sid: string, d: string): Promise<boolean> {
  return Promise.resolve(termWrite(sid, d));
}

/** 终端输入统一入口：流通道失败时仅按当前 sid 串行回退 binding。 */
export function termWriteFast(sid: string, d: string): Promise<void> {
  if (termWrite(sid, d)) return Promise.resolve();
  const previous = fallbackChains.get(sid) || Promise.resolve();
  const current = previous.catch(() => {}).then(() => api.writeTerminal(sid, d));
  fallbackChains.set(sid, current);
  void current.finally(() => {
    if (fallbackChains.get(sid) === current) fallbackChains.delete(sid);
  }).catch(() => {});
  return current;
}
