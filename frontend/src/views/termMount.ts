/**
 * 窗格显示状态。SSH 还在不等于画面可用：
 * 必须有挂在当前槽位里的 xterm 输入框，且槽位有尺寸。
 */

export type PaneFace = "connecting" | "ready" | "down" | "blind" | "missing";

export interface PaneProbe {
  hasLive: boolean;
  closed: boolean;
  sessionID: string;
  inputMounted: boolean;
  slotSized: boolean;
  /** 可见之后量过一次。没量过不要报「无法显示」，避免开局闪一下 */
  probed: boolean;
}

export interface InputProbeTarget {
  isConnected: boolean;
  clientWidth: number;
  clientHeight: number;
  querySelector: (sel: string) => { isConnected: boolean; clientWidth?: number; clientHeight?: number } | null;
}

const INPUT_SEL = "textarea.xterm-helper-textarea";

export function paneFace(p: PaneProbe | null | undefined): PaneFace {
  if (!p || !p.probed) {
    if (p?.hasLive && p.closed) return "down";
    return "connecting";
  }
  if (!p.hasLive) return "missing";
  if (p.closed) return "down";
  if (!p.sessionID) return "connecting";
  if (!p.inputMounted || !p.slotSized) return "blind";
  return "ready";
}

export function paneFaceLabel(face: PaneFace): string {
  if (face === "ready") return "已连接";
  if (face === "connecting") return "连接中";
  if (face === "down") return "已断开";
  if (face === "blind") return "无法显示";
  return "未挂载";
}

export function paneFailText(face: PaneFace): string {
  if (face === "down") return "连接已断开";
  if (face === "blind") return "画面没有挂上。连接还在，重试不会重开 SSH";
  if (face === "missing") return "这个窗格还没有终端";
  return "";
}

/** 已连接只在输入框确实在当前槽位里时成立。 */
export function terminalInputReady(slot: InputProbeTarget | null | undefined): boolean {
  if (!slot || !slot.isConnected) return false;
  if (slot.clientWidth < 2 || slot.clientHeight < 2) return false;
  const ta = slot.querySelector(INPUT_SEL);
  if (!ta || !ta.isConnected) return false;
  const screen = slot.querySelector(".xterm-screen");
  if (!screen || !screen.isConnected) return false;
  const sw = screen.clientWidth ?? 0;
  const sh = screen.clientHeight ?? 0;
  if (sw < 2 || sh < 2) return false;
  return true;
}

export function shouldSettleAttached(alreadyInSlot: boolean, visible: boolean): boolean {
  return visible && !alreadyInSlot;
}

/**
 * Vue 行内 ref 在回调身份变化时，同一轮会先给 null 再给元素。
 * 只认这一轮最后一个值，避免把 xterm 暂存进 display:none 的停车场。
 */
export function coalesceSlot<T>(events: Array<T | null>): T | null {
  let last: T | null = null;
  for (const ev of events) last = ev;
  return last;
}

/**
 * open 在 await 之前如果不登记会话，等待期间换槽会被 opening 标志吃掉，
 * 终端留在已经卸掉的旧节点上。登记之后，新槽可以接着原来的元素。
 */
export function probeUnchanged(prev: PaneProbe | undefined, next: PaneProbe): boolean {
  if (!prev) return false;
  return (
    prev.hasLive === next.hasLive &&
    prev.closed === next.closed &&
    prev.sessionID === next.sessionID &&
    prev.inputMounted === next.inputMounted &&
    prev.slotSized === next.slotSized &&
    prev.probed === next.probed
  );
}

export function parentAfterSlotSwap(
  registerBeforeWait: boolean,
  openedOn: string,
  slotDuringWait: string | null
): string {
  if (!registerBeforeWait) return openedOn;
  if (slotDuringWait) return slotDuringWait;
  return openedOn;
}
