/**
 * 主机/分组拖拽：迁组、置顶、分组移树（指针拖拽，不依赖 HTML5 DnD）。
 * 由 App provide，侧栏与看板共用同一套 drop 命中与幽灵。
 */
import { inject, onBeforeUnmount, ref, type InjectionKey } from "vue";
import { ElMessage } from "element-plus";
import {
  MAX_GROUP_DEPTH,
  PINNED_DROP_ID,
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
  /** 置顶区内重排：插到该主机之前；命中区但未指向具体项则为 null（追加末尾） */
  const pinInsertBefore = ref<string | null>(null);
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

    const hit = hitTestDrop(e.clientX, e.clientY);
    dropTargetId.value = hit.dropId;
    pinInsertBefore.value =
      st.kind === "host" && hit.dropId === PINNED_DROP_ID
        ? hit.pinHost
        : null;
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
    const insertBefore = pinInsertBefore.value;
    const kind = st.kind;
    const id = st.id;

    dragState.value = null;
    dropTargetId.value = null;
    pinInsertBefore.value = null;

    if (!wasActive) return;

    if (target != null) {
      if (kind === "host") {
        if (target === PINNED_DROP_ID) {
          await pinOrReorderHost(id, insertBefore);
        } else {
          await moveHostToGroup(id, target);
        }
      } else if (target !== PINNED_DROP_ID) {
        await moveGroupToParent(id, target);
      } else {
        ElMessage.info("只能置顶主机，不能置顶分组");
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
    pinInsertBefore.value = null;
  }

  function hitTestDrop(
    x: number,
    y: number
  ): { dropId: string | null; pinHost: string | null } {
    const stack = document.elementsFromPoint(x, y);
    for (const el of stack) {
      if (!(el instanceof HTMLElement)) continue;
      if (
        el.classList.contains("host-drag-ghost") ||
        el.classList.contains("group-drag-ghost")
      ) {
        continue;
      }
      const pinNode = el.closest("[data-pin-host]") as HTMLElement | null;
      const pinHost = pinNode?.dataset.pinHost || null;
      const node = el.closest("[data-drop-group]") as HTMLElement | null;
      if (node?.dataset.dropGroup) {
        return { dropId: node.dataset.dropGroup, pinHost };
      }
      if (el.classList.contains("el-sub-menu__title")) {
        const inner = el.querySelector(
          "[data-drop-group]"
        ) as HTMLElement | null;
        if (inner?.dataset.dropGroup) {
          return { dropId: inner.dataset.dropGroup, pinHost: null };
        }
      }
    }
    return { dropId: null, pinHost: null };
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

  async function pinOrReorderHost(host: string, beforeName: string | null) {
    // 插到自身之前无意义
    const before =
      beforeName && beforeName !== host ? beforeName : null;
    if (app.isPinned(host)) {
      const cur = app.pinnedHosts;
      const fromIdx = cur.indexOf(host);
      if (fromIdx < 0) return;
      // 已在目标位置则提示
      if (!before) {
        if (fromIdx === cur.length - 1) {
          ElMessage.info(`${host} 已置顶`);
          return;
        }
      } else {
        const toIdx = cur.indexOf(before);
        if (toIdx === fromIdx + 1 || toIdx === fromIdx) {
          ElMessage.info(`${host} 已置顶`);
          return;
        }
      }
      app.reorderPinnedHost(host, before);
      ElMessage.success(`已调整 ${host} 置顶顺序`);
      return;
    }
    if (before) {
      app.pinHost(host);
      app.reorderPinnedHost(host, before);
    } else {
      app.pinHost(host);
    }
    ElMessage.success(`已置顶 ${host}`);
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
    pinInsertBefore,
    suppressClick,
    onHostPointerDown,
    onGroupPointerDown,
    cancelDrag,
    moveHostToGroup,
    moveGroupToParent,
  };
}

export type HostDragApi = ReturnType<typeof useHostDrag>;

export const hostDragKey: InjectionKey<HostDragApi> = Symbol("hostDrag");

/** 侧栏 / 看板注入 App 提供的拖拽 API */
export function useInjectedHostDrag(): HostDragApi {
  const api = inject(hostDragKey);
  if (!api) {
    throw new Error("useInjectedHostDrag() 须在 App provide hostDrag 之后使用");
  }
  return api;
}
