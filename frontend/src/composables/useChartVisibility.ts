import { onBeforeUnmount, onMounted, type Ref } from "vue";

/**
 * 图表"数据热、渲染冷"生命周期：隐藏时数据更新只记账不重绘，
 * 恢复显示后由 ResizeObserver 自动补一次渲染（画最新数据）。
 *
 * - 隐藏判定 clientWidth === 0，同时覆盖 v-show 藏起与窗口最小化；
 * - 容器尺寸变化（侧栏拖宽/卡片放大/窗口缩放）自动 resize，
 *   替代 window resize 监听与手动 dispatch 的 hack。
 */
export function useChartVisibility(
  el: Ref<HTMLElement | null>,
  render: () => void,
  resize: () => void
) {
  let pending = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let ro: ResizeObserver | null = null;

  function visible(): boolean {
    return !!el.value && el.value.clientWidth > 0;
  }

  /** 数据更新入口：隐藏时只记账，恢复显示时由 RO 触发补渲染 */
  function renderWhenVisible() {
    if (!visible()) {
      pending = true;
      return;
    }
    render();
  }

  function onSizeChange() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      if (!el.value || el.value.clientWidth === 0) return;
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
    ro?.disconnect();
  });

  return { renderWhenVisible };
}
