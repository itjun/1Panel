/**
 * 侧栏主机拖拽分组：指针拖拽（不依赖 HTML5 DnD）、分组标题命中检测、迁移分组。
 * 从 SidebarHost.vue 抽出，行为保持不变。
 */
import { onBeforeUnmount, ref } from "vue";
import { ElMessage } from "element-plus";
import { useAppStore, UNGROUPED_ID } from "@/stores/app";

/** 移动超过该像素才算拖拽，避免误触 */
const DRAG_THRESHOLD = 6;

export interface DragState {
  host: string;
  startX: number;
  startY: number;
  x: number;
  y: number;
  active: boolean;
  pointerId: number;
}

export function useHostDrag(opts?: { isBlocked?: () => boolean }) {
  const app = useAppStore();

  const dragState = ref<DragState | null>(null);
  const dropTargetId = ref<string | null>(null);
  /** 抑制 pointer 拖拽结束后的 click */
  const suppressClick = ref(false);

  function onHostPointerDown(e: PointerEvent, hostName: string) {
    // 只响应主键；侧栏调宽时不抢
    if (e.button !== 0 || opts?.isBlocked?.()) return;
    // 不 preventDefault，以便仍可滚动；拖起来后再禁选中
    dragState.value = {
      host: hostName,
      startX: e.clientX,
      startY: e.clientY,
      x: e.clientX,
      y: e.clientY,
      active: false,
      pointerId: e.pointerId,
    };
    window.addEventListener("pointermove", onHostPointerMove);
    window.addEventListener("pointerup", onHostPointerUp);
    window.addEventListener("pointercancel", onHostPointerUp);
  }

  function onHostPointerMove(e: PointerEvent) {
    const st = dragState.value;
    if (!st || e.pointerId !== st.pointerId) return;

    st.x = e.clientX;
    st.y = e.clientY;

    if (!st.active) {
      const dx = e.clientX - st.startX;
      const dy = e.clientY - st.startY;
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      st.active = true;
      suppressClick.value = true;
      document.body.style.userSelect = "none";
      document.body.style.cursor = "grabbing";
    }

    // 命中分组标题
    const gid = hitTestDropGroup(e.clientX, e.clientY);
    dropTargetId.value = gid;
  }

  async function onHostPointerUp(e: PointerEvent) {
    const st = dragState.value;
    if (!st || e.pointerId !== st.pointerId) return;

    window.removeEventListener("pointermove", onHostPointerMove);
    window.removeEventListener("pointerup", onHostPointerUp);
    window.removeEventListener("pointercancel", onHostPointerUp);
    document.body.style.userSelect = "";
    document.body.style.cursor = "";

    const host = st.host;
    const wasActive = st.active;
    const target = dropTargetId.value;

    dragState.value = null;
    dropTargetId.value = null;

    if (!wasActive) {
      // 纯点击，交给 click 处理 openHostTab
      return;
    }

    // 拖拽结束：若落在分组上则分配
    if (target != null) {
      await moveHostToGroup(host, target);
    }

    // 吞掉随后的 click
    setTimeout(() => {
      suppressClick.value = false;
    }, 0);
  }

  /** 强制取消拖拽（如右键菜单打开时），避免幽灵残留 */
  function cancelDrag() {
    if (!dragState.value) return;
    window.removeEventListener("pointermove", onHostPointerMove);
    window.removeEventListener("pointerup", onHostPointerUp);
    window.removeEventListener("pointercancel", onHostPointerUp);
    document.body.style.userSelect = "";
    document.body.style.cursor = "";
    dragState.value = null;
    dropTargetId.value = null;
  }

  /** 从坐标向上找带 data-drop-group 的节点 */
  function hitTestDropGroup(x: number, y: number): string | null {
    const stack = document.elementsFromPoint(x, y);
    for (const el of stack) {
      if (!(el instanceof HTMLElement)) continue;
      // 幽灵自身忽略
      if (el.classList.contains("host-drag-ghost")) continue;
      const node = el.closest("[data-drop-group]") as HTMLElement | null;
      if (node?.dataset.dropGroup) return node.dataset.dropGroup;
      // Element Plus 标题栏：有时 data 在子节点，父级是 .el-sub-menu__title
      if (el.classList.contains("el-sub-menu__title")) {
        const inner = el.querySelector("[data-drop-group]") as HTMLElement | null;
        if (inner?.dataset.dropGroup) return inner.dataset.dropGroup;
      }
    }
    return null;
  }

  async function moveHostToGroup(host: string, groupId: string) {
    const target = groupId === UNGROUPED_ID ? "" : groupId;
    // 若已在该组则跳过
    if (target) {
      const g = app.groupList.find((x) => x.id === target);
      if (g?.hosts?.includes(host)) {
        ElMessage.info(`${host} 已在「${g.name}」中`);
        return;
      }
    } else {
      // 未分组：若当前不在任何组则跳过
      const inAny = app.groupList.some((g) => (g.hosts || []).includes(host));
      if (!inAny) {
        ElMessage.info(`${host} 已在未分组`);
        return;
      }
    }

    try {
      await app.assignHost(host, target);
      const label =
        groupId === UNGROUPED_ID
          ? "未分组"
          : app.groupList.find((g) => g.id === groupId)?.name || "分组";
      ElMessage.success(`已将 ${host} 移至「${label}」`);
    } catch (err) {
      ElMessage.error(`移动失败: ${err}`);
    }
  }

  onBeforeUnmount(() => {
    cancelDrag();
  });

  return {
    dragState,
    dropTargetId,
    suppressClick,
    onHostPointerDown,
    cancelDrag,
    moveHostToGroup,
  };
}
