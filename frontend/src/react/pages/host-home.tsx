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
import { Notice } from "@/react/components/page";
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

type Section = {
  id: string;
  name: string;
  isPinned: boolean;
  hosts: sshconfig.HostConfig[];
};

function isMacPlatform() {
  return /Mac|iPhone|iPad/.test(navigator.platform);
}

function isAdditiveSelect(event: {
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
}) {
  if (event.shiftKey) return false;
  if (isMacPlatform()) return event.metaKey && !event.ctrlKey;
  return event.ctrlKey && !event.metaKey;
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

function isTypingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (target.isContentEditable) return true;
  return !!target.closest("input, textarea, select, [contenteditable='true']");
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
      {kbd ? <span className="text-[11px] text-muted">{kbd}</span> : null}
    </button>
  );
}

function MenuDivider() {
  return <div className="my-1 border-t border-line" />;
}

export function HostHomePage({ onCreateHost, onCreateGroup }: HostHomePageProps = {}) {
  const session = useSession();
  const isMac = isMacPlatform();
  const searchRef = useRef<HTMLInputElement>(null);
  const suppressClick = useRef(false);
  const insertMarkRef = useRef<InsertMark | null>(null);
  const dropTargetRef = useRef<string | null>(null);

  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [selectionSection, setSelectionSection] = useState<string | null>(null);
  const [preferredGroupId, setPreferredGroupId] = useState<string>("");
  const [collapsedIds, setCollapsedIds] = useState<string[]>(() => readCollapsedIds());
  const [insertMark, setInsertMark] = useState<InsertMark | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  const [hostMenu, setHostMenu] = useState<HostMenuState | null>(null);
  const [groupMenu, setGroupMenu] = useState<GroupMenuState | null>(null);
  const [blankMenu, setBlankMenu] = useState<BlankMenuState | null>(null);
  const [moveSubOpen, setMoveSubOpen] = useState(false);

  const [deletingHosts, setDeletingHosts] = useState<string[] | null>(null);
  const [createGroupOpen, setCreateGroupOpen] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
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
  const [toast, setToast] = useState("");
  const [error, setError] = useState("");

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
      return list.filter((section) =>
        section.id === PINNED_SECTION ? section.hosts.length > 0 : true,
      );
    }
    return list
      .map((section) => ({
        ...section,
        hosts: section.hosts.filter((host) =>
          `${host.name} ${host.hostName} ${host.user}`.toLowerCase().includes(keyword),
        ),
      }))
      .filter((section) => section.hosts.length > 0);
  }, [keyword, session]);

  const migrateGroups = useMemo(
    () => [...session.groups].sort((a, b) => a.order - b.order),
    [session.groups],
  );

  function showToast(text: string) {
    setToast(text);
    setError("");
  }

  function showError(text: string) {
    setError(text);
    setToast("");
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
    setNewGroupName("");
    setCreateGroupOpen(true);
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
    const pointerId = event.pointerId;
    const targetEl = event.currentTarget as HTMLElement;
    targetEl.setPointerCapture(pointerId);

    function onMove(moveEvent: PointerEvent) {
      if (moveEvent.pointerId !== pointerId) return;
      if (!active) {
        if (Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) < 6) {
          return;
        }
        active = true;
        suppressClick.current = true;
        setDragging(true);
        document.body.style.userSelect = "none";
        document.body.style.cursor = "grabbing";
      }

      // 同组排序线
      const sortNode = document
        .elementFromPoint(moveEvent.clientX, moveEvent.clientY)
        ?.closest("[data-host-sort]") as HTMLElement | null;
      if (sortNode) {
        const groupId = sortNode.dataset.hostGroup || "";
        const target = sortNode.dataset.hostSort || "";
        if (groupId && target && groupId === sectionId && target !== hostName) {
          // 未分组不支持组内排序
          if (groupId !== UNGROUPED_ID) {
            const rect = sortNode.getBoundingClientRect();
            const after = moveEvent.clientY > rect.top + rect.height / 2;
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
        .elementFromPoint(moveEvent.clientX, moveEvent.clientY)
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

  async function submitCreateGroup() {
    const name = newGroupName.trim();
    if (!name) {
      showError("名称不能为空");
      return;
    }
    if (!GROUP_NAME_RE.test(name)) {
      showError("只允许英文字母、数字和短横线，例如 01-cdcp-main");
      return;
    }
    try {
      await api.upsertGroup({ id: "", name, parentId: "", order: 0, hosts: [] });
      setCreateGroupOpen(false);
      setNewGroupName("");
      await session.refresh();
      showToast("已创建分组");
    } catch (err) {
      showError(`创建失败: ${formatErr(err)}`);
    }
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

  // 快捷键：⌘F 筛选、⌘N 加主机、⌘⇧N 新建分组
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        closeAllMenus();
        return;
      }
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return;

      if (e.shiftKey && e.code === "KeyN") {
        if (isTypingTarget(e.target) && !(e.target instanceof HTMLInputElement && e.target === searchRef.current)) {
          return;
        }
        e.preventDefault();
        requestCreateGroup();
        return;
      }
      if (e.shiftKey) return;

      if (e.code === "KeyF") {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
        return;
      }
      if (e.code === "KeyN") {
        if (isTypingTarget(e.target)) return;
        e.preventDefault();
        requestCreateHost();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onCreateGroup, onCreateHost, preferredGroupId]);

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
      <div className="host-home-toolbar shell-top drag-region glass-chrome grid h-10 shrink-0 grid-cols-[1fr_auto_1fr] items-center border-b border-line px-5">
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
          placeholder={isMac ? "筛选主机 (⌘F)" : "筛选主机 (Ctrl+F)"}
          className="h-8 w-[min(24rem,40vw)] rounded-control border border-line bg-surface px-3"
        />
        <div className="relative justify-self-end">
          <Button
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

      <div className="flex min-h-0 flex-1 flex-col bg-surface">
      {(toast || error) && (
        <div className="px-4 pt-2 md:px-6">
          {error ? <Notice text={error} /> : null}
          {toast && !error ? <Notice text={toast} tone="warn" /> : null}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto px-5 pb-6">
        {keyword && sections.length === 0 ? (
          <p className="mt-3 text-sm text-muted">无匹配主机</p>
        ) : null}
        {!keyword && sections.length === 0 ? (
          <p className="mt-3 text-sm text-muted">暂无主机</p>
        ) : null}

        {sections.map((section) => {
          const collapsed = sectionCollapsed(section.id);
          const isDrop = dropTargetId === section.id;
          return (
            <section
              key={section.id}
              className={`mt-5 first:mt-0 ${isDrop ? "rounded-control outline outline-dashed outline-accent" : ""}`}
              data-drop-group={section.id}
            >
              <div
                data-group-head
                className="flex h-10 w-full items-center gap-1"
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
                  className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-control text-muted hover:bg-raised"
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
                  className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-control px-1 text-left hover:bg-raised"
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
                  <span className="truncate font-semibold text-ink">
                    {section.name}
                  </span>
                  <span className="rounded-full bg-raised px-2 text-xs font-semibold text-muted">
                    {section.hosts.length}
                  </span>
                </button>
              </div>

              {!collapsed && section.hosts.length === 0 && !keyword ? (
                <p className="px-8 text-sm text-muted">没有主机</p>
              ) : null}

              {!collapsed ? (
                <div className="flex flex-col">
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
                        className={`group relative flex h-[60px] cursor-grab items-center gap-[14px] px-[18px] active:cursor-grabbing ${
                          selectedRow
                            ? "bg-accent-soft font-semibold text-accent"
                            : "bg-surface hover:bg-raised"
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
                          <div className="absolute inset-x-[18px] top-0 h-0.5 bg-accent" />
                        ) : null}
                        {mark === "after" ? (
                          <div className="absolute inset-x-[18px] bottom-0 h-0.5 bg-accent" />
                        ) : null}
                        <DistroBadge osRelease={session.osRelease[host.name]} />
                        <div className="min-w-0 flex-1">
                          <div
                            className={`truncate font-semibold ${
                              selectedRow ? "text-accent" : "text-ink"
                            }`}
                          >
                            {host.name}
                          </div>
                          <div className="truncate text-[12px] leading-tight text-muted">
                            ssh, {host.user || "root"}
                          </div>
                        </div>
                        <button
                          type="button"
                          aria-label="编辑主机"
                          className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-control text-muted hover:bg-raised ${
                            selectedRow
                              ? "opacity-100"
                              : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                          }`}
                          onPointerDown={(event) => event.stopPropagation()}
                          onClick={(event) => {
                            event.stopPropagation();
                            session.setEditingHost(host.name);
                          }}
                        >
                          <svg
                            width="16"
                            height="16"
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
        })}

      </div>
      </div>

      {/* 空白 / 新建快捷菜单 */}
      {blankMenu ? (
        <CtxPortal x={blankMenu.x} y={blankMenu.y} onClose={closeAllMenus}>
          <MenuItem
            label="添加主机…"
            kbd={isMac ? "⌘N" : "Ctrl+N"}
            onClick={() => requestCreateHost()}
          />
          <MenuItem
            label="新建分组…"
            kbd={isMac ? "⌘⇧N" : "Ctrl+Shift+N"}
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
            <MenuItem
              label="打开看板"
              onClick={() => {
                const id = groupMenu.id;
                closeAllMenus();
                void api.openBoardWindow(id).catch((err) => {
                  showError(`打开看板失败: ${formatErr(err)}`);
                });
              }}
            />
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
            label="添加主机…"
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
                .openHostsInTerminal(hosts)
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
                  <div className="absolute left-full top-0 z-[62] ml-1 max-h-[280px] min-w-[148px] overflow-y-auto rounded-surface border border-line bg-surface py-1 shadow-lg">
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
        open={createGroupOpen}
        onOpenChange={(open) => !open && setCreateGroupOpen(false)}
      >
        <DialogContent>
          <DialogTitle>新建分组</DialogTitle>
          <input
            className="mt-3 h-9 w-full rounded-control border border-line px-3"
            value={newGroupName}
            placeholder="如 04-new-group"
            onChange={(event) => setNewGroupName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void submitCreateGroup();
            }}
            autoFocus
          />
          <DialogFooter>
            <Button onClick={() => setCreateGroupOpen(false)}>取消</Button>
            <Button variant="primary" onClick={() => void submitCreateGroup()}>
              创建
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
            className="mt-1 h-9 w-full rounded-control border border-line px-3"
            value={groupSettings?.name || ""}
            onChange={(event) =>
              setGroupSettings((prev) =>
                prev ? { ...prev, name: event.target.value } : prev,
              )
            }
          />
          <label className="mt-3 block text-sm text-muted">看板标题</label>
          <input
            className="mt-1 h-9 w-full rounded-control border border-line px-3"
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
        className={`fixed z-[61] rounded-surface border border-line bg-surface py-1 text-sm text-ink shadow-lg ${
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

