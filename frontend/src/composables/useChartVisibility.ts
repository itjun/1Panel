import { onBeforeUnmount, onMounted, type Ref } from "vue";

/** 图表隐藏持续多久后释放 echarts 实例（恢复显示时自动重建重画） */
const IDLE_DISPOSE_MS = 60_000;

/**
 * 图表"数据热、渲染冷"生命周期：隐藏时数据更新只记账不重绘，
 * 恢复显示后由 ResizeObserver 自动补一次渲染（画最新数据）。
 *
 * - 隐藏判定 clientWidth === 0，同时覆盖 v-show 藏起与窗口最小化；
 * - 容器尺寸变化（侧栏拖宽/卡片放大/窗口缩放）自动 resize，
 *   替代 window resize 监听与手动 dispatch 的 hack。
 * - dispose（可选）：隐藏持续超过 IDLE_DISPOSE_MS 后释放 echarts 实例，
 *   长期不可见的图表不再占 canvas 缓冲内存；恢复显示自动重建重画。
 *   要求 render 回调内部"无实例则重建"（echarts.init 幂等模式）。
 */
export function useChartVisibility(
  el: Ref<HTMLElement | null>,
  render: () => void,
  resize: () => void,
  dispose?: () => void
) {
  let pending = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let disposeTimer: ReturnType<typeof setTimeout> | null = null;
  let ro: ResizeObserver | null = null;

  function visible(): boolean {
    return !!el.value && el.value.clientWidth > 0;
  }

  /** 进入隐藏：排一个延迟释放；已在计时则不重排（保持最早触发点） */
  function scheduleDispose() {
    if (!dispose || disposeTimer) return;
    disposeTimer = setTimeout(() => {
      disposeTimer = null;
      if (visible()) return;
      dispose();
      // 释放后必须补渲染：恢复显示时重 init 画最新数据，
      // 否则 RO 走 resize 分支（实例为 null）图会空白
      pending = true;
    }, IDLE_DISPOSE_MS);
  }

  /** 恢复可见 / 卸载：取消待触发的释放 */
  function cancelDispose() {
    if (disposeTimer) {
      clearTimeout(disposeTimer);
      disposeTimer = null;
    }
  }

  /** 数据更新入口：隐藏时只记账，恢复显示时由 RO 触发补渲染 */
  function renderWhenVisible() {
    if (!visible()) {
      pending = true;
      scheduleDispose();
      return;
    }
    cancelDispose();
    render();
  }

  function onSizeChange() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      if (!el.value || el.value.clientWidth === 0) {
        scheduleDispose();
        return;
      }
      cancelDispose();
      if (pending) {
        pending = false;
        // 隐藏期间容器尺寸可能已变，而 setOption 不重读尺寸——补渲染后必须 resize，
        // 否则 canvas 停留在旧尺寸（留白/截断），之后的可见更新只 setOption 无法自愈
        render();
        resize();
        return;
      }
      resize();
    }, 100);
  }

  onMounted(() => {
    ro = new ResizeObserver(onSizeChange);
    if (el.value) ro.observe(el.value);
  });

  onBeforeUnmount(() => {
    if (timer) clearTimeout(timer);
    cancelDispose();
    ro?.disconnect();
  });

  return { renderWhenVisible };
}
