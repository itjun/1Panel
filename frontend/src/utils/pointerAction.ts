/**
 * 终端 xterm 抢着焦点时，若在 pointerdown 里先 blur，WebKit 会取消这次 click。
 * 动作放在 pointerdown；click 只给键盘激活留着，鼠标那次要跳过。
 *
 * 跳过标记不能按帧（requestAnimationFrame）或定时复位：
 * 正常一次点击按住往往超过一帧，复位会赶在 click 之前完成，动作就被执行两次
 * （设置按钮一开一关、点一下就消失就是这个原因）。
 * 改为每次 click 派发前在 document 捕获阶段重算：这次 click 前若刚有
 * pointerdown 处理过动作（mouseHandled），本次派发全程跳过；
 * 键盘触发的 click（detail 为 0）不受影响，正常执行。
 */

/** 本次鼠标交互已在 pointerdown 执行过动作，接下来的鼠标 click 要跳过 */
let mouseHandled = false;
/** 当前这次 click 派发是否跳过；每次 click 派发开始时重算 */
let skipThisClick = false;

if (typeof document !== "undefined") {
  document.addEventListener(
    "click",
    (e) => {
      if (e.detail === 0) {
        // 键盘激活（Enter / Space）：清掉残留标记，留给 clickAction 正常执行
        skipThisClick = false;
        return;
      }
      skipThisClick = mouseHandled;
      mouseHandled = false;
    },
    true
  );
}

export function pointerAction(e: PointerEvent, fn: () => void) {
  if (e.button !== 0) return;
  mouseHandled = true;
  fn();
}

export function clickAction(fn: () => void) {
  if (skipThisClick) return;
  fn();
}
