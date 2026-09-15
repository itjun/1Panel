/**
 * Hosts 表格/原文分栏：左右按百分比（fr）分配，默认 50/50。
 * 存的是相对比例，侧栏收展、窗口缩放时左右仍按同一百分比缩放。
 * 双击分隔条回弹到各占一半。
 */
import { ref } from "vue";

const STORAGE_KEY = "ipannel.hostsSplitPercent";
const DEFAULT_PERCENT = 50;
const MIN_PERCENT = 22;
const MAX_PERCENT = 78;

/* 模块级单例：本机 / 远程 Hosts 共用同一比例 */
const tablePercent = ref(loadPercent());
const resizing = ref(false);

function clampPercent(n: number): number {
  return Math.max(MIN_PERCENT, Math.min(MAX_PERCENT, Math.round(n)));
}

function loadPercent(): number {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw !== null) {
      const n = Number(raw);
      if (Number.isFinite(n)) return clampPercent(n);
    }
  } catch {
    /* ignore */
  }
  return DEFAULT_PERCENT;
}

function savePercent(n: number) {
  try {
    localStorage.setItem(STORAGE_KEY, String(n));
  } catch {
    /* ignore */
  }
}

export function useHostsSplit() {
  const bodyRef = ref<HTMLElement | null>(null);

  function onResizeStart(e: PointerEvent) {
    e.preventDefault();
    e.stopPropagation();
    const el = bodyRef.value;
    if (!el) return;

    resizing.value = true;
    const prevCursor = document.body.style.cursor;
    const prevSelect = document.body.style.userSelect;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const onMove = (ev: PointerEvent) => {
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0) return;
      // 指针位置相对整栏宽度 → 表格侧百分比（与 fr 布局同一口径）
      const pct = ((ev.clientX - rect.left) / rect.width) * 100;
      tablePercent.value = clampPercent(pct);
    };
    const onUp = () => {
      resizing.value = false;
      document.body.style.cursor = prevCursor;
      document.body.style.userSelect = prevSelect;
      savePercent(tablePercent.value);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  }

  /* 双击分隔条：回弹到一人一半 */
  function onResizeDblClick(e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    tablePercent.value = DEFAULT_PERCENT;
    savePercent(DEFAULT_PERCENT);
  }

  return {
    tablePercent,
    resizing,
    bodyRef,
    onResizeStart,
    onResizeDblClick,
  };
}
