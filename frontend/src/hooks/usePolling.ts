import { useEffect, useRef, useState } from "react";

// usePolling 通用轮询 hook
//   - fetcher: 返回 Promise<T> 的函数
//   - interval: 轮询间隔毫秒；传 0 表示只拉一次
//   - deps: 依赖项变化时重置（如 host 变化）
// 行为遵循 grilling 决策：
//   - 静默失败：错误存到 error，不抛
//   - 断线 30s 才重试（避免雪崩）
export function usePolling<T>(
  fetcher: () => Promise<T>,
  interval: number,
  deps: unknown[] = []
): { data: T | null; error: string | null; loading: boolean; refresh: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const failedSince = useRef<number | null>(null);
  const mountedRef = useRef(true);

  const refresh = async () => {
    // 错误且距上次失败不足 30s 时跳过（节流）
    if (
      failedSince.current !== null &&
      Date.now() - failedSince.current < 30_000
    ) {
      return;
    }
    try {
      const v = await fetcher();
      if (!mountedRef.current) return;
      setData(v);
      setError(null);
      failedSince.current = null;
    } catch (e) {
      if (!mountedRef.current) return;
      setError(String(e));
      failedSince.current = Date.now();
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  };

  useEffect(() => {
    mountedRef.current = true;
    setData(null);
    setError(null);
    setLoading(true);
    failedSince.current = null;
    refresh();
    let timer: number | undefined;
    if (interval > 0) {
      timer = window.setInterval(refresh, interval);
    }
    return () => {
      mountedRef.current = false;
      if (timer) clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { data, error, loading, refresh };
}
