/**
 * 内容顶栏标签：按栏宽判断能否再开，指针拖过时当场换位（序号跟 v-for 下标走）。
 */
import { onBeforeUnmount, ref, type Ref } from "vue";

export const TAB_BAR_FULL_MSG = "页面满了，不支持打开这么多";

const DRAG_THRESHOLD = 6;

/** 再塞一个与末枚同宽的标签是否会超出可见栏宽 */
export function tabBarIsFull(
  clipEl: HTMLElement | null | undefined,
  itemSelector: string,
  opts?: { firstGainsClose?: boolean }
): boolean {
  if (!clipEl) return false;
  const items = [...clipEl.querySelectorAll(itemSelector)] as HTMLElement[];
  if (items.length === 0) return false;
  const avail = clipEl.clientWidth;
  const used = items.reduce((s, el) => s + el.getBoundingClientRect().width, 0);
  const lastW = items[items.length - 1].getBoundingClientRect().width;
  // 文件首个标签无关闭钮，开第 2 个时现有 + 新开都会带 ×
  const closeExtra =
    opts?.firstGainsClose && items.length === 1 ? 24 : 0;
  return used + closeExtra + lastW + closeExtra > avail + 1;
}

function tabIdFromEl(el: Element | null): string | null {
  if (!el || !(el instanceof HTMLElement)) return null;
  if (el.dataset.tabId) return el.dataset.tabId;
  const inner = el.querySelector("[data-tab-id]") as HTMLElement | null;
  return inner?.dataset.tabId ?? null;
}

export function useTabReorder<T extends { id: string }>(
  items: Ref<T[]>,
  opts: { listRef: Ref<HTMLElement | null>; itemSelector: string }
) {
  const draggingId = ref<string | null>(null);
  let fromId: string | null = null;
  let startX = 0;
  let startY = 0;
  let armed = false;
  let pointerId = -1;
  let suppressClick = false;

  function onPointerDown(e: PointerEvent) {
    if (e.button !== 0) return;
    const t = e.target as HTMLElement | null;
    if (
      t?.closest(
        ".is-icon-close, .el-icon-close, .term-tab__close, .tab-add-btn, .term-tab--add"
      )
    ) {
      return;
    }
    const item = t?.closest(opts.itemSelector) as HTMLElement | null;
    const id = tabIdFromEl(item);
    if (!id) return;
    fromId = id;
    startX = e.clientX;
    startY = e.clientY;
    armed = false;
    pointerId = e.pointerId;
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  }

  function insertIndexAt(clientX: number): number {
    const root = opts.listRef.value;
    if (!root) return -1;
    const nodes = [...root.querySelectorAll(opts.itemSelector)] as HTMLElement[];
    if (nodes.length === 0) return -1;
    for (let i = 0; i < nodes.length; i++) {
      const r = nodes[i].getBoundingClientRect();
      if (clientX < r.left + r.width / 2) return i;
    }
    return nodes.length - 1;
  }

  function onMove(e: PointerEvent) {
    if (e.pointerId !== pointerId || !fromId) return;
    if (!armed) {
      if (Math.hypot(e.clientX - startX, e.clientY - startY) < DRAG_THRESHOLD) {
        return;
      }
      armed = true;
      draggingId.value = fromId;
    }
    e.preventDefault();
    const root = opts.listRef.value;
    if (root) {
      const rr = root.getBoundingClientRect();
      if (e.clientY < rr.top - 28 || e.clientY > rr.bottom + 28) return;
    }
    const list = items.value;
    const from = list.findIndex((x) => x.id === fromId);
    if (from < 0) return;
    const to = insertIndexAt(e.clientX);
    if (to < 0 || to === from) return;
    const next = list.slice();
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    items.value = next;
  }

  function onUp(e: PointerEvent) {
    if (e.pointerId !== pointerId) return;
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onUp);
    if (armed) suppressClick = true;
    armed = false;
    draggingId.value = null;
    fromId = null;
    pointerId = -1;
  }

  function onClickCapture(e: MouseEvent) {
    if (!suppressClick) return;
    e.preventDefault();
    e.stopPropagation();
    suppressClick = false;
  }

  onBeforeUnmount(() => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onUp);
  });

  return { draggingId, onPointerDown, onClickCapture };
}
