/**
 * 终端 xterm 抢着焦点时，若在 pointerdown 里先 blur，WebKit 会取消这次 click。
 * 动作放在 pointerdown；click 只给键盘激活留着，鼠标那次要跳过。
 */

let skipClick = false;
let reset = 0;

function afterPaint(fn: () => void): number {
  if (typeof requestAnimationFrame === "function") {
    return requestAnimationFrame(fn);
  }
  return setTimeout(fn, 0) as unknown as number;
}

function cancelPaint(id: number) {
  if (typeof cancelAnimationFrame === "function") {
    cancelAnimationFrame(id);
  }
  clearTimeout(id);
}

export function pointerAction(e: PointerEvent, fn: () => void) {
  if (e.button !== 0) return;
  skipClick = true;
  fn();
  if (reset) cancelPaint(reset);
  reset = afterPaint(() => {
    skipClick = false;
    reset = 0;
  });
}

export function clickAction(fn: () => void) {
  if (skipClick) return;
  fn();
}
