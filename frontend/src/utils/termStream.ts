/**
 * 终端本地流通道：输出走 SSE（EventSource）、输入走 fetch POST。
 * 绕开 wails v3 在 macOS 上的两条主线程通道（Events.Emit 逐条 evaluateJS、
 * binding 的 script-message 回调），降低打字回显延迟。
 *
 * 失败兜底：拿不到端点或连接断开时，输入立即回退 wails binding；
 * 输出由 Go 侧检测「无订阅者」自动回退 Events 通道，前端两个监听并存、数据不丢。
 */
import { api } from "@/api";

/** 各窗格的数据/退出处理（模块级：终端实例跨视图卸载存活，注册不能随组件丢） */
const paneHandlers = new Map<
  string,
  { data: (d: string) => void; exit: (sid: string, reason: string) => void }
>();
let base = "";
let token = "";
let es: EventSource | null = null;
/** 连接未建立/已断开：输入走 wails binding。EventSource 重连成功后自动恢复 */
let isDown = true;
let inputFail = 0;

export function registerPane(
  pane: string,
  h: { data: (d: string) => void; exit: (sid: string, reason: string) => void },
): void {
  paneHandlers.set(pane, h);
}

export function unregisterPane(pane: string): void {
  paneHandlers.delete(pane);
}

export async function ensureTermStream(): Promise<void> {
  if (es) return;
  let info: { base: string; token: string };
  try {
    info = JSON.parse(await api.termStreamEndpoint()) as { base: string; token: string };
    if (!info.base || !info.token) return;
  } catch {
    return; // 拿不到端点：全程走 wails 通道
  }
  base = info.base;
  token = info.token;
  connect();
}

function connect() {
  const source = new EventSource(`${base}/stream?t=${encodeURIComponent(token)}`);
  es = source;
  source.addEventListener("data", (ev) => {
    try {
      const p = JSON.parse((ev as MessageEvent).data) as { pane?: string; d?: string };
      if (p?.pane) paneHandlers.get(p.pane)?.data(p.d || "");
    } catch {
      /* 忽略坏帧 */
    }
  });
  source.addEventListener("exit", (ev) => {
    try {
      const p = JSON.parse((ev as MessageEvent).data) as { pane?: string; sid?: string; reason?: string };
      if (p?.pane) paneHandlers.get(p.pane)?.exit(p.sid || "", p.reason || "");
    } catch {
      /* 忽略坏帧 */
    }
  });
  source.onopen = () => {
    isDown = false;
    inputFail = 0;
  };
  source.onerror = () => {
    isDown = true; // EventSource 按 retry 指示自动重连
    // 断连瞬间旧订阅可能仍被 Go 视为活跃（半开 TCP 检测慢），主动通知清掉，
    // 让数据先走 wails Events 通道；重连成功后自动回到 SSE。幂等，失败忽略
    void fetch(`${base}/drop?t=${encodeURIComponent(token)}`, { method: "POST" }).catch(() => {});
  };
}

/** 终端输入：优先流通道；未就绪/失败返回 false，调用方回退 wails binding */
async function termWrite(sid: string, d: string): Promise<boolean> {
  if (!es || isDown) return false;
  try {
    const res = await fetch(`${base}/input?t=${encodeURIComponent(token)}`, {
      method: "POST",
      // 默认 Content-Type: text/plain → simple request，无 CORS 预检
      body: JSON.stringify({ sid, d }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    inputFail = 0;
    return true;
  } catch {
    // 连续失败视作通道不可用（EventSource 重连成功后自动恢复）
    if (++inputFail >= 2) isDown = true;
    return false;
  }
}

// 输入必须严格保序：每个按键一个独立 POST，并发到达 Go 端会交错写入 stdin，
// "git pull" 会变 "gt piull"。串行链让上一个请求完成后再发下一个；
// 本地回环单次 ~1-2ms，链式排队对打字无感。
let inputChain: Promise<boolean> = Promise.resolve(true);

export function termWriteQueued(sid: string, d: string): Promise<boolean> {
  const run = (): Promise<boolean> => termWrite(sid, d);
  const p = inputChain.then(run, run);
  inputChain = p.catch(() => false);
  return p;
}
