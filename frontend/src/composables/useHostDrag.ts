/**
 * 侧栏拖拽：主机迁组 + 分组移树（指针拖拽，不依赖 HTML5 DnD）。
 */
import { onBeforeUnmount, ref } from "vue";
import { ElMessage } from "element-plus";
import {
  MAX_GROUP_DEPTH,
  ROOT_DROP_ID,
  UNGROUPED_ID,
  useAppStore,
  type GroupNode,
} from "@/stores/app";

const DRAG_THRESHOLD = 6;

function isRootDrop(dropId: string): boolean {
  return dropId === ROOT_DROP_ID || dropId === UNGROUPED_ID;
}

export interface DragState {
  kind: "host" | "group";
  id: string;
  label: string;
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
  const suppressClick = ref(false);

  function onHostPointerDown(e: PointerEvent, hostName: string) {
    if (e.button !== 0 || opts?.isBlocked?.()) return;
    beginDrag(e, "host", hostName, hostName);
  }

  function onGroupPointerDown(e: PointerEvent, groupId: string, name: string) {
    if (e.button !== 0 || opts?.isBlocked?.()) return;
    if (!groupId || groupId === UNGROUPED_ID) return;
    beginDrag(e, "group", groupId, name);
  }

  function beginDrag(
    e: PointerEvent,
    kind: "host" | "group",
    id: string,
    label: string
  ) {
    dragState.value = {
      kind,
      id,
      label,
      startX: e.clientX,
      startY: e.clientY,
      x: e.clientX,
      y: e.clientY,
      active: false,
      pointerId: e.pointerId,
    };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
  }

  function onPointerMove(e: PointerEvent) {
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

    dropTargetId.value = hitTestDropGroup(e.clientX, e.clientY);
  }

  async function onPointerUp(e: PointerEvent) {
    const st = dragState.value;
    if (!st || e.pointerId !== st.pointerId) return;

    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
    window.removeEventListener("pointercancel", onPointerUp);
    document.body.style.userSelect = "";
    document.body.style.cursor = "";

    const wasActive = st.active;
    const target = dropTargetId.value;
    const kind = st.kind;
    const id = st.id;

    dragState.value = null;
    dropTargetId.value = null;

    if (!wasActive) return;

    if (target != null) {
      if (kind === "host") {
        await moveHostToGroup(id, target);
      } else {
        await moveGroupToParent(id, target);
      }
    }

    setTimeout(() => {
      suppressClick.value = false;
    }, 0);
  }

  function cancelDrag() {
    if (!dragState.value) return;
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
    window.removeEventListener("pointercancel", onPointerUp);
    document.body.style.userSelect = "";
    document.body.style.cursor = "";
    dragState.value = null;
    dropTargetId.value = null;
  }

  function hitTestDropGroup(x: number, y: number): string | null {
    const stack = document.elementsFromPoint(x, y);
    for (const el of stack) {
      if (!(el instanceof HTMLElement)) continue;
      if (
        el.classList.contains("host-drag-ghost") ||
        el.classList.contains("group-drag-ghost")
      ) {
        continue;
      }
      const node = el.closest("[data-drop-group]") as HTMLElement | null;
      if (node?.dataset.dropGroup) return node.dataset.dropGroup;
      if (el.classList.contains("el-sub-menu__title")) {
        const inner = el.querySelector(
          "[data-drop-group]"
        ) as HTMLElement | null;
        if (inner?.dataset.dropGroup) return inner.dataset.dropGroup;
      }
    }
    return null;
  }

  function subtreeHeight(node: GroupNode): number {
    if (!node.children?.length) return 1;
    let max = 0;
    for (const c of node.children) {
      const h = subtreeHeight(c);
      if (h > max) max = h;
    }
    return max + 1;
  }

  function isDescendantOf(ancestorId: string, nodeId: string): boolean {
    const anc = app.findGroupNode(ancestorId);
    if (!anc) return false;
    const walk = (n: GroupNode): boolean => {
      for (const c of n.children || []) {
        if (c.group?.id === nodeId) return true;
        if (walk(c)) return true;
      }
      return false;
    };
    return walk(anc);
  }

  async function moveGroupToParent(groupId: string, dropId: string) {
    if (groupId === dropId) {
      ElMessage.info("不能移到自身");
      return;
    }
    if (!isRootDrop(dropId) && isDescendantOf(groupId, dropId)) {
      ElMessage.warning("不能将分组移到自己的子分组下");
      return;
    }

    const dragged = app.findGroupNode(groupId);
    if (!dragged) return;
    const height = subtreeHeight(dragged);
    const newDepth = isRootDrop(dropId) ? 1 : app.groupDepthOf(dropId) + 1;
    if (newDepth + height - 1 > MAX_GROUP_DEPTH) {
      ElMessage.warning(`移动后将超过 ${MAX_GROUP_DEPTH} 层，已取消`);
      return;
    }

    const parentId = isRootDrop(dropId) ? "" : dropId;
    const curParent = (dragged.group?.parentId || "").trim();
    if (curParent === parentId) {
      const label = isRootDrop(dropId)
        ? "顶层"
        : app.groupList.find((g) => g.id === dropId)?.name || "分组";
      ElMessage.info(`已在「${label}」下`);
      return;
    }

    try {
      await app.moveGroup(groupId, parentId);
      const label = isRootDrop(dropId)
        ? "顶层"
        : app.groupList.find((g) => g.id === dropId)?.name || "分组";
      ElMessage.success(`已将分组移至「${label}」`);
    } catch (err) {
      ElMessage.error(`移动失败: ${err}`);
    }
  }

  async function moveHostToGroup(host: string, groupId: string) {
    const target =
      groupId === UNGROUPED_ID || groupId === ROOT_DROP_ID ? "" : groupId;
    if (target) {
      const g = app.groupList.find((x) => x.id === target);
      if (g?.hosts?.includes(host)) {
        ElMessage.info(`${host} 已在「${g.name}」中`);
        return;
      }
    } else {
      const inAny = app.groupList.some((g) => (g.hosts || []).includes(host));
      if (!inAny) {
        ElMessage.info(`${host} 已在未分组`);
        return;
      }
    }

    try {
      await app.assignHost(host, target);
      const label =
        groupId === UNGROUPED_ID || groupId === ROOT_DROP_ID
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
    onGroupPointerDown,
    cancelDrag,
    moveHostToGroup,
    moveGroupToParent,
  };
}
