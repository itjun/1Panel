import { onBeforeUnmount, ref, watch, type Ref } from "vue";
import { formatErr } from "@/utils/format";

/** 页面不可见（被切走/设置页打开）时，两次轮询之间的最小间隔 */
const IDLE_MIN_INTERVAL_MS = 30_000;

/**
 * 轻量轮询：intervalMs=0 时只在 mount/deps 变化时拉一次。
 * active（可选）：子页常驻后，切回该子页时立即补刷一次（保留旧数据覆盖，
 * 无清空闪烁）。interval 轮询不受影响——后台也继续，保持数据常热；
 * 但 active 返回 false（页面不可见）时降频：两次拉取至少间隔 30s，
 * 避免十几个常驻子页各自全速轮询把渲染进程内存顶高。
 */
export function usePolling<T>(
  fetcher: () => Promise<T>,
  intervalMs: number,
  deps: () => unknown,
  active?: () => boolean
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
  let lastFetchAt = 0;

  const refresh = async () => {
    const my = ++gen;
    lastFetchAt = Date.now();
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
      timer = setInterval(() => {
        // 空闲降频：页面不可见时跳过太近的拉取（间隔拉长到 30s），
        // 可见时按原节奏走
        if (active && !active() && Date.now() - lastFetchAt < IDLE_MIN_INTERVAL_MS) {
          return;
        }
        void refresh();
      }, intervalMs);
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
  if (active) {
    watch(active, (now, prev) => {
      // 从非激活变激活：立即补刷，切回子页数据即时最新
      if (now && !prev) void refresh();
    });
  }
  onBeforeUnmount(stop);

  return { data, error, loading, refresh };
}
