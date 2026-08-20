import { onBeforeUnmount, ref, watch, type Ref } from "vue";
import { formatErr } from "@/utils/format";

/**
 * 轻量轮询：intervalMs=0 时只在 mount/deps 变化时拉一次。
 */
export function usePolling<T>(
  fetcher: () => Promise<T>,
  intervalMs: number,
  deps: () => unknown
): {
  data: Ref<T | null>;
  error: Ref<string | null>;
  loading: Ref<boolean>;
  refresh: () => Promise<void>;
} {
  const data = ref<T | null>(null) as Ref<T | null>;
  const error = ref<string | null>(null);
  const loading = ref(false);
  let timer: ReturnType<typeof setInterval> | null = null;
  let gen = 0;

  const refresh = async () => {
    const my = ++gen;
    loading.value = true;
    try {
      const result = await fetcher();
      if (my !== gen) return;
      data.value = result;
      error.value = null;
    } catch (e) {
      if (my !== gen) return;
      error.value = formatErr(e);
    } finally {
      if (my === gen) loading.value = false;
    }
  };

  const stop = () => {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  };

  const start = () => {
    stop();
    void refresh();
    if (intervalMs > 0) {
      timer = setInterval(() => void refresh(), intervalMs);
    }
  };

  watch(
    deps,
    () => {
      // 查询条件变化时清空上一轮数据：新请求失败时宁可显示空/错误，
      // 也不能把上一个条件的数据当成当前条件的结果（如进程页切运行时标签）
      data.value = null;
      error.value = null;
      start();
    },
    { immediate: true }
  );
  onBeforeUnmount(stop);

  return { data, error, loading, refresh };
}
