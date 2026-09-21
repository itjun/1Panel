/**
 * 一个 PTY 对应一个 DedicatedWorker。
 *
 * Worker 持有 WebSocket、TextDecoder、输入缓冲和输出合并窗口，主线程只接收
 * 已解码的文本并交给 xterm 绘制。xterm 的 Canvas 仍然必须在 UI 线程上，这里
 * 刻意不把“独立 Worker”描述成“独立 Canvas 主线程”。
 */

type WorkerCommand =
  | { type: "connect"; base: string; token: string; sid: string }
  | { type: "input"; data: string }
  | { type: "stop" };

type WorkerEvent =
  | { type: "ready" }
  | { type: "down" }
  | { type: "data"; data: string }
  | { type: "fallback"; data: string }
  | { type: "exit"; reason: string };

const workerScope = self as unknown as {
  onmessage: ((event: MessageEvent<WorkerCommand>) => void) | null;
  postMessage(message: WorkerEvent): void;
};

const FRAME_DATA = 1;
const FRAME_EXIT = 2;
const FRAME_INPUT = 1;
const RECONNECT_MS = 1500;
const IDLE_THRESHOLD_MS = 4;
const COALESCE_WINDOW_MS = 1;
const MAX_OUTPUT = 16 * 1024;

let sid = "";
let base = "";
let token = "";
let socket: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let stopped = false;
let mode: "connecting" | "ready" | "down" = "down";
let pendingInput = "";
let outputBuffer = "";
let outputTimer: ReturnType<typeof setTimeout> | null = null;
let lastOutputAt = 0;
let decoder = new TextDecoder();
const encoder = new TextEncoder();

function emit(message: WorkerEvent): void {
  workerScope.postMessage(message);
}

function clearTimers(): void {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
  if (outputTimer) {
    clearTimeout(outputTimer);
    outputTimer = null;
  }
}

function flushOutput(): void {
  if (outputTimer) {
    clearTimeout(outputTimer);
    outputTimer = null;
  }
  if (!outputBuffer) return;
  const data = outputBuffer;
  outputBuffer = "";
  lastOutputAt = performance.now();
  emit({ type: "data", data });
}

function queueOutput(data: string): void {
  if (!data) return;
  const now = performance.now();
  // 空闲后的首包通常是按键回显，leading-edge 立即送出，避免 Worker 自己引入
  // 一帧尾延迟；连续输出才进入短合并窗口。
  if (!outputBuffer && now - lastOutputAt >= IDLE_THRESHOLD_MS) {
    lastOutputAt = now;
    emit({ type: "data", data });
    return;
  }
  outputBuffer += data;
  if (outputBuffer.length >= MAX_OUTPUT) {
    flushOutput();
    return;
  }
  if (!outputTimer) {
    outputTimer = setTimeout(flushOutput, COALESCE_WINDOW_MS);
  }
}

function sendFrame(data: string): boolean {
  if (!socket || socket.readyState !== WebSocket.OPEN || !data) return false;
  try {
    const encoded = encoder.encode(data);
    const frame = new Uint8Array(encoded.length + 1);
    frame[0] = FRAME_INPUT;
    frame.set(encoded, 1);
    socket.send(frame);
    return true;
  } catch {
    return false;
  }
}

function flushInput(): boolean {
  if (!pendingInput) return true;
  if (!sendFrame(pendingInput)) return false;
  pendingInput = "";
  return true;
}

function scheduleReconnect(): void {
  if (stopped || reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    openSocket();
  }, RECONNECT_MS);
}

function markDown(current: WebSocket): void {
  if (socket !== current) return;
  socket = null;
  mode = "down";
  // 不要把旧连接末尾的半个 UTF-8 字符带到重连后的第一帧。
  decoder = new TextDecoder();
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
  // 初次连接尚未成功时，不能让用户输入静默卡在重连队列里；交给主线程的
  // Wails fallback，仍然保持输入可用。已连接后的断线同样保留输入顺序。
  if (pendingInput) {
    const data = pendingInput;
    pendingInput = "";
    emit({ type: "fallback", data });
  }
  emit({ type: "down" });
  scheduleReconnect();
}

