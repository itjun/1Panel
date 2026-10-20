import { useEffect, useState } from "react";

const DEFAULT_CHUNK = 48;

/**
 * 大列表分帧挂载：每帧最多追加 chunkSize 行，避免一次 commit 数百 DOM 卡死主线程。
 * resetKey 变化时同步收回可见行数；rAF + setTimeout 双通道推进（后台窗口 rAF 可能停滞）。
 */
export function useProgressiveList<T>(
  items: T[],
  resetKey: string,
  chunkSize: number = DEFAULT_CHUNK,
): T[] {
  const [state, setState] = useState(() => ({
    key: resetKey,
    count: Math.min(chunkSize, items.length),
  }));
  let visibleCount = state.count;
  if (resetKey !== state.key) {
    visibleCount = Math.min(chunkSize, items.length);
    setState({ key: resetKey, count: visibleCount });
  }

  useEffect(() => {
    if (visibleCount >= items.length) return;
    let cancelled = false;
    function grow() {
      if (cancelled) return;
      setState((prev) => {
        if (prev.key !== resetKey) return prev;
        const next = Math.min(prev.count + chunkSize, items.length);
        if (next === prev.count) return prev;
        return { key: resetKey, count: next };
      });
    }
    const raf = requestAnimationFrame(grow);
    const timer = window.setTimeout(grow, 16);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      window.clearTimeout(timer);
    };
  }, [visibleCount, items.length, chunkSize, resetKey]);

  if (visibleCount >= items.length) return items;
  return items.slice(0, visibleCount);
}
