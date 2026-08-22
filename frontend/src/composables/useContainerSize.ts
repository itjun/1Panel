import { onBeforeUnmount, onMounted, ref, watch, type Ref } from "vue";

/**
 * 容器尺寸（ResizeObserver 提供）：
 * el-table-v2 必须显式传 width/height，用它在容器变化时同步表格尺寸。
 */
export function useContainerSize(el: Ref<HTMLElement | null>) {
  const width = ref(0);
  const height = ref(0);
  let ro: ResizeObserver | null = null;

  // 元素可能延迟挂载（位于 v-if 异步数据之后），统一在这里创建/重建
  // ResizeObserver：有元素就观察、无元素就断开；ref 变化时重新观察新元素。
  const observe = () => {
    if (ro) {
      ro.disconnect();
      ro = null;
    }
    if (!el.value) return;
    ro = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect;
      if (!r) return;
      width.value = r.width;
      height.value = r.height;
    });
    ro.observe(el.value);
  };

  onMounted(observe);

  // 模板 ref 可能因 v-if/v-else 切换指向新元素（如空列表态销毁后重建），
  // 只在 onMounted 观察一次会漏掉新元素——ref 变化时重新观察。
  watch(el, observe);

  onBeforeUnmount(() => {
    if (ro) ro.disconnect();
    ro = null;
  });

  return { width, height };
}