function isCurrentSocket(current: WebSocket): boolean {
  return socket === current && !stopped;
}

function dispatchMessage(current: WebSocket, data: ArrayBuffer | Blob | string): void {
  if (!isCurrentSocket(current)) return;
  if (typeof data === "string") {
    // 旧版本服务端只会把心跳作为文本 p 发回来；其它文本仍兼容 JSON。
    if (data === "p") return;
    try {
      const frame = JSON.parse(data) as {
        k?: string;
        p?: { d?: string; reason?: string };
      };
      if (frame.k === "data") queueOutput(frame.p?.d || "");
      else if (frame.k === "exit") emit({ type: "exit", reason: frame.p?.reason || "" });
    } catch {
      /* ignore malformed legacy frames */
    }
    return;
  }
  if (data instanceof Blob) {
    // binaryType 已经要求 ArrayBuffer；Blob 只作为旧 WebKit 的兼容路径。
    // arrayBuffer() 是异步的，必须再次校验连接身份，避免旧连接关闭后把
    // 晚到的数据写入重连后的终端。
    void data.arrayBuffer().then((buffer) => {
      if (isCurrentSocket(current)) dispatchMessage(current, buffer);
    }).catch(() => {});
    return;
  }
  const bytes = new Uint8Array(data);
  if (bytes.length === 0) return;
  if (bytes[0] === FRAME_DATA) {
    const text = decoder.decode(bytes.subarray(1), { stream: true });
    queueOutput(text);
  } else if (bytes[0] === FRAME_EXIT) {
    emit({ type: "exit", reason: new TextDecoder().decode(bytes.subarray(1)) });
  }
}

function openSocket(): void {
  if (stopped || !base || !token || socket?.readyState === WebSocket.OPEN) return;
  mode = "connecting";
  decoder = new TextDecoder();
  let current: WebSocket;
  try {
    current = new WebSocket(
      `${base.replace(/^http/, "ws")}/ws?t=${encodeURIComponent(token)}&sid=${encodeURIComponent(sid)}`
    );
  } catch {
    mode = "down";
    emit({ type: "down" });
    scheduleReconnect();
    return;
  }
  socket = current;
  current.binaryType = "arraybuffer";
  current.onopen = () => {
    if (socket !== current || stopped) {
      current.close();
      return;
    }
    mode = "ready";
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    heartbeatTimer = setInterval(() => {
      if (current.readyState !== WebSocket.OPEN) return;
      try {
        current.send("p");
      } catch {
        current.close();
      }
    }, 3000);
    emit({ type: "ready" });
    if (!flushInput()) current.close();
  };
  current.onmessage = (event: MessageEvent<ArrayBuffer | Blob | string>) => {
    dispatchMessage(current, event.data);
  };
  current.onerror = () => {
    // onclose 统一处理状态与重连，避免一次失败排两个定时器。
  };
  current.onclose = () => markDown(current);
}

function handleInput(data: string): void {
  if (!data || stopped) return;
  if (mode === "ready" && sendFrame(data)) return;
  if (mode === "connecting") {
    pendingInput += data;
    return;
  }
  emit({ type: "fallback", data });
}

workerScope.onmessage = (event: MessageEvent<WorkerCommand>) => {
  const command = event.data;
  if (command.type === "connect") {
    sid = command.sid;
    base = command.base;
    token = command.token;
    stopped = false;
    decoder = new TextDecoder();
    mode = "connecting";
    openSocket();
  } else if (command.type === "input") {
    handleInput(command.data);
  } else if (command.type === "stop") {
    stopped = true;
    clearTimers();
    pendingInput = "";
    outputBuffer = "";
    const current = socket;
    socket = null;
    current?.close();
  }
};
