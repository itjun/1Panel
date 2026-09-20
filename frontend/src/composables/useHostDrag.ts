/**
 * 主机/分组拖拽：迁组、置顶、分组内主机排序、分组移到顶层（指针拖拽，不依赖 HTML5 DnD）。
 * 由 App provide，侧栏与全部主机页共用同一套 drop 命中与幽灵。
 * 分组最多一层：不允许嵌套；内容页只拖主机，侧栏仍可拖分组到「全部主机」升顶层。
 */
import { inject, onBeforeUnmount, ref, type InjectionKey } from "vue";
import { ElMessage } from "element-plus";
import {
  PINNED_DROP_ID,
  ROOT_DROP_ID,
  UNGROUPED_ID,
  useAppStore,
} from "@/stores/app";

const DRAG_THRESHOLD = 6;
const isMacPlatform = /Mac|iPhone|iPad/.test(navigator.platform);

/** 多选手势：Mac 为 ⌘+左键，Windows 为 Ctrl+左键。按住时不启动拖拽。 */
export function isAdditiveHostSelect(e: {
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}): boolean {
  if (e.shiftKey || e.altKey) return false;
  if (isMacPlatform) return e.metaKey && !e.ctrlKey;
  return e.ctrlKey && !e.metaKey;
}

function isRootDrop(dropId: string): boolean {
  return dropId === ROOT_DROP_ID || dropId === UNGROUPED_ID;
}

export interface DragState {
  kind: "host" | "group";
  id: string;
  label: string;
  /** 拖到左侧主机栏时要批量后台打开的主机；排序/迁组仍只使用 id。 */
  hostIds?: string[];
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
  /**
   * 分组排序指示：拖分组悬停在某分组行上时记录插入方位。
   * "before" = 目标行上半（插到其前），"after" = 下半（插到其后）。
   */
  const groupInsertPos = ref<"before" | "after" | null>(null);
  /** 分组排序目标分组 id（配合 groupInsertPos 使用） */
  const groupInsertTargetId = ref<string | null>(null);
  /**
   * 分组内主机排序：拖到同组另一张卡上时记录插入方位。
   * after=false 插到目标之前，after=true 插到目标之后。
   */
  const hostInsert = ref<{
    groupId: string;
    target: string;
    after: boolean;
  } | null>(null);
  /** 正在把主机卡片拖到左侧主机页区域，放下后后台打开。 */
  const hostSessionDropTarget = ref(false);
  const suppressClick = ref(false);

  function onHostPointerDown(
    e: PointerEvent,
    hostName: string,
    selectedHostNames: readonly string[] = []
  ) {
    if (e.button !== 0 || opts?.isBlocked?.()) return;
    if (isAdditiveHostSelect(e)) return;
    const selected = selectedHostNames.includes(hostName)
      ? [...new Set(selectedHostNames.filter(Boolean))]
      : [];
    beginDrag(e, "host", hostName, hostName, selected.length > 1 ? selected : [hostName]);
  }

  function onGroupPointerDown(e: PointerEvent, groupId: string, name: string) {
    if (e.button !== 0 || opts?.isBlocked?.()) return;
    if (!groupId || groupId === UNGROUPED_ID || groupId === PINNED_DROP_ID) return;
    beginDrag(e, "group", groupId, name);
  }

