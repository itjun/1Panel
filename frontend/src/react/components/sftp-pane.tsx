import { useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import type { monitor } from "@/api";
import { cn } from "@/react/lib/utils";
import { formatBytes } from "@/utils/format";
import { isTextFileName } from "@/utils/textFile";

const DRAG_TYPE = "application/x-1pannel-sftp";

export type SftpDeleteItem = {
  path: string;
  name: string;
  isDir: boolean;
};

type SortKey = "name" | "time" | "size" | "kind";
type MenuAction = "open" | "send" | "remove" | "refresh" | "hidden" | "all" | "mkdir" | "mkfile";

type Props = {
  side: "local" | "remote";
  title: string;
  cwd: string;
  rootPath: string;
  homePath: string;
  entries: monitor.FileEntry[];
  loading: boolean;
  error: string;
  canBack: boolean;
  canForward: boolean;
  acceptDrop: boolean;
  locked: boolean;
  canRemove: boolean;
  canCreate: boolean;
  dropHint: string;
  onNavigate: (path: string) => void;
  onBack: () => void;
  onForward: () => void;
  onRefresh: () => void;
  onSend: (paths: string[]) => void;
  onReceive: (dir: string) => void;
  onDragBegin: (paths: string[]) => void;
  onDragEnd: () => void;
  onRemove?: (items: SftpDeleteItem[]) => void;
  onCreate?: (kind: "dir" | "file") => void;
  onHoverTarget?: (dir: string) => void;
  onOpenFile?: (entry: monitor.FileEntry) => void;
};

export function SftpPane(props: Props) {
  const [filter, setFilter] = useState("");
  const [showHidden, setShowHidden] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [anchor, setAnchor] = useState(-1);
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortAsc, setSortAsc] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [hot, setHot] = useState(false);
  const [hoverDir, setHoverDir] = useState("");
  const [dragging, setDragging] = useState<string[]>([]);
  const [ctx, setCtx] = useState<{ x: number; y: number } | null>(null);
  const pathInput = useRef<HTMLInputElement>(null);
  const rowsEl = useRef<HTMLDivElement>(null);
  const ctxEl = useRef<HTMLDivElement>(null);
  const skipBlur = useRef(false);

  const segments = useMemo(() => pathSegments(props.side, props.cwd, props.rootPath), [props.side, props.cwd, props.rootPath]);

  const shown = useMemo(() => {
    const keyword = filter.trim().toLowerCase();
    const list = props.entries.filter((entry) => {
      if (!showHidden && entry.name.startsWith(".")) return false;
      if (keyword && !entry.name.toLowerCase().includes(keyword)) return false;
      return true;
    });
    const dir = sortAsc ? 1 : -1;
    return list.slice().sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      if (sortKey === "size") return (a.size - b.size) * dir;
      if (sortKey === "time") return a.modTime.localeCompare(b.modTime) * dir;
      if (sortKey === "kind") return kindOf(a).localeCompare(kindOf(b)) * dir;
      return a.name.localeCompare(b.name, "zh") * dir;
    });
  }, [filter, props.entries, showHidden, sortAsc, sortKey]);

  const oneSelected = selected.length === 1 ? props.entries.find((entry) => entry.path === selected[0]) : undefined;
  const canPreviewFile = !!oneSelected && !oneSelected.isDir && isTextFileName(oneSelected.name);
  const canOpen = !!oneSelected?.isDir || canPreviewFile;

  useEffect(() => {
    setSelected([]);
    setAnchor(-1);
    setFilter("");
    setEditing(false);
  }, [props.cwd]);

  useEffect(() => {
    const have = new Set(props.entries.map((entry) => entry.path));
    setSelected((current) => current.filter((path) => have.has(path)));
  }, [props.entries]);

  useEffect(() => {
    if (showHidden) return;
    const hidden = new Set(props.entries.filter((entry) => entry.name.startsWith(".")).map((entry) => entry.path));
    setSelected((current) => current.filter((path) => !hidden.has(path)));
  }, [showHidden, props.entries]);

  useEffect(() => {
    if (!ctx || !ctxEl.current) return;
    const rect = ctxEl.current.getBoundingClientRect();
    const margin = 4;
    let x = ctx.x;
    let y = ctx.y;
    if (y + rect.height > window.innerHeight - margin) {
      y = Math.max(margin, y - rect.height);
    }
    if (x + rect.width > window.innerWidth - margin) {
      x = Math.max(margin, window.innerWidth - rect.width - margin);
    }
    ctxEl.current.style.left = `${x}px`;
    ctxEl.current.style.top = `${y}px`;
  }, [ctx]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortAsc((value) => !value);
      return;
    }
    setSortKey(key);
    setSortAsc(true);
  }

  function onRowClick(entry: monitor.FileEntry, index: number, event: MouseEvent) {
    if (event.shiftKey && anchor >= 0) {
      const start = Math.min(anchor, index);
      const end = Math.max(anchor, index);
      setSelected(shown.slice(start, end + 1).map((item) => item.path));
      return;
    }
    if (event.metaKey || event.ctrlKey) {
      if (selected.includes(entry.path)) {
        setSelected(selected.filter((path) => path !== entry.path));
      } else {
        setSelected([...selected, entry.path]);
      }
      setAnchor(index);
      return;
    }
    setSelected([entry.path]);
    setAnchor(index);
  }

  function selectedItems(): SftpDeleteItem[] {
    const byPath = new Map(props.entries.map((entry) => [entry.path, entry]));
    const items: SftpDeleteItem[] = [];
    for (const path of selected) {
      const entry = byPath.get(path);
      if (!entry) continue;
      items.push({ path: entry.path, name: entry.name, isDir: entry.isDir });
    }
    return items;
  }

  function runMenu(action: MenuAction) {
    setMenuOpen(false);
    setCtx(null);
    if (action === "mkdir") props.onCreate?.("dir");
    if (action === "mkfile") props.onCreate?.("file");
    if (action === "open" && oneSelected?.isDir) props.onNavigate(oneSelected.path);
    if (action === "open" && oneSelected && !oneSelected.isDir && isTextFileName(oneSelected.name)) {
      props.onOpenFile?.(oneSelected);
    }
    if (action === "send" && selected.length) props.onSend(selected.slice());
    if (action === "remove") {
      const items = selectedItems();
      if (items.length) props.onRemove?.(items);
    }
    if (action === "refresh") props.onRefresh();
    if (action === "hidden") setShowHidden((value) => !value);
    if (action === "all") {
      setSelected(shown.map((entry) => entry.path));
      setAnchor(shown.length ? 0 : -1);
    }
  }

  function go(path: string) {
    if (!path || path === props.cwd) return;
    props.onNavigate(path);
  }

  function startEdit() {
    if (editing) return;
    setDraft(props.cwd || props.rootPath || "/");
    setEditing(true);
    skipBlur.current = true;
    window.setTimeout(() => {
      pathInput.current?.focus();
      pathInput.current?.select();
      window.setTimeout(() => {
        skipBlur.current = false;
      }, 80);
    }, 0);
  }

  function commitPath() {
    if (skipBlur.current || !editing) return;
    setEditing(false);
    const next = draft.trim();
    if (!next || next === props.cwd) return;
    props.onNavigate(next);
  }

  function moveSel(delta: number) {
    if (!shown.length) return;
    let index = shown.findIndex((entry) => entry.path === selected[selected.length - 1]);
    if (index < 0) index = delta > 0 ? -1 : 0;
    index = Math.min(shown.length - 1, Math.max(0, index + delta));
    const entry = shown[index];
    if (!entry) return;
    setSelected([entry.path]);
    setAnchor(index);
    const el = rowsEl.current?.querySelector(`[data-path="${CSS.escape(entry.path)}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }

  function onKey(event: KeyboardEvent<HTMLElement>) {
    if (props.locked) return;
    const tag = (event.target as HTMLElement).tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") return;
    if (event.key === "Backspace" || event.key === "Delete") {
      event.preventDefault();
      if (props.canRemove && selected.length) {
        const items = selectedItems();
        if (items.length) props.onRemove?.(items);
      } else if (event.key === "Backspace") {
        props.onBack();
      }
      return;
    }
    if (event.key === "Enter" && oneSelected?.isDir) {
      props.onNavigate(oneSelected.path);
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      moveSel(event.key === "ArrowDown" ? 1 : -1);
    }
  }

  function openCtx(event: MouseEvent) {
    setCtx({ x: event.clientX, y: event.clientY });
  }

  function canAccept(event: DragEvent) {
    const types = Array.from(event.dataTransfer?.types || []);
    const ours = types.includes(DRAG_TYPE);
    if (props.acceptDrop && ours) return true;
    if (props.side === "remote" && types.includes("Files") && !ours) return true;
    return false;
  }

  function updateHover(dir: string) {
    setHoverDir(dir);
    props.onHoverTarget?.(dir);
  }

  const hint = hoverDir
    ? `放到「${hoverDir.split("/").filter(Boolean).pop() || hoverDir}」`
    : props.dropHint;

  let emptyText = "这个目录是空的";
  if (filter.trim()) emptyText = "没有匹配的文件";
  else if (!showHidden && props.entries.some((entry) => entry.name.startsWith("."))) {
    emptyText = "隐藏文件已收起，可在「操作」里打开";
  }

  // 通栏被主机功能标签占用，标题条（本机 / 主机名、筛选、操作）留在各自栏顶部
  const titleBar = (
    <header className="flex h-10 min-w-0 shrink-0 items-center gap-2 px-3">
      <span className="flex min-w-0 flex-1 items-center gap-2 font-semibold text-ink">
        {props.side === "local" ? <LocalIcon /> : null}
        <span className="truncate">{props.title}</span>
      </span>
      <label className="motion-field flex h-8 w-[132px] items-center gap-1 rounded-control px-2 text-muted">
        <SearchIcon />
        <input
          value={filter}
          placeholder="筛选"
          className="w-full bg-transparent text-sm text-ink outline-none"
          onChange={(event) => setFilter(event.target.value)}
          onKeyDown={(event) => event.stopPropagation()}
        />
      </label>
      <div className="relative">
        <button
          type="button"
          className="flex h-8 items-center gap-1 rounded-control px-2 text-sm hover:bg-line"
          onClick={(event) => {
            event.stopPropagation();
            setMenuOpen((value) => !value);
          }}
        >
          操作
          <CaretIcon />
        </button>
        {menuOpen ? (
          <>
            <div className="fixed inset-0 z-40" onMouseDown={() => setMenuOpen(false)} />
            <div className="absolute right-0 top-[calc(100%+4px)] z-[41] min-w-[176px] rounded-panel border border-line bg-surface p-1" onMouseDown={(event) => event.stopPropagation()}>
              <MenuActions
                canCreate={props.canCreate}
                canRemove={props.canRemove}
                canOpen={canOpen}
                selectedCount={selected.length}
                shownCount={shown.length}
                showHidden={showHidden}
                onRun={runMenu}
              />
            </div>
          </>
        ) : null}
      </div>
    </header>
  );

  return (
    <section className="flex h-full min-h-0 min-w-0 flex-col outline-none" tabIndex={0} onKeyDown={onKey}>
      {titleBar}

      <div className="flex shrink-0 items-center gap-0.5 border-b border-line px-2 pb-2 pt-0.5">
        <IconButton label="后退" disabled={!props.canBack} onClick={props.onBack}>
          <path d="M14 6l-6 6 6 6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </IconButton>
        <IconButton label="前进" disabled={!props.canForward} onClick={props.onForward}>
          <path d="M10 6l6 6-6 6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </IconButton>
        <IconButton label="用户根目录" disabled={!props.homePath} onClick={() => go(props.homePath)}>
          <path d="M4 11.2 12 4.5l8 6.7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M6 10.5V19a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-8.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </IconButton>
        <div
          className={cn(
            "motion-field motion-field-quiet flex min-h-7 min-w-0 flex-1 items-center rounded-control px-1.5",
            editing ? "motion-field-active" : "cursor-text",
          )}
          onMouseDown={editing ? undefined : startEdit}
        >
          {editing ? (
            <input
              ref={pathInput}
              value={draft}
              spellCheck={false}
              className="w-full bg-transparent px-0.5 py-1 text-sm outline-none"
              onClick={(event) => event.stopPropagation()}
              onMouseDown={(event) => event.stopPropagation()}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  commitPath();
                }
                if (event.key === "Escape") {
                  event.preventDefault();
                  skipBlur.current = true;
                  setEditing(false);
                }
              }}
              onBlur={commitPath}
            />
          ) : (
            <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-auto">
              <button type="button" className="inline-flex shrink-0 items-center gap-1 rounded-control px-1.5 py-1 text-sm text-ink hover:bg-raised hover:text-accent" onMouseDown={(event) => { event.stopPropagation(); event.preventDefault(); go(props.rootPath); }}>
                <FolderIcon />
                根目录
              </button>
              {segments.map((seg, index) => (
                <span key={seg.path} className="flex shrink-0 items-center gap-0.5">
                  <span className="text-muted">›</span>
                  <button
                    type="button"
                    className={cn(
                      "inline-flex max-w-[200px] items-center gap-1 truncate rounded-control px-1.5 py-1 text-sm text-ink hover:bg-raised hover:text-accent",
                      index === segments.length - 1 && "font-semibold",
                    )}
                    onMouseDown={(event) => {
                      event.stopPropagation();
                      event.preventDefault();
                      if (index === segments.length - 1) startEdit();
                      else go(seg.path);
                    }}
                  >
                    <FolderIcon />
                    {seg.name}
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col bg-surface">
      {props.error ? <p className="mx-3 mt-1.5 text-xs text-danger">{props.error}</p> : null}

      <div
        className="relative flex min-h-0 flex-1 flex-col"
        {...(props.side === "remote" ? { "data-file-drop-target": "" } : {})}
        onDragEnter={(event) => {
          if (!canAccept(event)) return;
          setHot(true);
        }}
        onDragOver={(event) => {
          if (!canAccept(event)) return;
          event.preventDefault();
          if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
          setHot(true);
          const el = event.target instanceof Element ? event.target : null;
          if (!el?.closest("[data-row]")) updateHover("");
        }}
        onDragLeave={(event) => {
          const rel = event.relatedTarget as Node | null;
          if (rel && event.currentTarget.contains(rel)) return;
          setHot(false);
          updateHover("");
        }}
        onDrop={(event) => {
          if (!canAccept(event)) return;
          event.preventDefault();
          setHot(false);
          const types = Array.from(event.dataTransfer?.types || []);
          const external = types.includes("Files") && !types.includes(DRAG_TYPE);
          updateHover("");
          if (external) return;
          const target = props.cwd;
          if (!target) return;
          props.onReceive(target);
        }}
      >
        {props.loading ? <div className="absolute inset-x-0 top-0 z-[3] h-0.5 animate-pulse bg-accent" /> : null}
        <div className="grid h-table-head shrink-0 grid-cols-[minmax(120px,240px)_minmax(108px,148px)_64px_56px_minmax(0,1fr)] items-center gap-2 border-b border-line px-3 text-xs text-muted">
          <SortButton label="名称" active={sortKey === "name"} asc={sortAsc} onClick={() => toggleSort("name")} />
          <SortButton label="修改时间" active={sortKey === "time"} asc={sortAsc} onClick={() => toggleSort("time")} />
          <SortButton label="大小" active={sortKey === "size"} asc={sortAsc} align="right" onClick={() => toggleSort("size")} />
          <SortButton label="类型" active={sortKey === "kind"} asc={sortAsc} onClick={() => toggleSort("kind")} />
          <span />
        </div>
        <div
          ref={rowsEl}
          className="min-h-0 flex-1 overflow-auto"
          onClick={() => {
            setSelected([]);
            setAnchor(-1);
          }}
          onContextMenu={(event) => {
            event.preventDefault();
            openCtx(event);
          }}
        >
          {!props.loading && shown.length === 0 ? <p className="px-4 py-7 text-sm text-muted">{emptyText}</p> : null}
          {shown.map((entry, index) => (
            <div
              key={entry.path}
              data-row=""
              data-path={entry.path}
              draggable={!props.locked}
              className={cn(
                "grid h-table-row cursor-grab grid-cols-[minmax(120px,240px)_minmax(108px,148px)_64px_56px_minmax(0,1fr)] items-center gap-2 border-b border-line px-3 text-sm",
                selected.includes(entry.path)
                  ? "bg-accent-soft font-semibold text-accent"
                  : "hover:bg-raised",
                hoverDir === entry.path &&
                  !selected.includes(entry.path) &&
                  "bg-accent-soft outline-1 -outline-offset-1 outline-accent",
                dragging.includes(entry.path) && "opacity-45",
              )}
              onClick={(event) => {
                event.stopPropagation();
                onRowClick(entry, index, event);
              }}
              onDoubleClick={() => {
                if (props.locked) return;
                if (entry.isDir) {
                  props.onNavigate(entry.path);
                  return;
                }
                if (isTextFileName(entry.name)) {
                  props.onOpenFile?.(entry);
                  return;
                }
                setSelected([entry.path]);
              }}
              onContextMenu={(event) => {
                event.preventDefault();
                event.stopPropagation();
                if (!selected.includes(entry.path)) {
                  setSelected([entry.path]);
                  setAnchor(index);
                }
                openCtx(event);
              }}
              onDragStart={(event) => {
                if (props.locked) {
                  event.preventDefault();
                  return;
                }
                let paths = selected.slice();
                if (!paths.includes(entry.path)) {
                  paths = [entry.path];
                  setSelected(paths);
                }
                setDragging(paths);
                event.dataTransfer.effectAllowed = "copy";
                event.dataTransfer.setData(DRAG_TYPE, props.side);
                event.dataTransfer.setData("text/plain", paths.join("\n"));
                props.onDragBegin(paths);
              }}
              onDragEnd={() => {
                setDragging([]);
                setHot(false);
                updateHover("");
                props.onDragEnd();
              }}
              onDragOver={(event) => {
                if (!canAccept(event)) return;
                event.preventDefault();
                event.stopPropagation();
                setHot(true);
                if (entry.isDir) updateHover(entry.path);
                else updateHover("");
              }}
              onDrop={(event) => {
                if (!canAccept(event)) return;
                event.preventDefault();
                event.stopPropagation();
                setHot(false);
                const types = Array.from(event.dataTransfer?.types || []);
                const external = types.includes("Files") && !types.includes(DRAG_TYPE);
                const target = entry.isDir ? entry.path : props.cwd;
                updateHover("");
                if (external || !target) return;
                props.onReceive(target);
              }}
            >
              <div className="flex min-w-0 items-center gap-2">
                {entry.isDir ? <FolderIcon /> : <FileIcon />}
                <div className="min-w-0">
                  <div className={cn("truncate", entry.name.startsWith(".") && !selected.includes(entry.path) && "text-muted")}>{entry.name}</div>
                  {entry.mode ? (
                    <div className="truncate font-mono text-xs leading-none text-muted">{entry.mode}</div>
                  ) : null}
                </div>
              </div>
              <span className="truncate text-xs text-muted">{entry.modTime || "—"}</span>
              <span className="text-right text-xs tabular-nums text-muted">{entry.isDir ? "—" : formatBytes(entry.size)}</span>
              <span className="truncate text-xs text-muted">{kindOf(entry)}</span>
              <span />
            </div>
          ))}
        </div>
        <div className={cn("pointer-events-none absolute inset-2.5 z-[4] grid place-items-center rounded-surface border border-accent bg-accent-soft", hot ? "visible opacity-100" : "invisible opacity-0")}>
          <div className="text-center text-ink">
            <p className="text-base font-semibold">{hint}</p>
          </div>
        </div>
      </div>
      </div>

      {ctx ? (
        <>
          <div
            className="fixed inset-0 z-40"
            onMouseDown={() => setCtx(null)}
            onContextMenu={(event) => {
              event.preventDefault();
              setCtx(null);
            }}
          />
          <div
            ref={ctxEl}
            className="fixed z-[41] min-w-[176px] rounded-panel border border-line bg-surface p-1"
            style={{ left: ctx.x, top: ctx.y }}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <MenuActions
              canCreate={props.canCreate}
              canRemove={props.canRemove}
              canOpen={canOpen}
              selectedCount={selected.length}
              shownCount={shown.length}
              showHidden={showHidden}
              onRun={runMenu}
            />
          </div>
        </>
      ) : null}
    </section>
  );
}

function MenuActions({
  canCreate,
  canRemove,
  canOpen,
  selectedCount,
  shownCount,
  showHidden,
  onRun,
}: {
  canCreate: boolean;
  canRemove: boolean;
  canOpen: boolean;
  selectedCount: number;
  shownCount: number;
  showHidden: boolean;
  onRun: (action: MenuAction) => void;
}) {
  return (
    <>
      {canCreate ? (
        <>
          <MenuButton label="创建目录" onClick={() => onRun("mkdir")} />
          <MenuButton label="创建文件" onClick={() => onRun("mkfile")} />
          <div className="mx-1.5 my-1 h-px bg-line" />
        </>
      ) : null}
      <MenuButton label="打开" disabled={!canOpen} onClick={() => onRun("open")} />
      <MenuButton label="传到对面" disabled={!selectedCount} onClick={() => onRun("send")} />
      {canRemove ? <MenuButton label="删除" danger disabled={!selectedCount} onClick={() => onRun("remove")} /> : null}
      <div className="mx-1.5 my-1 h-px bg-line" />
      <MenuButton label="刷新" onClick={() => onRun("refresh")} />
      <MenuButton label={showHidden ? "不显示隐藏文件" : "显示隐藏文件"} onClick={() => onRun("hidden")} />
      <MenuButton label="全选" disabled={!shownCount} onClick={() => onRun("all")} />
    </>
  );
}

function MenuButton({
  label,
  disabled,
  danger,
  onClick,
}: {
  label: string;
  disabled?: boolean;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      className={cn(
        "flex w-full rounded-control px-2.5 py-1.5 text-left text-sm",
        danger ? "text-danger" : "text-ink",
        disabled ? "cursor-default opacity-35" : "hover:bg-raised",
      )}
      onClick={onClick}
    >
      {label}
    </button>
  );
}

function SortButton({
  label,
  active,
  asc,
  align,
  onClick,
}: {
  label: string;
  active: boolean;
  asc: boolean;
  align?: "right";
  onClick: () => void;
}) {
  return (
    <button type="button" className={cn("truncate text-left text-xs text-muted", align === "right" && "text-right")} onClick={onClick}>
      {label}
      {active ? (asc ? " ↑" : " ↓") : ""}
    </button>
  );
}

function IconButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      data-tip={label}
      aria-label={label}
      disabled={disabled}
      className="grid h-8 w-8 shrink-0 place-items-center rounded-control text-ink hover:bg-raised disabled:cursor-default disabled:opacity-30"
      onClick={onClick}
    >
      <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
        {children}
      </svg>
    </button>
  );
}

function FolderIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 shrink-0" aria-hidden="true">
      <path fill="#4C8DFF" d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z" />
    </svg>
  );
}

function FileIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0" aria-hidden="true">
      <path fill="#F7F8FA" stroke="#C5CDD6" strokeWidth="1.2" d="M14 2.6H6.2A1.8 1.8 0 0 0 4.4 4.4v15.2a1.8 1.8 0 0 0 1.8 1.8h11.6a1.8 1.8 0 0 0 1.8-1.8V8.2L14 2.6z" />
      <path fill="#E4E9EE" d="M14 2.6v5.6h5.6" />
    </svg>
  );
}

function LocalIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-[18px] w-[18px] shrink-0 text-ink" aria-hidden="true">
      <rect x="3" y="4" width="18" height="12" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M8 20h8M12 16v4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 shrink-0" aria-hidden="true">
      <circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M16 16l4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function CaretIcon() {
  return (
    <svg viewBox="0 0 12 12" className="h-3 w-3" aria-hidden="true">
      <path d="M2 4l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function pathSegments(side: "local" | "remote", cwd: string, rootPath: string) {
  const raw = cwd || rootPath || "/";
  const parts = raw.split("/").filter(Boolean);
  const out: { name: string; path: string }[] = [];
  if (side === "local" && /^[A-Za-z]:/.test(parts[0] || "")) {
    let acc = parts[0] || "";
    out.push({ name: acc, path: `${acc}/` });
    for (let i = 1; i < parts.length; i++) {
      acc += `/${parts[i]}`;
      out.push({ name: parts[i] || "", path: acc });
    }
    return out;
  }
  let acc = "";
  for (const part of parts) {
    acc += `/${part}`;
    out.push({ name: part, path: acc });
  }
  return out;
}

function kindOf(entry: monitor.FileEntry) {
  if (entry.isDir) return "文件夹";
  const index = entry.name.lastIndexOf(".");
  if (index <= 0 || index === entry.name.length - 1) return "文件";
  return entry.name.slice(index + 1).toLowerCase();
}
