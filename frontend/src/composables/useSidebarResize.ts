/**
 * 侧栏宽度管理：localStorage 持久化、按主机名自适应加宽、拖拽调宽、双击自适应。
 * 从 SidebarHost.vue 抽出，行为保持不变。
 */
import { onMounted, ref, watch } from "vue";
import { useAppStore } from "@/stores/app";

const SIDEBAR_MIN_WIDTH = 180;
const SIDEBAR_MAX_WIDTH = 320;
const HOST_ROW_CHROME = 80;
const STORAGE_KEY = "ipannel.sidebarWidth";

export function useSidebarResize() {
  const app = useAppStore();

  const resizing = ref(false);
  const width = ref(loadStoredWidth());

  function clampWidth(w: number): number {
    return Math.max(
      SIDEBAR_MIN_WIDTH,
      Math.min(SIDEBAR_MAX_WIDTH, Math.round(w))
    );
  }

  function loadStoredWidth(): number {
    try {
      const n = Number(localStorage.getItem(STORAGE_KEY));
      if (Number.isFinite(n) && n > 0) return clampWidth(n);
    } catch {
      /* ignore */
    }
    return SIDEBAR_MIN_WIDTH;
  }

  function saveWidth(w: number) {
    try {
      localStorage.setItem(STORAGE_KEY, String(w));
    } catch {
      /* ignore */
    }
  }

  function measureNeededWidth(): number {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) return SIDEBAR_MIN_WIDTH;
    ctx.font =
      "400 14px Helvetica Neue, PingFang SC, Microsoft YaHei, sans-serif";
    let maxText = 0;
    for (const h of app.hosts) {
      if (!h.name) continue;
      maxText = Math.max(maxText, ctx.measureText(h.name).width);
    }
    for (const node of app.groupNodes) {
      const name = node.group?.name || "未分组";
      maxText = Math.max(maxText, ctx.measureText(name).width);
    }
    return clampWidth(Math.ceil(maxText + HOST_ROW_CHROME));
  }

  function autoFitWidth() {
    if (app.hosts.length === 0 && app.groupNodes.length === 0) return;
    const needed = measureNeededWidth();
    if (needed > width.value) {
      width.value = needed;
      saveWidth(needed);
    }
  }

  function onResizeDblClick(e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    const needed = measureNeededWidth();
    if (needed === width.value) return;
    width.value = needed;
    saveWidth(needed);
  }

  function onResizeStart(e: PointerEvent) {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startW = width.value;
    resizing.value = true;
    const prevCursor = document.body.style.cursor;
    const prevSelect = document.body.style.userSelect;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    const onMove = (ev: PointerEvent) => {
      width.value = clampWidth(startW + (ev.clientX - startX));
    };
    const onUp = () => {
      resizing.value = false;
      document.body.style.cursor = prevCursor;
      document.body.style.userSelect = prevSelect;
      saveWidth(width.value);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  }

  onMounted(() => {
    autoFitWidth();
  });

  watch(
    () => [app.hosts, app.groupNodes] as const,
    () => {
      autoFitWidth();
    },
    { deep: true }
  );

  return { width, resizing, onResizeStart, onResizeDblClick };
}