  function beginDrag(
    e: PointerEvent,
    kind: "host" | "group",
    id: string,
    label: string,
    hostIds?: string[]
  ) {
    dragState.value = {
      kind,
      id,
      label,
      hostIds: kind === "host" ? hostIds : undefined,
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

    if (st.kind === "host" && hitTestHostSessionDrop(e.clientX, e.clientY)) {
      hostSessionDropTarget.value = true;
      hostInsert.value = null;
      dropTargetId.value = null;
      pinInsertBefore.value = null;
      groupInsertTargetId.value = null;
      groupInsertPos.value = null;
      return;
    }
    hostSessionDropTarget.value = false;

    const sort = st.kind === "host" ? hitTestHostSort(e.clientX, e.clientY) : null;
    if (sort) {
      hostInsert.value = sort;
      dropTargetId.value = null;
      pinInsertBefore.value = null;
      groupInsertTargetId.value = null;
      groupInsertPos.value = null;
      return;
    }
    hostInsert.value = null;

    const hit = hitTestDrop(e.clientX, e.clientY);
    dropTargetId.value = hit.dropId;
    pinInsertBefore.value =
      st.kind === "host" && hit.dropId === PINNED_DROP_ID
        ? hit.pinHost
        : null;
    // 分组排序：悬停目标行的上/下半决定前插/后插（置顶区/根区除外）
    if (st.kind === "group" && hit.dropId && hit.groupTargetId) {
      groupInsertTargetId.value = hit.groupTargetId;
      groupInsertPos.value = hit.groupAfter ? "after" : "before";
    } else {
      groupInsertTargetId.value = null;
      groupInsertPos.value = null;
    }
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
    const insertPos = groupInsertPos.value;
    const insertTargetId = groupInsertTargetId.value;
    const sortHost = hostInsert.value;
    const hostSessionDrop = hostSessionDropTarget.value;
    const kind = st.kind;
    const id = st.id;
    const hostIds = st.hostIds?.length ? st.hostIds : [id];

    dragState.value = null;
    dropTargetId.value = null;
    pinInsertBefore.value = null;
    groupInsertPos.value = null;
    groupInsertTargetId.value = null;
    hostInsert.value = null;
    hostSessionDropTarget.value = false;

    if (!wasActive) return;

    if (kind === "host" && hostSessionDrop) {
      for (const host of hostIds) {
        app.openHostTabInBackground(host, "overview");
      }
      setTimeout(() => {
        suppressClick.value = false;
      }, 0);
      return;
    }

    if (kind === "host" && sortHost) {
      await reorderHostNear(id, sortHost);
    } else if (target != null) {
      if (kind === "host") {
        if (target === PINNED_DROP_ID) {
          await pinOrReorderHost(id, insertBefore);
        } else {
          await moveHostToGroup(id, target);
        }
      } else if (target === PINNED_DROP_ID) {
        ElMessage.info("只能置顶主机，不能置顶分组");
      } else if (isRootDrop(target)) {
        // 拖到「全部主机」/未分组：升为顶层并排到最后
        await moveGroupToParent(id, target);
      } else {
        // 拖到某分组行：同层级排序（before/after）
        await reorderGroupNear(id, insertTargetId || target, insertPos === "after");
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
    groupInsertPos.value = null;
    groupInsertTargetId.value = null;
    hostInsert.value = null;
    hostSessionDropTarget.value = false;
  }

  function hitTestHostSessionDrop(x: number, y: number): boolean {
    if (dragState.value?.kind !== "host") return false;
    return document.elementsFromPoint(x, y).some((el) =>
      el instanceof HTMLElement && !!el.closest("[data-host-session-drop]")
    );
  }

  function hitTestDrop(
    x: number,
    y: number
  ): {
    dropId: string | null;
    pinHost: string | null;
    /** 命中的具体分组行 id（拖分组排序用，可能与 dropId 相同） */
    groupTargetId: string | null;
    /** 是否命中分组行下半部（后插） */
    groupAfter: boolean;
  } {
    const stack = document.elementsFromPoint(x, y);
    for (const el of stack) {
      if (!(el instanceof HTMLElement)) continue;
      if (
        el.classList.contains("host-drag-ghost") ||
        el.classList.contains("group-drag-ghost")
      ) {
        continue;
      }
      const st = dragState.value;
      if (st?.kind === "group") {
        const sortNode = el.closest("[data-group-sort]") as HTMLElement | null;
        if (sortNode?.dataset.groupSort) {
          const groupId = sortNode.dataset.groupSort;
          const rect = sortNode.getBoundingClientRect();
          return {
            dropId: groupId,
            pinHost: null,
            groupTargetId: groupId,
            groupAfter: y > rect.top + rect.height / 2,
          };
        }
      }
      const pinNode = el.closest("[data-pin-host]") as HTMLElement | null;
      const pinHost = pinNode?.dataset.pinHost || null;
      const node = el.closest("[data-drop-group]") as HTMLElement | null;
      if (node?.dataset.dropGroup) {
        // 分组排序只接受标题行命中，不能把整组内容高度当成插入区域。
        if (st?.kind === "group") continue;
        return {
          dropId: node.dataset.dropGroup,
          pinHost,
          groupTargetId: null,
          groupAfter: false,
        };
      }
      if (el.classList.contains("el-sub-menu__title")) {
        const inner = el.querySelector(
          "[data-drop-group]"
        ) as HTMLElement | null;
        if (inner?.dataset.dropGroup) {
          return { dropId: inner.dataset.dropGroup, pinHost, groupTargetId: null, groupAfter: false };
        }
      }
    }
    return { dropId: null, pinHost: null, groupTargetId: null, groupAfter: false };
  }

  /** 命中分组内主机卡片：同组才排序；卡片左/上半为前插，右/下半为后插。 */
  function hitTestHostSort(
    x: number,
    y: number
  ): { groupId: string; target: string; after: boolean } | null {
    const dragged = dragState.value?.id || "";
    if (!dragged) return null;
    const stack = document.elementsFromPoint(x, y);
    for (const el of stack) {
      if (!(el instanceof HTMLElement)) continue;
      if (
        el.classList.contains("host-drag-ghost") ||
        el.classList.contains("group-drag-ghost")
      ) {
        continue;
      }
      const node = el.closest("[data-host-sort]") as HTMLElement | null;
      if (!node?.dataset.hostSort) continue;
      const groupId = (node.dataset.hostGroup || "").trim();
      const target = node.dataset.hostSort.trim();
      if (!groupId || !target || groupId === UNGROUPED_ID) return null;
      const names =
        groupId === PINNED_DROP_ID
          ? app.pinnedHosts
          : app.groupList.find((item) => item.id === groupId)?.hosts || [];
      if (!names.includes(dragged) || !names.includes(target)) return null;
      const rect = node.getBoundingClientRect();
      let after = false;
      if (node.dataset.hostAxis === "y") {
        after = y > rect.top + rect.height / 2;
      } else {
        after = x > rect.left + rect.width / 2;
      }
      return { groupId, target, after };
    }
    return null;
  }

  async function reorderHostNear(
    host: string,
    insert: { groupId: string; target: string; after: boolean }
  ) {
    if (host === insert.target) return;

    if (insert.groupId === PINNED_DROP_ID) {
      const names = app.pinnedHosts.filter((name) => !!name);
      if (!names.includes(host) || !names.includes(insert.target)) return;
      const next = names.filter((name) => name !== host);
      let index = next.indexOf(insert.target);
      if (index < 0) return;
      if (insert.after) index += 1;
      next.splice(index, 0, host);
      app.reorderPinnedHost(host, next[index + 1] || null);
      return;
    }

    const group = app.groupList.find((item) => item.id === insert.groupId);
    if (!group) return;
    const names = (group.hosts || []).filter((name) => !!name);
    if (!names.includes(host) || !names.includes(insert.target)) return;
    const next = names.filter((name) => name !== host);
    let index = next.indexOf(insert.target);
    if (index < 0) return;
    if (insert.after) index += 1;
    next.splice(index, 0, host);
    let same = next.length === names.length;
    if (same) {
      for (let i = 0; i < next.length; i++) {
        if (next[i] !== names[i]) {
          same = false;
          break;
        }
      }
    }
    if (same) return;
    try {
      await app.reorderGroupHosts(insert.groupId, next);
    } catch (err) {
      ElMessage.error(`排序失败: ${err}`);
    }
  }

  async function moveGroupToParent(groupId: string, dropId: string) {
    if (groupId === dropId) {
      ElMessage.info("不能移到自身");
      return;
    }
    // 只允许升到顶层；不允许嵌套到其他分组下
    if (!isRootDrop(dropId)) {
      ElMessage.warning("不支持嵌套分组，请拖到「全部主机」升为顶层");
      return;
    }

    const dragged = app.findGroupNode(groupId);
    if (!dragged) return;

    const curParent = (dragged.group?.parentId || "").trim();
    if (!curParent) {
      ElMessage.info("已在顶层");
      return;
    }

    try {
      await app.moveGroup(groupId, "");
      ElMessage.success("已将分组移至顶层");
    } catch (err) {
      ElMessage.error(`移动失败: ${err}`);
    }
  }

  /**
   * 分组排序：把 groupId 插到 targetId 之前/之后（同一父级内）。
   * 目标层级若与被拖分组不同级，则先迁到目标父级（即拖到不同分组的行上 = 移动+排序）。
   */
  async function reorderGroupNear(
    groupId: string,
    targetId: string,
    after: boolean
  ) {
    if (groupId === targetId) {
      return;
    }
    const dragged = app.findGroupNode(groupId);
    const target = app.findGroupNode(targetId);
    if (!dragged?.group || !target?.group) return;

    const draggedParent0 = (dragged.group.parentId || "").trim();
    const targetParent = (target.group.parentId || "").trim();
    // 实际落位层级（跨级拖拽时等于目标父级）
    let draggedParent = draggedParent0;

    // 目标层级的同级 id 序列（当前显示顺序）
    let siblingIds: string[];
    if (draggedParent0 === targetParent) {
      siblingIds = (targetParent ? app.findGroupNode(targetParent)?.children : app.groupNodes)
        ?.map((n) => n.group?.id || "")
        .filter((x) => x && x !== groupId) || [];
    } else {
      // 跨级：从原层级移除，加入目标层级
      const srcSiblings =
        (draggedParent ? app.findGroupNode(draggedParent)?.children : app.groupNodes) || [];
      const dstSiblings =
        (targetParent ? app.findGroupNode(targetParent)?.children : app.groupNodes) || [];
      const src = srcSiblings
        .map((n) => n.group?.id || "")
        .filter((x) => x && x !== groupId);
      // 先把原层级重排好（不含被拖分组）
      try {
        await app.reorderGroups(draggedParent, src);
      } catch (err) {
        ElMessage.error(`排序失败: ${err}`);
        return;
      }
      siblingIds = dstSiblings.map((n) => n.group?.id || "").filter(Boolean);
      draggedParent = targetParent; // 后面按目标层级落位
    }

    // 计算插入位置：after 时插到目标之后
    const ti = siblingIds.indexOf(targetId);
    if (ti < 0) {
      siblingIds.push(groupId);
    } else {
      siblingIds.splice(after ? ti + 1 : ti, 0, groupId);
    }

    try {
      await app.reorderGroups(draggedParent, siblingIds);
      const targetName = target.group.name || "分组";
      ElMessage.success(
        `已将「${dragged.group.name}」${after ? "移到" : "排到"}「${targetName}」${after ? "之后" : "之前"}`
      );
    } catch (err) {
      ElMessage.error(`排序失败: ${err}`);
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
    groupInsertPos,
    groupInsertTargetId,
    hostInsert,
    hostSessionDropTarget,
    suppressClick,
    onHostPointerDown,
    onGroupPointerDown,
    cancelDrag,
    moveHostToGroup,
    moveGroupToParent,
    reorderGroupNear,
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
