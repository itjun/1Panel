/**
 * 主机首页（分组列表 + 拖拽 + 右键 + 快捷键）。
 *
 * INTEGRATION:
 * - 需要 entry 改为使用本文件的 HostHomePage
 * - 新建表单改用 host-form.tsx 的 HostCreateForm（若已有就 import；没有就先用回调 props，不要空等）
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { api, type sshconfig } from "@/api";
import { DistroBadge } from "@/react/components/distro-badge";
import { Button } from "@/react/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@/react/components/ui/dialog";
import { FlashNotices } from "@/react/components/page";
import { ShellToolbarPortal } from "@/react/components/shell-toolbar";
import { isPrimaryModifier, shortcutLabel } from "@/react/lib/platform";
import { useFlashMessage } from "@/react/lib/use-flash-message";
import { readSettings, updateSettings, useSettings } from "@/react/state/settings";
import { UNGROUPED_ID, useSession } from "@/react/state/session";
import { copyText } from "@/utils/clipboard";
import { formatErr } from "@/utils/format";

const PINNED_SECTION = "pinned";
const COLLAPSE_KEY = "1pannel-host-group-collapsed";
const GROUP_NAME_RE = /^[0-9]{2}-[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/;

export type HostHomePageProps = {
  /** 打开新建主机表单；groupId 空字符串表示未分组 / 不预选。 */
  onCreateHost?: (groupId?: string) => void;
  /** 打开新建分组（若未提供则用本页内置对话框）。 */
  onCreateGroup?: () => void;
};

type HostMenuState = {
  host: string;
  hosts: string[];
  x: number;
  y: number;
};

type GroupMenuState = {
  id: string;
  name: string;
  x: number;
  y: number;
};

type BlankMenuState = { x: number; y: number };

type InsertMark = {
  sectionId: string;
  target: string;
  after: boolean;
};

/**
 * 分组拖拽落点：
 * - block：插到某分组块之前 / 之后
 * - newRow：新建一排放入被拖分组；beforeRow 为新排插在第几排之前，等于排数表示追加到最后
 */
type GroupDropMark =
  | { kind: "block"; target: string; after: boolean }
  | { kind: "newRow"; beforeRow: number };

/** 分组拖拽：位移超过该值才算拖动，否则按点击处理 */
const GROUP_DRAG_THRESHOLD = 4;
/** 拖拽（分组 / 主机）贴近主内容区上下边缘多少像素时自动纵向滚动 */
const DRAG_SCROLL_EDGE = 48;
/** 自动纵向滚动每帧像素 */
const DRAG_SCROLL_STEP = 12;

/**
 * 布局对账：丢弃已不存在的分组 id 与重复 id；不在布局里的分组按 order 追加到最后一排末尾；
 * 去掉空排。没有保存过布局时，全部分组按 order 放在一排。
 */
function reconcileHostRows(saved: string[][], orderedIds: string[]): string[][] {
  const known = new Set(orderedIds);
  const placed = new Set<string>();
  const rows: string[][] = [];
  for (const savedRow of saved) {
    const row: string[] = [];
    for (const id of savedRow) {
      if (!known.has(id)) continue;
      if (placed.has(id)) continue;
      placed.add(id);
      row.push(id);
    }
    if (row.length > 0) rows.push(row);
  }
  const rest = orderedIds.filter((id) => !placed.has(id));
  if (rest.length > 0) {
    if (rows.length === 0) {
      rows.push(rest);
    } else {
      rows[rows.length - 1]!.push(...rest);
    }
  }
  return rows;
}

/** 按落点移动分组，返回新布局（拖空的排自动去掉） */
function moveGroupInRows(rows: string[][], dragged: string, mark: GroupDropMark): string[][] {
  const next = rows.map((row) => row.filter((id) => id !== dragged));
  if (mark.kind === "block") {
    if (mark.target === dragged) return rows;
    for (const row of next) {
      const index = row.indexOf(mark.target);
      if (index < 0) continue;
      if (mark.after) {
        row.splice(index + 1, 0, dragged);
      } else {
        row.splice(index, 0, dragged);
      }
      break;
    }
  } else {
    next.splice(mark.beforeRow, 0, [dragged]);
  }
  return next.filter((row) => row.length > 0);
}

type Section = {
  id: string;
  name: string;
  isPinned: boolean;
  hosts: sshconfig.HostConfig[];
};

function isAdditiveSelect(event: {
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
}) {
  if (event.shiftKey) return false;
  return isPrimaryModifier(event);
}

function readCollapsedIds(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(COLLAPSE_KEY) || "[]");
    if (!Array.isArray(raw)) return [];
    return raw.filter((x): x is string => typeof x === "string");
  } catch {
    return [];
  }
}

function writeCollapsedIds(list: string[]) {
  try {
    localStorage.setItem(COLLAPSE_KEY, JSON.stringify(list));
  } catch {
    /* ignore */
  }
}

function clampMenuPos(x: number, y: number, w: number, h: number) {
  const maxX = window.innerWidth - w - 8;
  const maxY = window.innerHeight - h - 8;
  return {
    x: Math.max(8, Math.min(x, maxX)),
    y: Math.max(8, Math.min(y, maxY)),
  };
}

function MenuItem({
  label,
  onClick,
  danger = false,
  kbd,
}: {
  label: string;
  onClick: () => void;
  danger?: boolean;
  kbd?: string;
}) {
  return (
    <button
      type="button"
      className={`flex w-full items-center justify-between gap-4 px-3 py-2 text-left hover:bg-raised ${
        danger ? "text-danger" : "text-ink"
      }`}
      onClick={onClick}
    >
      <span>{label}</span>
      {kbd ? <span className="text-xs text-muted">{kbd}</span> : null}
    </button>
  );
}

function MenuDivider() {
  return <div className="my-1 border-t border-line" />;
}

