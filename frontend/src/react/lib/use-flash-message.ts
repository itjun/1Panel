import { useEffect, useState } from "react";
import { MOTION_MS, TOAST_DISMISS_MS } from "@/react/lib/motion";

/**
 * 页面顶部提示条状态（配合 page.tsx 的 FlashNotices 渲染）：
 * - 成功提示 toast：TOAST_DISMISS_MS 后淡出消失；悬停暂停，移开重新计时；再次触发重新计时
 * - 错误提示 error：常驻，直到手动关闭或被新提示替换
 * - 待处理提示 warn：需要用户处理的事项（如预览有冲突），同样常驻
 * 三者互斥，后到的覆盖先到的。
 */
export function useFlashMessage() {
  const [toast, setToast] = useState("");
  const [error, setError] = useState("");
  const [warn, setWarn] = useState("");
  // 同一文案连续触发时 toast 不变，靠序号让计时 effect 重跑
  const [toastSeq, setToastSeq] = useState(0);
  const [toastPaused, setToastPaused] = useState(false);
  const [toastLeaving, setToastLeaving] = useState(false);

  useEffect(() => {
    if (!toast || toastPaused) return;
    const timer = window.setTimeout(() => setToastLeaving(true), TOAST_DISMISS_MS);
    return () => window.clearTimeout(timer);
  }, [toast, toastSeq, toastPaused]);

  useEffect(() => {
    if (!toastLeaving) return;
    const timer = window.setTimeout(() => {
      setToast("");
      setToastLeaving(false);
      setToastPaused(false);
    }, MOTION_MS.base);
    return () => window.clearTimeout(timer);
  }, [toastLeaving]);

  function clearToast() {
    setToast("");
    setToastLeaving(false);
    // 点关闭时提示条直接卸载，收不到 mouseleave，这里要手动复位
    setToastPaused(false);
  }

  function clearError() {
    setError("");
  }

  function clearWarn() {
    setWarn("");
  }

  function clear() {
    clearToast();
    clearError();
    clearWarn();
  }

  function showToast(text: string) {
    setToast(text);
    setToastSeq((seq) => seq + 1);
    setToastLeaving(false);
    setError("");
    setWarn("");
  }

  function showError(text: string) {
    setError(text);
    setWarn("");
    clearToast();
  }

  function showWarn(text: string) {
    setWarn(text);
    setError("");
    clearToast();
  }

  function pauseToast() {
    setToastPaused(true);
    setToastLeaving(false);
  }

  function resumeToast() {
    setToastPaused(false);
  }

  return {
    toast,
    error,
    warn,
    toastLeaving,
    showToast,
    showError,
    showWarn,
    clearToast,
    clearError,
    clearWarn,
    clear,
    pauseToast,
    resumeToast,
  };
}

export type FlashMessage = ReturnType<typeof useFlashMessage>;
