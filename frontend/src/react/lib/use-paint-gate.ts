import { useEffect, useState } from "react";

/**
 * 导航后先让浏览器画出壳（侧栏 / 标签可点），再挂载重内容。
 * resetKey 变化时同步返回 false；双 rAF 开闸，并用 setTimeout 兜底
 * （窗口被遮挡 / 后台时 rAF 可能不跑，否则会一直白屏）。
 */
export function usePaintGate(resetKey: string): boolean {
  const [state, setState] = useState({ key: resetKey, ready: false });
  let isReady = state.ready;
  if (resetKey !== state.key) {
    isReady = false;
    setState({ key: resetKey, ready: false });
  }

  useEffect(() => {
    if (isReady) return;
    let cancelled = false;
    function open() {
      if (cancelled) return;
      cancelled = true;
      setState((prev) => {
        if (prev.key !== resetKey || prev.ready) return prev;
        return { key: resetKey, ready: true };
      });
    }
    let innerId = 0;
    const outerId = requestAnimationFrame(() => {
      innerId = requestAnimationFrame(open);
    });
    const timer = window.setTimeout(open, 32);
    return () => {
      cancelled = true;
      cancelAnimationFrame(outerId);
      cancelAnimationFrame(innerId);
      window.clearTimeout(timer);
    };
  }, [resetKey, isReady]);

  return isReady;
}