export function HostHomePage({ onCreateHost, onCreateGroup }: HostHomePageProps = {}) {
  const session = useSession();
  const settings = useSettings();
  const searchRef = useRef<HTMLInputElement>(null);
  const suppressClick = useRef(false);
  const insertMarkRef = useRef<InsertMark | null>(null);
  const dropTargetRef = useRef<string | null>(null);
  const rackRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const groupInsertRef = useRef<GroupDropMark | null>(null);

  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [selectionSection, setSelectionSection] = useState<string | null>(null);
  const [preferredGroupId, setPreferredGroupId] = useState<string>("");
  const [collapsedIds, setCollapsedIds] = useState<string[]>(() => readCollapsedIds());
  const [insertMark, setInsertMark] = useState<InsertMark | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [draggingGroupId, setDraggingGroupId] = useState<string | null>(null);
  const [groupInsert, setGroupInsert] = useState<GroupDropMark | null>(null);

  const [hostMenu, setHostMenu] = useState<HostMenuState | null>(null);
  const [groupMenu, setGroupMenu] = useState<GroupMenuState | null>(null);
  const [blankMenu, setBlankMenu] = useState<BlankMenuState | null>(null);
  const [moveSubOpen, setMoveSubOpen] = useState(false);

  const [deletingHosts, setDeletingHosts] = useState<string[] | null>(null);
  const [groupSettings, setGroupSettings] = useState<{
    id: string;
    name: string;
    boardTitle: string;
  } | null>(null);
  const [groupSettingsBusy, setGroupSettingsBusy] = useState(false);
  const [deleteGroupConfirm, setDeleteGroupConfirm] = useState<{
    id: string;
    name: string;
    detail: string;
  } | null>(null);
  const [installConfirm, setInstallConfirm] = useState<string | null>(null);
  const [agentBusy, setAgentBusy] = useState(false);
  const [checkOpen, setCheckOpen] = useState(false);
  const [checkHost, setCheckHost] = useState("");
  const [checkText, setCheckText] = useState("");
  const [checkBusy, setCheckBusy] = useState(false);
  const flash = useFlashMessage();
  const { showToast, showError } = flash;

  const keyword = query.trim().toLowerCase();

  const sections = useMemo(() => {
    const pinnedNames = session.pinned;
    const pinnedHosts = pinnedNames
      .map((name) => session.hosts.find((host) => host.name === name))
      .filter((host): host is sshconfig.HostConfig => !!host);
    const groups = [...session.groups].sort((a, b) => a.order - b.order);
    const list: Section[] = [
      { id: PINNED_SECTION, name: "置顶", isPinned: true, hosts: pinnedHosts },
      ...groups.map((group) => ({
        id: group.id,
        name: group.name,
        isPinned: false,
        hosts: session.hostsOf(group.id),
      })),
      {
        id: UNGROUPED_ID,
        name: "未分组",
        isPinned: false,
        hosts: session.hostsOf(UNGROUPED_ID),
      },
    ];
    if (!keyword) {
      return list.filter((section) => {
        if (section.hosts.length > 0) return true;
        if (section.id === PINNED_SECTION) return false;
        // 空的「未分组」只在拖拽中作为移出分组的落点出现
        if (section.id === UNGROUPED_ID) return dragging;
        return true;
      });
    }
    return list
      .map((section) => ({
        ...section,
        hosts: section.hosts.filter((host) =>
          `${host.name} ${host.hostName} ${host.user}`.toLowerCase().includes(keyword),
        ),
      }))
      .filter((section) => {
        if (section.hosts.length > 0) return true;
        return section.id === UNGROUPED_ID && dragging;
      });
  }, [keyword, session, dragging]);

  const migrateGroups = useMemo(
    () => [...session.groups].sort((a, b) => a.order - b.order),
    [session.groups],
  );

  // 用户自定义的分组排布（每排一组 group id），与当前分组对账后使用
  const groupRows = useMemo(
    () =>
      reconcileHostRows(
        settings.hostHomeRows,
        migrateGroups.map((group) => group.id),
      ),
    [settings.hostHomeRows, migrateGroups],
  );

  // 概况条：直接从已有 hosts / groups 算；筛选时只报匹配数（置顶区是重复项，不计）
  let summaryText = `${session.hosts.length} 台主机 · ${session.groups.length} 个分组`;
  if (keyword) {
    let matched = 0;
    for (const section of sections) {
      if (section.id !== PINNED_SECTION) matched += section.hosts.length;
    }
    summaryText = `匹配 ${matched} 台主机`;
  }

  function sectionCollapsed(id: string) {
    return collapsedIds.includes(id);
  }

  function toggleCollapsed(id: string) {
    setCollapsedIds((prev) => {
      let next: string[];
      if (prev.includes(id)) {
        next = prev.filter((item) => item !== id);
      } else {
        next = [...prev, id];
      }
      writeCollapsedIds(next);
      return next;
    });
  }

  function closeAllMenus() {
    setHostMenu(null);
    setGroupMenu(null);
    setBlankMenu(null);
    setMoveSubOpen(false);
  }

  function requestCreateHost(groupId?: string) {
    closeAllMenus();
    const gid = groupId === undefined ? preferredGroupId : groupId;
    if (onCreateHost) {
      onCreateHost(gid || undefined);
      return;
    }
    showToast("请在 entry 接入 HostCreateForm（见文件顶部 INTEGRATION）");
  }

  function requestCreateGroup() {
    closeAllMenus();
    if (onCreateGroup) {
      onCreateGroup();
      return;
    }
    showToast("请在 App 接入新建分组抽屉（见文件顶部 INTEGRATION）");
  }

  const selectHost = useCallback(
    (
      sectionId: string,
      name: string,
      event: { metaKey: boolean; ctrlKey: boolean; shiftKey: boolean },
    ) => {
      if (isAdditiveSelect(event)) {
        setSelectionSection(sectionId);
        setSelected((prev) =>
          prev.includes(name) ? prev.filter((item) => item !== name) : [...prev, name],
        );
        return;
      }
      if (event.shiftKey && selectionSection === sectionId && selected.length > 0) {
        const section = sections.find((item) => item.id === sectionId);
        if (!section) return;
        const names = section.hosts.map((host) => host.name);
        const anchor = selected[selected.length - 1]!;
        const from = names.indexOf(anchor);
        const to = names.indexOf(name);
        if (from >= 0 && to >= 0) {
          const [a, b] = from < to ? [from, to] : [to, from];
          setSelected(names.slice(a, b + 1));
          return;
        }
      }
      setSelectionSection(sectionId);
      setSelected([name]);
    },
    [sections, selected, selectionSection],
  );

  async function reorderNear(
    sectionId: string,
    dragged: string,
    target: string,
    after: boolean,
  ) {
    if (dragged === target) return;
    if (sectionId === PINNED_SECTION) {
      const names = session.pinned.filter(Boolean);
      if (!names.includes(dragged) || !names.includes(target)) return;
      const next = names.filter((name) => name !== dragged);
      let index = next.indexOf(target);
      if (index < 0) return;
      if (after) index += 1;
      next.splice(index, 0, dragged);
      session.reorderPinned(next);
      return;
    }
    if (sectionId === UNGROUPED_ID) return;
    const group = session.groups.find((item) => item.id === sectionId);
    if (!group) return;
    const names = (group.hosts || []).filter(Boolean);
    if (!names.includes(dragged) || !names.includes(target)) return;
    const next = names.filter((name) => name !== dragged);
    let index = next.indexOf(target);
    if (index < 0) return;
    if (after) index += 1;
    next.splice(index, 0, dragged);
    const same =
      next.length === names.length && next.every((name, i) => name === names[i]);
    if (same) return;
    await api.reorderGroupHosts(sectionId, next);
    await session.refresh();
  }

  async function moveHostToGroup(host: string, groupId: string) {
    // groupId 空或未分组 id → 清分组
    const target =
      !groupId || groupId === UNGROUPED_ID || groupId === PINNED_SECTION ? "" : groupId;
    if (target) {
      const g = session.groups.find((item) => item.id === target);
      if (g?.hosts?.includes(host)) {
        showToast(`${host} 已在「${g.name}」中`);
        return;
      }
    } else {
      const inAny = session.groups.some((g) => (g.hosts || []).includes(host));
      if (!inAny) {
        showToast(`${host} 已在未分组`);
        return;
      }
    }
    try {
      await api.assignHost(host, target);
      await session.refresh();
      const label = target
        ? session.groups.find((g) => g.id === target)?.name || "分组"
        : "未分组";
      showToast(`已将 ${host} 移至「${label}」`);
    } catch (err) {
      showError(`移动失败: ${formatErr(err)}`);
    }
  }

  async function pinHostByDrop(host: string) {
    if (session.pinned.includes(host)) {
      showToast(`${host} 已置顶`);
      return;
    }
    session.togglePin(host);
    showToast(`已置顶 ${host}`);
  }

  /**
   * 拖拽贴近主内容区上下边缘时纵向自动滚动（分组拖拽、主机拖拽共用）。
   * getY 返回最新指针纵坐标；真正滚动后调用 onScrolled 重算落点。返回停止函数。
   */
  function startEdgeAutoScroll(getY: () => number, onScrolled: () => void) {
    const scroller = scrollRef.current;
    let frame = 0;
    function tick() {
      if (scroller) {
        const rect = scroller.getBoundingClientRect();
        const y = getY();
        let delta = 0;
        if (y < rect.top + DRAG_SCROLL_EDGE) {
          delta = -DRAG_SCROLL_STEP;
        } else if (y > rect.bottom - DRAG_SCROLL_EDGE) {
          delta = DRAG_SCROLL_STEP;
        }
        if (delta !== 0) {
          const before = scroller.scrollTop;
          scroller.scrollTop += delta;
          if (scroller.scrollTop !== before) onScrolled();
        }
      }
      frame = requestAnimationFrame(tick);
    }
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }

  function onHostPointerDown(
    event: ReactPointerEvent<HTMLDivElement>,
    sectionId: string,
    hostName: string,
  ) {
    if (event.button !== 0) return;
    if (isAdditiveSelect(event) || event.shiftKey) return;
    const startX = event.clientX;
    const startY = event.clientY;
    let active = false;
    let lastX = startX;
    let lastY = startY;
    let stopAutoScroll: (() => void) | null = null;
    const pointerId = event.pointerId;
    const targetEl = event.currentTarget as HTMLElement;
    targetEl.setPointerCapture(pointerId);

    function onMove(moveEvent: PointerEvent) {
      if (moveEvent.pointerId !== pointerId) return;
      lastX = moveEvent.clientX;
      lastY = moveEvent.clientY;
      if (!active) {
        if (Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) < 6) {
          return;
        }
        active = true;
        suppressClick.current = true;
        setDragging(true);
        document.body.style.userSelect = "none";
        document.body.style.cursor = "grabbing";
        stopAutoScroll = startEdgeAutoScroll(
          () => lastY,
          () => updateHostTarget(lastX, lastY),
        );
      }
      updateHostTarget(moveEvent.clientX, moveEvent.clientY);
    }

    function updateHostTarget(clientX: number, clientY: number) {
      // 同组排序线
      const sortNode = document
        .elementFromPoint(clientX, clientY)
        ?.closest("[data-host-sort]") as HTMLElement | null;
      if (sortNode) {
        const groupId = sortNode.dataset.hostGroup || "";
        const target = sortNode.dataset.hostSort || "";
        if (groupId && target && groupId === sectionId && target !== hostName) {
          // 未分组不支持组内排序
          if (groupId !== UNGROUPED_ID) {
            const rect = sortNode.getBoundingClientRect();
            const after = clientY > rect.top + rect.height / 2;
            const next = { sectionId: groupId, target, after };
            insertMarkRef.current = next;
            setInsertMark(next);
            dropTargetRef.current = null;
            setDropTargetId(null);
            return;
          }
        }
      }

      insertMarkRef.current = null;
      setInsertMark(null);

      // 跨组 / 置顶投放
      const dropNode = document
        .elementFromPoint(clientX, clientY)
        ?.closest("[data-drop-group]") as HTMLElement | null;
      const dropId = dropNode?.dataset.dropGroup || null;
      if (dropId && dropId !== sectionId) {
        dropTargetRef.current = dropId;
        setDropTargetId(dropId);
        return;
      }
      dropTargetRef.current = null;
      setDropTargetId(null);
    }

    async function onUp(upEvent: PointerEvent) {
      if (upEvent.pointerId !== pointerId) return;
      targetEl.releasePointerCapture(pointerId);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      if (stopAutoScroll) stopAutoScroll();
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
      setDragging(false);
      const mark = insertMarkRef.current;
      const dropId = dropTargetRef.current;
      insertMarkRef.current = null;
      dropTargetRef.current = null;
      setInsertMark(null);
      setDropTargetId(null);
      if (!active) return;
      try {
        if (mark && mark.sectionId === sectionId) {
          await reorderNear(sectionId, hostName, mark.target, mark.after);
        } else if (dropId) {
          if (dropId === PINNED_SECTION) {
            await pinHostByDrop(hostName);
          } else if (dropId !== sectionId) {
            await moveHostToGroup(hostName, dropId);
          }
        }
      } catch (err) {
        console.error(err);
        showError(formatErr(err));
      }
      setTimeout(() => {
        suppressClick.current = false;
      }, 0);
    }

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  function isSortableGroup(section: Section) {
    if (section.id === PINNED_SECTION) return false;
    if (section.id === UNGROUPED_ID) return false;
    return true;
  }

  async function moveGroupTo(dragged: string, mark: GroupDropMark) {
    const nextRows = moveGroupInRows(groupRows, dragged, mark);
    if (JSON.stringify(nextRows) === JSON.stringify(groupRows)) return;
    updateSettings({ hostHomeRows: nextRows });
    // 布局按「从上到下、从左到右」展开同步到分组 order，下拉框等处顺序与首页一致
    const flat = nextRows.flat();
    const current = migrateGroups.map((group) => group.id);
    const same = flat.length === current.length && flat.every((id, i) => id === current[i]);
    if (same) return;
    // 分组不允许嵌套（groups.MaxDepth=1），全部是顶层，父级传空
    await api.reorderGroups("", flat);
    await session.refresh();
  }

  function onGroupHeadPointerDown(
    event: ReactPointerEvent<HTMLDivElement>,
    section: Section,
  ) {
    if (event.button !== 0) return;
    if (!isSortableGroup(section)) return;
    // 筛选时只看到部分分组，禁止排序
    if (keyword) return;
    if ((event.target as HTMLElement).closest("[data-collapse-toggle]")) return;
    const rack = rackRef.current;
    if (!rack) return;
    const startX = event.clientX;
    const startY = event.clientY;
    const pointerId = event.pointerId;
    const headEl = event.currentTarget as HTMLElement;
    const draggedId = section.id;
    let active = false;
    let lastX = startX;
    let lastY = startY;
    let stopAutoScroll: (() => void) | null = null;

    function setMark(next: GroupDropMark | null) {
      groupInsertRef.current = next;
      setGroupInsert(next);
    }

    // 落点判定：
    // 1. 指针在「新建一排」落区内或其下方 → 追加新排
    // 2. 否则找指针所在的排：最后一个顶部在指针上方的排（排下方空白到下一排之前都算该排）
    // 3. 指针在该排底部与下一排顶部之间的间隙 → 在两排之间插入新排
    // 4. 否则在该排内：先按块顶部分子行（排内折行），再按 x 与块中线比较求插入点
    function updateInsert(clientX: number, clientY: number) {
      const rowEls = Array.from(rack!.querySelectorAll<HTMLElement>("[data-rack-row]"));
      const newRowEl = rack!.querySelector<HTMLElement>("[data-rack-new-row]");
      if (newRowEl && clientY >= newRowEl.getBoundingClientRect().top) {
        setMark({ kind: "newRow", beforeRow: rowEls.length });
        return;
      }
      if (rowEls.length === 0) {
        setMark(null);
        return;
      }

      let rowIndex = 0;
      for (let i = 0; i < rowEls.length; i++) {
        if (clientY >= rowEls[i]!.getBoundingClientRect().top) rowIndex = i;
      }
      const rowEl = rowEls[rowIndex]!;
      const rowRect = rowEl.getBoundingClientRect();
      const hasNextRow = rowIndex < rowEls.length - 1;
      if (clientY > rowRect.bottom && hasNextRow) {
        setMark({ kind: "newRow", beforeRow: rowIndex + 1 });
        return;
      }

      const lines: { top: number; blocks: { el: HTMLElement; rect: DOMRect }[] }[] = [];
      for (const el of Array.from(rowEl.querySelectorAll<HTMLElement>("[data-group-sortable]"))) {
        const rect = el.getBoundingClientRect();
        const top = Math.round(rect.top);
        let line = lines.find((item) => item.top === top);
        if (!line) {
          line = { top, blocks: [] };
          lines.push(line);
        }
        line.blocks.push({ el, rect });
      }
      lines.sort((a, b) => a.top - b.top);
      let targetLine = lines[0];
      for (const line of lines) {
        if (clientY >= line.top) targetLine = line;
      }
      if (!targetLine) {
        setMark(null);
        return;
      }
      for (const block of targetLine.blocks) {
        if (clientX < block.rect.left + block.rect.width / 2) {
          setMark({ kind: "block", target: block.el.dataset.groupSortable || "", after: false });
          return;
        }
      }
      const last = targetLine.blocks[targetLine.blocks.length - 1]!;
      setMark({ kind: "block", target: last.el.dataset.groupSortable || "", after: true });
    }

    function onMove(moveEvent: PointerEvent) {
      if (moveEvent.pointerId !== pointerId) return;
      lastX = moveEvent.clientX;
      lastY = moveEvent.clientY;
      if (!active) {
        const distance = Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY);
        if (distance <= GROUP_DRAG_THRESHOLD) return;
        active = true;
        // 开始拖动后才捕获指针：未超阈值时组名按钮的 click 仍落在按钮上
        headEl.setPointerCapture(pointerId);
        suppressClick.current = true;
        setDraggingGroupId(draggedId);
        document.body.style.userSelect = "none";
        document.body.style.cursor = "grabbing";
        stopAutoScroll = startEdgeAutoScroll(
          () => lastY,
          () => updateInsert(lastX, lastY),
        );
      }
      updateInsert(moveEvent.clientX, moveEvent.clientY);
    }

    async function onUp(upEvent: PointerEvent) {
      if (upEvent.pointerId !== pointerId) return;
      if (headEl.hasPointerCapture(pointerId)) {
        headEl.releasePointerCapture(pointerId);
      }
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      if (stopAutoScroll) stopAutoScroll();
      const mark = groupInsertRef.current;
      setMark(null);
      setDraggingGroupId(null);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
      if (!active) return;
      active = false;
      try {
        if (mark) await moveGroupTo(draggedId, mark);
      } catch (err) {
        showError(`调整分组顺序失败: ${formatErr(err)}`);
      }
      setTimeout(() => {
        suppressClick.current = false;
      }, 0);
    }

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  insertMarkRef.current = insertMark;
  dropTargetRef.current = dropTargetId;

  async function confirmDeleteHosts() {
    if (!deletingHosts?.length) return;
    for (const name of deletingHosts) {
      await api.deleteHost(name);
    }
    setDeletingHosts(null);
    setSelected([]);
    await session.refresh();
    showToast("已删除");
  }

  async function saveGroupSettings() {
    if (!groupSettings || groupSettingsBusy) return;
    const id = groupSettings.id.trim();
    if (!id || id === UNGROUPED_ID) return;
    const nextName = groupSettings.name.trim();
    if (!nextName) {
      showError("分组名称不能为空");
      return;
    }
    if (!GROUP_NAME_RE.test(nextName)) {
      showError("只允许英文字母、数字和短横线，例如 01-cdcp-main");
      return;
    }
    setGroupSettingsBusy(true);
    try {
      const g = session.groups.find((item) => item.id === id);
      let effectiveID = id;
      if (!g || g.name !== nextName) {
        effectiveID = await api.renameGroup(id, nextName);
      }
      // 改名会换 id：首页排布里同步替换，分组留在原位
      if (effectiveID !== id) {
        const rows = readSettings().hostHomeRows.map((row) =>
          row.map((item) => (item === id ? effectiveID : item)),
        );
        updateSettings({ hostHomeRows: rows });
      }
      const nextBoard = groupSettings.boardTitle.trim();
      const curBoard = (g?.boardTitle || "").trim();
      if (nextBoard !== curBoard) {
        await api.setBoardTitle(effectiveID, nextBoard);
      }
      setGroupSettings(null);
      await session.refresh();
      showToast("已保存");
    } catch (err) {
      showError(`保存失败: ${formatErr(err)}`);
    } finally {
      setGroupSettingsBusy(false);
    }
  }

  async function openDeleteGroup(id: string, name: string) {
    let detail = `确定删除分组「${name}」及其全部子分组？子树内主机将回到未分组，主机本身不会被删除。`;
    try {
      const stats = await api.previewDeleteGroup(id);
      detail = `确定删除分组「${name}」？\n将删除 ${stats.groupCount} 个分组（含自身与子分组），${stats.hostCount} 台主机回到未分组。主机本身不会被删除。`;
    } catch {
      /* 预览失败仍允许确认删除 */
    }
    setDeleteGroupConfirm({ id, name, detail });
  }

  async function confirmDeleteGroup() {
    if (!deleteGroupConfirm) return;
    const { id, name } = deleteGroupConfirm;
    try {
      await api.deleteGroup(id);
      setDeleteGroupConfirm(null);
      await session.refresh();
      showToast(`已删除分组 ${name}`);
    } catch (err) {
      showError(`删除失败: ${formatErr(err)}`);
    }
  }

  async function runInstallAgent(host: string) {
    setAgentBusy(true);
    try {
      await api.installAgent(host);
      setInstallConfirm(null);
      showToast(`${host}：Agent 安装/更新已完成`);
    } catch (err) {
      showError(`安装失败: ${formatErr(err)}`);
    } finally {
      setAgentBusy(false);
    }
  }

  async function runCheckAgent(host: string) {
    setCheckHost(host);
    setCheckOpen(true);
    setCheckBusy(true);
    setCheckText("检查中…");
    try {
      const report = await api.checkAgent(host);
      const lines: string[] = [];
      for (const [key, value] of Object.entries(report as unknown as Record<string, unknown>)) {
        if (value === undefined || value === null || value === "") continue;
        lines.push(`${key}: ${String(value)}`);
      }
      setCheckText(lines.length > 0 ? lines.join("\n") : JSON.stringify(report, null, 2));
    } catch (err) {
      setCheckText(`检查失败: ${formatErr(err)}`);
    } finally {
      setCheckBusy(false);
    }
  }

  // 快捷键：⌘F 筛选
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        closeAllMenus();
        return;
      }
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return;

      if (e.code === "KeyF") {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 置顶单独占最上一排、未分组单独占最下一排；中间按用户排布，筛选后空排不显示
  const sectionById = new Map(sections.map((section) => [section.id, section]));
  const pinnedSection = sectionById.get(PINNED_SECTION);
  const ungroupedSection = sectionById.get(UNGROUPED_ID);
  const visibleRows: { index: number; sections: Section[] }[] = [];
  groupRows.forEach((ids, index) => {
    const rowSections: Section[] = [];
    for (const id of ids) {
      const section = sectionById.get(id);
      if (section) rowSections.push(section);
    }
    if (rowSections.length > 0) visibleRows.push({ index, sections: rowSections });
  });

  function renderSection(section: Section) {
    const collapsed = sectionCollapsed(section.id);
    const isDrop = dropTargetId === section.id;
    const sortable = !keyword && isSortableGroup(section);
    let insertSide: string | null = null;
    if (groupInsert && groupInsert.kind === "block" && groupInsert.target === section.id) {
      if (groupInsert.after) {
        insertSide = "after";
      } else {
        insertSide = "before";
      }
    }
    return (
      <section
        key={section.id}
        className={`host-rack-block ${draggingGroupId === section.id ? "opacity-50" : ""}`}
        data-drop-group={section.id}
        data-drop-active={isDrop ? "true" : undefined}
        data-group-sortable={sortable ? section.id : undefined}
      >
        {insertSide ? (
          <div className="host-rack-insert" data-side={insertSide} />
        ) : null}
        <div
          data-group-head
          className={`flex h-9 w-full items-center gap-1 pr-2 ${sortable ? "cursor-grab" : ""}`}
          onPointerDown={(event) => onGroupHeadPointerDown(event, section)}
          onContextMenu={(event) => {
            if (section.isPinned) return;
            event.preventDefault();
            event.stopPropagation();
            closeAllMenus();
            const next = clampMenuPos(event.clientX, event.clientY, 180, 220);
            setGroupMenu({
              id: section.id,
              name: section.name,
              x: next.x,
              y: next.y,
            });
          }}
        >
          <button
            type="button"
            aria-label="折叠或展开分组"
            aria-expanded={!collapsed}
            data-collapse-toggle
            className="ml-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center text-muted hover:text-ink"
            onClick={(event) => {
              event.stopPropagation();
              toggleCollapsed(section.id);
            }}
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 12 12"
              aria-hidden="true"
              className="motion-transform"
              style={{
                transform: collapsed ? "rotate(-90deg)" : undefined,
              }}
            >
              <path
                d="M2.5 4.5 6 8l3.5-3.5"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
          <button
            type="button"
            className={`flex h-full min-w-0 flex-1 items-center gap-2 px-1 text-left hover:text-accent ${sortable ? "cursor-grab" : ""}`}
            onClick={() => {
              if (suppressClick.current) return;
              if (section.isPinned) return;
              setPreferredGroupId(
                section.id === UNGROUPED_ID ? "" : section.id,
              );
              setSelected([]);
              setSelectionSection(null);
            }}
          >
            <span className="truncate text-sm font-semibold text-ink">
              {section.name}
            </span>
            <span className="text-xs tabular-nums text-muted">
              {section.hosts.length}
            </span>
          </button>
        </div>

        {!collapsed ? (
          <div className="flex flex-col gap-0.5">
            {section.hosts.length === 0 && !keyword ? (
              <p className="m-0 flex h-10 items-center px-2 text-muted">
                没有主机
              </p>
            ) : null}
            {section.hosts.map((host) => {
              const selectedRow = selected.includes(host.name);
              const mark =
                insertMark?.sectionId === section.id &&
                insertMark.target === host.name
                  ? insertMark.after
                    ? "after"
                    : "before"
                  : null;
              return (
                <div
                  key={`${section.id}-${host.name}`}
                  data-host-row
                  data-host-sort={host.name}
                  data-host-group={section.id}
                  data-pin-host={section.isPinned ? host.name : undefined}
                  data-host-axis="y"
                  tabIndex={0}
                  className={`host-rack-row motion-colors relative flex h-10 cursor-grab items-center gap-2.5 rounded-control px-2 outline-none focus-visible:outline-2 focus-visible:outline-accent-focus active:cursor-grabbing ${
                    selectedRow ? "bg-accent-soft" : "hover:bg-surface"
                  }`}
                  onPointerDown={(event) =>
                    onHostPointerDown(event, section.id, host.name)
                  }
                  onClick={(event) => {
                    if (suppressClick.current) return;
                    selectHost(section.id, host.name, event);
                  }}
                  onDoubleClick={() => {
                    if (suppressClick.current) return;
                    session.openHost(host.name, "overview");
                  }}
                  onKeyDown={(event) => {
                    if (event.target !== event.currentTarget) return;
                    if (event.key === "Enter") {
                      session.openHost(host.name, "overview");
                    }
                  }}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    const hosts = selected.includes(host.name)
                      ? selected.slice()
                      : [host.name];
                    if (!selected.includes(host.name)) {
                      setSelected([host.name]);
                      setSelectionSection(section.id);
                    }
                    closeAllMenus();
                    const next = clampMenuPos(
                      event.clientX,
                      event.clientY,
                      200,
                      hosts.length > 1 ? 260 : 520,
                    );
                    setHostMenu({
                      host: host.name,
                      hosts,
                      x: next.x,
                      y: next.y,
                    });
                  }}
                >
                  {mark === "before" ? (
                    <div className="absolute inset-x-2 top-0 h-0.5 bg-accent" />
                  ) : null}
                  {mark === "after" ? (
                    <div className="absolute inset-x-2 bottom-0 h-0.5 bg-accent" />
                  ) : null}
                  <DistroBadge boxSize={22} osRelease={session.osRelease[host.name]} />
                  <span
                    data-tip={host.name} data-tip-overflow=""
                    className={`min-w-0 flex-1 truncate ${
                      selectedRow ? "text-accent" : "text-ink"
                    }`}
                  >
                    {host.name}
                  </span>
                  <button
                    type="button"
                    aria-label="编辑主机"
                    className="host-rack-edit inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-control text-muted hover:bg-line hover:text-ink"
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={(event) => {
                      event.stopPropagation();
                      session.setEditingHost(host.name);
                    }}
                  >
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <path d="M12 20h9" />
                      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
                    </svg>
                  </button>
                </div>
              );
            })}
          </div>
        ) : null}
      </section>
    );
  }

  return (
    <div
      className={`flex h-full min-h-0 flex-col ${dragging ? "select-none" : ""}`}
      onContextMenu={(event) => {
        const el = (event.target as HTMLElement).closest(
          "[data-group-head], [data-host-row], .host-home-toolbar, button, input, textarea",
        );
        if (el) return;
        event.preventDefault();
        closeAllMenus();
        const next = clampMenuPos(event.clientX, event.clientY, 220, 100);
        setBlankMenu(next);
      }}
    >
      <ShellToolbarPortal>
        <div className="host-home-toolbar grid h-full w-full grid-cols-[1fr_auto_1fr] items-center px-5">
          <div />
          <input
            ref={searchRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                if (query) {
                  event.stopPropagation();
                  setQuery("");
                  return;
                }
                (event.target as HTMLInputElement).blur();
              }
            }}
            placeholder={`筛选主机 (${shortcutLabel("F")})`}
            className="motion-field box-border h-8 w-[min(24rem,40vw)] rounded-control px-3 leading-none"
          />
          <div className="relative flex h-full items-center justify-self-end">
            <Button
              variant="ghost"
              size="sm"
              aria-label="新建"
              onClick={(event) => {
                event.stopPropagation();
                const btn = event.currentTarget;
                const rect = btn.getBoundingClientRect();
                // 按钮在最右侧，菜单右缘跟按钮对齐
                closeAllMenus();
                setBlankMenu({ x: rect.right - 180, y: rect.bottom + 4 });
              }}
            >
              +
            </Button>
          </div>
        </div>
      </ShellToolbarPortal>

      <div className="content-float flex min-w-0 flex-1 flex-col">
      {/* 提示条在机柜上方占位（不随机柜滚走）；与机柜的间距即下方滚动区的 16px 安全边距 */}
      {flash.toast || flash.error || flash.warn ? (
        <div className="shrink-0 px-4 pt-4">
          <FlashNotices flash={flash} />
        </div>
      ) : null}

      {/* 内容区四周 16px 安全边距；分组为机柜式块，按用户自定义的排纵向堆叠（DESIGN.md §9） */}
      <div
        ref={scrollRef}
        className="flex min-h-0 flex-1 flex-col gap-card overflow-auto p-4"
      >
        <p className="m-0 text-xs text-muted">{summaryText}</p>
        {keyword && sections.length === 0 ? (
          <p className="m-0 text-sm text-muted">无匹配主机</p>
        ) : null}
        {!keyword && sections.length === 0 ? (
          <p className="m-0 text-sm text-muted">暂无主机</p>
        ) : null}

        <div ref={rackRef} className="flex flex-col gap-section">
          {pinnedSection ? (
            <div className="host-rack-lane">{renderSection(pinnedSection)}</div>
          ) : null}
          {visibleRows.map((row) => {
            const showGapLine =
              groupInsert?.kind === "newRow" &&
              groupInsert.beforeRow === row.index &&
              row.index > 0;
            return (
              <div key={row.index} className="host-rack-lane" data-rack-row={row.index}>
                {showGapLine ? <div className="host-rack-lane-insert" /> : null}
                {row.sections.map((section) => renderSection(section))}
              </div>
            );
          })}
          {draggingGroupId ? (
            <div
              className="host-rack-new-row"
              data-rack-new-row
              data-active={
                groupInsert?.kind === "newRow" && groupInsert.beforeRow === groupRows.length
                  ? "true"
                  : undefined
              }
            >
              拖到这里新建一排
            </div>
          ) : null}
          {ungroupedSection ? (
            <div className="host-rack-lane">{renderSection(ungroupedSection)}</div>
          ) : null}
        </div>

      </div>
      </div>

      {/* 空白 / 新建快捷菜单 */}
      {blankMenu ? (
        <CtxPortal x={blankMenu.x} y={blankMenu.y} onClose={closeAllMenus}>
          <MenuItem
            label="添加主机"
            onClick={() => requestCreateHost()}
          />
          <MenuItem
            label="新建分组"
            onClick={() => requestCreateGroup()}
          />
        </CtxPortal>
      ) : null}

      {/* 分组右键 */}
      {groupMenu ? (
        <CtxPortal x={groupMenu.x} y={groupMenu.y} onClose={closeAllMenus}>
          <MenuItem
            label="打开列表"
            onClick={() => {
              const id = groupMenu.id;
              closeAllMenus();
              session.openGroup(id);
            }}
          />
          {groupMenu.id !== UNGROUPED_ID ? (
            <>
              <MenuItem
                label="浏览器打开看板"
                onClick={() => {
                  const id = groupMenu.id;
                  closeAllMenus();
                  void api.openBoardInBrowser(id).catch((err) => {
                    showError(`打开看板失败: ${formatErr(err)}`);
                  });
                }}
              />
              <MenuItem
                label="复制看板链接"
                onClick={() => {
                  const id = groupMenu.id;
                  closeAllMenus();
                  void api
                    .listBoardURLs(id)
                    .then(async (urls) => {
                      const url = (urls || [])[0];
                      if (!url) throw new Error("无可用内网地址");
                      await copyText(url);
                      showToast("看板链接已复制");
                    })
                    .catch((err) => {
                      showError(`复制失败: ${formatErr(err)}`);
                    });
                }}
              />
            </>
          ) : null}
          {groupMenu.id !== UNGROUPED_ID ? (
            <>
              <MenuDivider />
              <MenuItem
                label="分组设置…"
                onClick={() => {
                  const id = groupMenu.id;
                  const name = groupMenu.name;
                  const g = session.groups.find((item) => item.id === id);
                  closeAllMenus();
                  setGroupSettings({
                    id,
                    name,
                    boardTitle: (g?.boardTitle || "").trim(),
                  });
                }}
              />
            </>
          ) : null}
          <MenuDivider />
          <MenuItem
            label="添加主机"
            onClick={() => {
              const gid = groupMenu.id === UNGROUPED_ID ? "" : groupMenu.id;
              requestCreateHost(gid);
            }}
          />
          {groupMenu.id !== UNGROUPED_ID ? (
            <>
              <MenuDivider />
              <MenuItem
                label="删除分组…"
                danger
                onClick={() => {
                  const { id, name } = groupMenu;
                  closeAllMenus();
                  void openDeleteGroup(id, name);
                }}
              />
            </>
          ) : null}
        </CtxPortal>
      ) : null}

      {/* 主机右键 */}
      {hostMenu ? (
        <CtxPortal
          x={hostMenu.x}
          y={hostMenu.y}
          onClose={closeAllMenus}
          wide
        >
          {hostMenu.hosts.length > 1 ? (
            <div className="px-3 py-1.5 text-xs text-muted">
              已选 {hostMenu.hosts.length} 台
            </div>
          ) : null}
          <MenuItem
            label="打开"
            onClick={() => {
              const hosts = hostMenu.hosts.slice();
              closeAllMenus();
              for (const name of hosts) session.openHost(name, "overview");
            }}
          />
          {/* 「打开」即进概览；与 Vue「打开概览」同义，避免重复两项 */}
          <MenuItem
            label="打开文件"
            onClick={() => {
              const hosts = hostMenu.hosts.slice();
              closeAllMenus();
              for (const name of hosts) session.openHost(name, "files");
            }}
          />
          <MenuItem
            label="打开监控"
            onClick={() => {
              const hosts = hostMenu.hosts.slice();
              closeAllMenus();
              for (const name of hosts) session.openHost(name, "monitor");
            }}
          />
          <MenuItem
            label="终端打开"
            onClick={() => {
              const hosts = hostMenu.hosts.slice();
              closeAllMenus();
              setSelected([]);
              void api
                .openHostsInTerminal(hosts, settings.terminalOpenMode)
                .catch((err) => showError(`终端打开失败: ${formatErr(err)}`));
            }}
          />
          {hostMenu.hosts.length <= 1 ? (
            <>
              <MenuDivider />
              <MenuItem
                label="编辑…"
                onClick={() => {
                  const name = hostMenu.host;
                  closeAllMenus();
                  session.setEditingHost(name);
                }}
              />
              <MenuItem
                label="复制信息"
                onClick={() => {
                  const name = hostMenu.host;
                  closeAllMenus();
                  void api
                    .formatHostInfo(name)
                    .then((text) => copyText(text))
                    .then(() => showToast("已复制主机信息"))
                    .catch((err) => showError(`复制失败: ${formatErr(err)}`));
                }}
              />
              <MenuItem
                label="更新图标"
                onClick={() => {
                  const name = hostMenu.host;
                  closeAllMenus();
                  void api
                    .refreshHostIcon(name)
                    .then(async (icon) => {
                      await session.refresh();
                      showToast(`${name}：${icon.osRelease || "图标已更新"}`);
                    })
                    .catch((err) =>
                      showError(`更新图标失败: ${formatErr(err)}`),
                    );
                }}
              />
              <MenuItem
                label={
                  session.pinned.includes(hostMenu.host) ? "取消置顶" : "置顶"
                }
                onClick={() => {
                  const name = hostMenu.host;
                  closeAllMenus();
                  const was = session.pinned.includes(name);
                  session.togglePin(name);
                  showToast(was ? `已取消置顶 ${name}` : `已置顶 ${name}`);
                }}
              />
              <div
                className="relative"
                onMouseEnter={() => setMoveSubOpen(true)}
                onMouseLeave={() => setMoveSubOpen(false)}
              >
                <button
                  type="button"
                  className="flex w-full items-center justify-between px-3 py-2 text-left hover:bg-raised"
                >
                  <span>迁移分组</span>
                  <span className="text-muted">›</span>
                </button>
                {moveSubOpen ? (
                  <div className="absolute left-full top-0 z-[62] ml-1 max-h-[280px] min-w-[148px] overflow-y-auto rounded-panel border border-line bg-surface py-1">
                    <button
                      type="button"
                      className={`flex w-full px-3 py-2 text-left hover:bg-raised ${
                        session.groupIdOf(hostMenu.host) === ""
                          ? "bg-accent-soft font-semibold text-accent"
                          : ""
                      }`}
                      onClick={() => {
                        const name = hostMenu.host;
                        closeAllMenus();
                        void moveHostToGroup(name, "");
                      }}
                    >
                      未分组
                    </button>
                    {migrateGroups.map((g) => (
                      <button
                        key={g.id}
                        type="button"
                        className={`flex w-full px-3 py-2 text-left hover:bg-raised ${
                          session.groupIdOf(hostMenu.host) === g.id
                            ? "bg-accent-soft font-semibold text-accent"
                            : ""
                        }`}
                        onClick={() => {
                          const name = hostMenu.host;
                          closeAllMenus();
                          void moveHostToGroup(name, g.id);
                        }}
                      >
                        {g.name}
                      </button>
                    ))}
                    {migrateGroups.length === 0 ? (
                      <div className="px-3 py-2 text-xs text-muted">
                        暂无分组，请先新建
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
              <MenuDivider />
              <MenuItem
                label="安装 Agent…"
                onClick={() => {
                  const name = hostMenu.host;
                  closeAllMenus();
                  setInstallConfirm(name);
                }}
              />
              <MenuItem
                label="检查 Agent…"
                onClick={() => {
                  const name = hostMenu.host;
                  closeAllMenus();
                  void runCheckAgent(name);
                }}
              />
              <MenuDivider />
              <MenuItem
                label="删除…"
                danger
                onClick={() => {
                  const hosts = hostMenu.hosts.slice();
                  closeAllMenus();
                  setDeletingHosts(hosts);
                }}
              />
            </>
          ) : (
            <>
              <MenuDivider />
              <MenuItem
                label="删除…"
                danger
                onClick={() => {
                  const hosts = hostMenu.hosts.slice();
                  closeAllMenus();
                  setDeletingHosts(hosts);
                }}
              />
            </>
          )}
        </CtxPortal>
      ) : null}

      <Dialog
        open={!!deletingHosts}
        onOpenChange={(open) => !open && setDeletingHosts(null)}
      >
        <DialogContent>
          <DialogTitle>删除主机</DialogTitle>
          <DialogDescription>
            确定删除 {(deletingHosts || []).join("、")}？此操作不可撤销。
          </DialogDescription>
          <DialogFooter>
            <Button onClick={() => setDeletingHosts(null)}>取消</Button>
            <Button variant="danger" onClick={() => void confirmDeleteHosts()}>
              删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!groupSettings}
        onOpenChange={(open) => !open && setGroupSettings(null)}
      >
        <DialogContent>
          <DialogTitle>分组设置</DialogTitle>
          <label className="mt-3 block text-sm text-muted">分组名称</label>
          <input
            className="motion-field mt-1 h-9 w-full rounded-control px-3"
            value={groupSettings?.name || ""}
            onChange={(event) =>
              setGroupSettings((prev) =>
                prev ? { ...prev, name: event.target.value } : prev,
              )
            }
          />
          <label className="mt-3 block text-sm text-muted">看板标题</label>
          <input
            className="motion-field mt-1 h-9 w-full rounded-control px-3"
            value={groupSettings?.boardTitle || ""}
            placeholder="看板正中标题，可空"
            onChange={(event) =>
              setGroupSettings((prev) =>
                prev ? { ...prev, boardTitle: event.target.value } : prev,
              )
            }
          />
          <DialogFooter>
            <Button onClick={() => setGroupSettings(null)}>取消</Button>
            <Button
              variant="primary"
              disabled={groupSettingsBusy}
              onClick={() => void saveGroupSettings()}
            >
              {groupSettingsBusy ? "保存中…" : "保存"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!deleteGroupConfirm}
        onOpenChange={(open) => !open && setDeleteGroupConfirm(null)}
      >
        <DialogContent>
          <DialogTitle>删除分组</DialogTitle>
          <DialogDescription className="whitespace-pre-wrap">
            {deleteGroupConfirm?.detail || ""}
          </DialogDescription>
          <DialogFooter>
            <Button onClick={() => setDeleteGroupConfirm(null)}>取消</Button>
            <Button variant="danger" onClick={() => void confirmDeleteGroup()}>
              删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!installConfirm}
        onOpenChange={(open) => !open && setInstallConfirm(null)}
      >
        <DialogContent>
          <DialogTitle>安装 Agent</DialogTitle>
          <DialogDescription>
            将向 {installConfirm} 部署 spanel-agent（systemd 服务，约 10MB）。已安装时更新到面板内置版本，历史数据保留。
          </DialogDescription>
          <DialogFooter>
            <Button onClick={() => setInstallConfirm(null)}>取消</Button>
            <Button
              variant="primary"
              disabled={agentBusy}
              onClick={() => installConfirm && void runInstallAgent(installConfirm)}
            >
              {agentBusy ? "安装中…" : "安装"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={checkOpen} onOpenChange={(open) => !open && setCheckOpen(false)}>
        <DialogContent className="w-[min(520px,calc(100%-32px))]">
          <DialogTitle>检查 Agent · {checkHost}</DialogTitle>
          <pre className="mt-3 max-h-[360px] overflow-auto whitespace-pre-wrap rounded-control bg-raised p-3 text-xs text-ink">
            {checkBusy ? "检查中…" : checkText}
          </pre>
          <DialogFooter>
            <Button onClick={() => setCheckOpen(false)}>关闭</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function CtxPortal({
  x,
  y,
  onClose,
  children,
  wide = false,
}: {
  x: number;
  y: number;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  const elRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!elRef.current) return;
    const rect = elRef.current.getBoundingClientRect();
    const next = clampMenuPos(x, y, rect.width, rect.height);
    elRef.current.style.left = `${next.x}px`;
    elRef.current.style.top = `${next.y}px`;
  }, [x, y]);

  return (
    <>
      <div
        className="fixed inset-0 z-[60]"
        onMouseDown={onClose}
        onContextMenu={(event) => {
          event.preventDefault();
          onClose();
        }}
      />
      <div
        ref={elRef}
        className={`fixed z-[61] rounded-panel border border-line bg-surface py-1 text-sm text-ink ${
          wide ? "min-w-[200px]" : "min-w-[180px]"
        }`}
        style={{ left: x, top: y }}
        onMouseDown={(event) => event.stopPropagation()}
      >
        {children}
      </div>
    </>
  );
}

