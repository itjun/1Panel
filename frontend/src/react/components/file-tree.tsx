import { useCallback, useEffect, useState } from "react";
import { api } from "@/api";
import { formatErr } from "@/utils/format";

export type FileTreeEntry = {
  name: string;
  path: string;
  isDir: boolean;
  size?: number;
};

type Props = {
  host: string;
  rootPath: string;
  selectedPath?: string;
  refreshKey?: number;
  onSelect: (entry: FileTreeEntry) => void;
  listDir?: (host: string, dir: string) => Promise<unknown[]>;
};

function normalizeEntries(raw: unknown[]): FileTreeEntry[] {
  return raw
    .map((item) => {
      const row = item as {
        name?: string;
        path?: string;
        isDir?: boolean;
        size?: number;
      };
      const path = row.path || row.name || "";
      return {
        name: row.name || path.split("/").pop() || path,
        path,
        isDir: !!row.isDir,
        size: row.size,
      };
    })
    .sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
    });
}

function TreeNodeRow({
  entry,
  depth,
  selectedPath,
  expanded,
  childrenCache,
  loadingDirs,
  onToggle,
  onSelect,
}: {
  entry: FileTreeEntry;
  depth: number;
  selectedPath?: string;
  expanded: Set<string>;
  childrenCache: Map<string, FileTreeEntry[]>;
  loadingDirs: Set<string>;
  onToggle: (path: string) => void;
  onSelect: (entry: FileTreeEntry) => void;
}) {
  const isOpen = expanded.has(entry.path);
  const kids = childrenCache.get(entry.path) || [];
  const loading = loadingDirs.has(entry.path);
  const selected = selectedPath === entry.path;

  return (
    <div>
      <button
        type="button"
        className={
          selected
            ? "flex w-full items-center gap-1 bg-accent/10 px-2 py-1.5 text-left text-sm font-semibold text-accent"
            : "flex w-full items-center gap-1 px-2 py-1.5 text-left text-sm hover:bg-ink/5"
        }
        style={{
          paddingLeft: 8 + depth * 14,
        }}
        onClick={() => onSelect(entry)}
      >
        {entry.isDir ? (
          <span
            className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-xs text-muted hover:bg-ink/10"
            onClick={(event) => {
              event.stopPropagation();
              onToggle(entry.path);
            }}
          >
            {loading ? "…" : isOpen ? "▾" : "▸"}
          </span>
        ) : (
          <span className="inline-block h-5 w-5 shrink-0" />
        )}
        <span className="min-w-0 truncate font-mono text-[13px]">
          {entry.isDir ? `${entry.name}/` : entry.name}
        </span>
      </button>
      {entry.isDir && isOpen
        ? kids.map((child) => (
            <TreeNodeRow
              key={child.path}
              entry={child}
              depth={depth + 1}
              selectedPath={selectedPath}
              expanded={expanded}
              childrenCache={childrenCache}
              loadingDirs={loadingDirs}
              onToggle={onToggle}
              onSelect={onSelect}
            />
          ))
        : null}
    </div>
  );
}

export function FileTree({
  host,
  rootPath,
  selectedPath,
  refreshKey = 0,
  onSelect,
  listDir = (h, dir) => api.listDir(h, dir),
}: Props) {
  const [roots, setRoots] = useState<FileTreeEntry[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [childrenCache, setChildrenCache] = useState<Map<string, FileTreeEntry[]>>(
    () => new Map(),
  );
  const [loadingDirs, setLoadingDirs] = useState<Set<string>>(() => new Set());
  const [error, setError] = useState("");

  const loadDir = useCallback(
    async (dir: string, asRoot: boolean) => {
      setLoadingDirs((prev) => new Set(prev).add(dir));
      setError("");
      try {
        const entries = normalizeEntries(await listDir(host, dir));
        if (asRoot) {
          setRoots(entries);
        } else {
          setChildrenCache((prev) => {
            const next = new Map(prev);
            next.set(dir, entries);
            return next;
          });
        }
      } catch (err) {
        setError(formatErr(err));
        if (asRoot) setRoots([]);
      } finally {
        setLoadingDirs((prev) => {
          const next = new Set(prev);
          next.delete(dir);
          return next;
        });
      }
    },
    [host, listDir],
  );

  useEffect(() => {
    setExpanded(new Set());
    setChildrenCache(new Map());
    void loadDir(rootPath || "/", true);
  }, [host, rootPath, refreshKey, loadDir]);

  const onToggle = (path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
        return next;
      }
      next.add(path);
      return next;
    });
    if (!childrenCache.has(path)) {
      void loadDir(path, false);
    }
  };

  return (
    <div className="min-h-0 flex-1 overflow-auto">
      {error ? <p className="px-2 py-1 text-xs text-danger">{error}</p> : null}
      {loadingDirs.has(rootPath || "/") && roots.length === 0 ? (
        <p className="px-3 py-2 text-sm text-muted">加载中…</p>
      ) : null}
      {roots.map((entry) => (
        <TreeNodeRow
          key={entry.path}
          entry={entry}
          depth={0}
          selectedPath={selectedPath}
          expanded={expanded}
          childrenCache={childrenCache}
          loadingDirs={loadingDirs}
          onToggle={onToggle}
          onSelect={onSelect}
        />
      ))}
      {!loadingDirs.has(rootPath || "/") && roots.length === 0 && !error ? (
        <p className="px-3 py-2 text-sm text-muted">目录为空</p>
      ) : null}
    </div>
  );
}
