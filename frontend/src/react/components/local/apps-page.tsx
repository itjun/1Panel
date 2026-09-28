import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { api, type localapps } from "@/api";
import {
  LocalAppContextMenu,
  type LocalAppMenuTarget,
} from "@/react/components/local-app-context-menu";
import { Button } from "@/react/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@/react/components/ui/dialog";
import { Notice, Page } from "@/react/components/page";
import {
  formatBytes,
  formatDurationLong,
  formatErr,
} from "@/utils/format";
import { LOCAL_LANG_OPTIONS, localLangLabel } from "@/utils/localLang";
import "./local.css";

type KillTarget = { pid: number; name?: string; cmd?: string };
type SortKey =
  | "name"
  | "type"
  | "processes"
  | "port"
  | "cpu"
  | "memory"
  | "disk"
  | "network";
type SortDirection = "asc" | "desc";

const DEFAULT_SORT_DIRECTIONS: Record<SortKey, SortDirection> = {
  name: "asc",
  type: "asc",
  processes: "desc",
  port: "asc",
  cpu: "desc",
  memory: "desc",
  disk: "desc",
  network: "desc",
};

type TreeRow = {
  id: string;
  kind: "app" | "proc";
  seq?: number;
  name: string;
  typeLabel: string;
  pidLabel: string;
  processCount: number;
  ports: number[];
  cpu: number;
  rss: number;
  diskReadRate: number;
  diskWriteRate: number;
  netInRate: number;
  netOutRate: number;
  rateKnown: boolean;
  elapsed: number | null;
  cmd: string;
  children?: TreeRow[];
  appKey?: string;
  runtime?: string;
  appKind?: string;
  confidence?: string;
  evidence?: string[];
  proc?: localapps.ProcNode;
  killTargets: KillTarget[];
};

function compareAppRows(
  a: TreeRow,
  b: TreeRow,
  key: SortKey,
  direction: SortDirection,
): number {
  const compareName = a.name.localeCompare(b.name, "zh-CN", {
    numeric: true,
    sensitivity: "base",
  });
  const compareId = a.id.localeCompare(b.id);
  const tieBreak = compareName || compareId;
  const multiplier = direction === "desc" ? -1 : 1;
  let delta = 0;

  if (key === "name") return compareName * multiplier || compareId;
  if (key === "type") {
    delta = a.typeLabel.localeCompare(b.typeLabel, "zh-CN", {
      numeric: true,
      sensitivity: "base",
    });
  } else if (key === "cpu") {
    delta = a.cpu - b.cpu;
  } else if (key === "memory") {
    delta = a.rss - b.rss;
  } else if (key === "processes") {
    delta = a.processCount - b.processCount;
  } else if (key === "disk") {
    if (!a.rateKnown || !b.rateKnown) {
      if (a.rateKnown !== b.rateKnown) return a.rateKnown ? -1 : 1;
      return tieBreak;
    }
    delta = a.diskReadRate + a.diskWriteRate - b.diskReadRate - b.diskWriteRate;
  } else if (key === "network") {
    if (!a.rateKnown || !b.rateKnown) {
      if (a.rateKnown !== b.rateKnown) return a.rateKnown ? -1 : 1;
      return tieBreak;
    }
    delta = a.netInRate + a.netOutRate - b.netInRate - b.netOutRate;
  } else {
    const aPort = a.ports[0];
    const bPort = b.ports[0];
    if (aPort === undefined) return bPort === undefined ? tieBreak : 1;
    if (bPort === undefined) return -1;
    delta = aPort - bPort;
  }
  return delta * multiplier || tieBreak;
}

function SortableHeader({
  label,
  sortKey,
  activeKey,
  direction,
  onSort,
  className,
  align = "left",
}: {
  label: string;
  sortKey: SortKey;
  activeKey: SortKey;
  direction: SortDirection;
  onSort: (key: SortKey) => void;
  className: string;
  align?: "left" | "right";
}) {
  const active = sortKey === activeKey;
  const arrow = active ? (direction === "asc" ? "↑" : "↓") : "↕";
  return (
    <th
      aria-sort={active ? (direction === "asc" ? "ascending" : "descending") : "none"}
      className={className}
    >
      <button
        type="button"
        className={`flex w-full items-center gap-1 rounded-sm text-left hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${align === "right" ? "justify-end text-right" : "justify-start"} ${active ? "text-accent" : "text-ink"}`}
        onClick={() => onSort(sortKey)}
        title={`${label}：点击排序，再次点击切换升降序`}
      >
        <span>{label}</span>
        <span aria-hidden="true" className="text-xs text-muted">
          {arrow}
        </span>
      </button>
    </th>
  );
}

function baseName(path: string | undefined) {
  if (!path) return "";
  const i = path.lastIndexOf("/");
  return i >= 0 ? path.slice(i + 1) : path;
}

function isSelfProc(p: localapps.ProcNode) {
  return p.extra?.self === "1";
}

function formatRate(bps: number) {
  return `${formatBytes(bps || 0)}/s`;
}

function formatIoPair(row: TreeRow, kind: "disk" | "net") {
  if (!row.rateKnown) return "—";
  const a = kind === "disk" ? row.diskReadRate || 0 : row.netInRate || 0;
  const b = kind === "disk" ? row.diskWriteRate || 0 : row.netOutRate || 0;
  if (a <= 0 && b <= 0) return "—";
  return (
    <span className="tabular-nums">
      <span className={a > 0 ? "text-io-read" : undefined}>
        {a > 0 ? formatRate(a) : "—"}
      </span>
      {" / "}
      <span className={b > 0 ? "text-io-write" : undefined}>
        {b > 0 ? formatRate(b) : "—"}
      </span>
    </span>
  );
}

function procToRow(p: localapps.ProcNode, runtime: string, appKey: string): TreeRow {
  return {
    id: `proc:${p.pid}`,
    kind: "proc",
    name: baseName(p.exe) || `pid-${p.pid}`,
    typeLabel: "进程",
    pidLabel: String(p.pid),
    processCount: 1,
    ports: p.ports || [],
    cpu: p.cpu || 0,
    rss: p.rss || 0,
    diskReadRate: p.diskReadRate || 0,
    diskWriteRate: p.diskWriteRate || 0,
    netInRate: p.netInRate || 0,
    netOutRate: p.netOutRate || 0,
    rateKnown: !!p.rateKnown,
    elapsed: p.elapsed != null ? Number(p.elapsed) : null,
    cmd: p.cmd || (p.args || []).join(" ") || "",
    appKey,
    runtime,
    appKind: p.kind,
    confidence: p.confidence,
    evidence: p.evidence || [],
    proc: p,
    killTargets:
      p.pid && !isSelfProc(p)
        ? [
            {
              pid: p.pid,
              name: baseName(p.exe) || `pid-${p.pid}`,
              cmd: p.cmd || "",
            },
          ]
        : [],
  };
}

function appToRow(a: localapps.AppNode): TreeRow {
  const procs = a.procs || [];
  const children = procs.map((p) => procToRow(p, a.runtime, a.key));
  const killTargets: KillTarget[] = [];
  for (const c of children) {
    killTargets.push(...c.killTargets);
  }
  const portSet = new Set<number>();
  for (const c of children) {
    for (const port of c.ports) {
      if (port > 0) portSet.add(port);
    }
  }
  const procCount = a.procCount || procs.length;
  return {
    id: `app:${a.key}`,
    kind: "app",
    name: a.name || a.key,
    typeLabel: a.kind === "service" ? "服务候选" : localLangLabel(a.runtime),
    pidLabel: `×${procCount}`,
    processCount: procCount,
    ports: [...portSet].sort((x, y) => x - y),
    cpu: a.cpu || 0,
    rss: a.rss || 0,
    diskReadRate: a.diskReadRate || 0,
    diskWriteRate: a.diskWriteRate || 0,
    netInRate: a.netInRate || 0,
    netOutRate: a.netOutRate || 0,
    rateKnown: !!a.rateKnown,
    elapsed: null,
    cmd: "",
    children: children.length ? children : undefined,
    appKey: a.key,
    runtime: a.runtime,
    appKind: a.kind,
    confidence: a.confidence,
    evidence: a.evidence || [],
    killTargets,
  };
}

function rowMatchesKeyword(row: TreeRow, q: string): boolean {
  if (!q) return true;
  if ((row.name || "").toLowerCase().includes(q)) return true;
  if ((row.cmd || "").toLowerCase().includes(q)) return true;
  if ((row.proc?.exe || "").toLowerCase().includes(q)) return true;
  if ((row.proc?.cwd || "").toLowerCase().includes(q)) return true;
  if (row.ports.some((p) => String(p).includes(q))) return true;
  return false;
}

function filterTree(rows: TreeRow[], q: string): TreeRow[] {
  if (!q) return rows;
  const out: TreeRow[] = [];
  for (const row of rows) {
    const selfHit = rowMatchesKeyword(row, q);
    const filteredChildren = row.children ? filterTree(row.children, q) : [];
    if (selfHit) {
      out.push(row);
    } else if (filteredChildren.length) {
      out.push({ ...row, children: filteredChildren });
    }
  }
  return out;
}

export function LocalAppsPage() {
  const [keyword, setKeyword] = useState("");
  const [runtime, setRuntime] = useState("all");
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [selectedId, setSelectedId] = useState("");
  const [detail, setDetail] = useState<localapps.ProcNode | null>(null);
  const lastDetailRef = useRef(detail);
  if (detail) lastDetailRef.current = detail;
  const shownDetail = detail ?? lastDetailRef.current;
  const [menu, setMenu] = useState<LocalAppMenuTarget | null>(null);
  const [killTargets, setKillTargets] = useState<KillTarget[]>([]);
  const [forceKill, setForceKill] = useState(false);
  const [killing, setKilling] = useState(false);
  const [killError, setKillError] = useState("");

  const query = useQuery({
    queryKey: ["local-apps"],
    queryFn: () => api.localAppsScan(),
    refetchInterval: 5000,
  });

  const resourcesQuery = useQuery({
    queryKey: ["local-app-resources", detail?.pid],
    queryFn: () => api.localAppsResources(detail!.pid),
    enabled: detail !== null,
    retry: false,
  });

  const runtimeCounts = useMemo(() => {
    const apps = query.data?.apps || [];
    const counts: Record<string, number> = {};
    for (const o of LOCAL_LANG_OPTIONS) counts[o.value] = 0;
    for (const a of apps) {
      if (a.kind === "service") continue;
      const rt = a.runtime || "";
      if (rt in counts) counts[rt] += 1;
    }
    return counts;
  }, [query.data]);

  const runtimes = useMemo(() => {
    const found = new Set(
      (query.data?.apps || [])
        .filter((app) => app.kind !== "service" && app.runtime !== "unknown")
        .map((app) => app.runtime)
        .filter(Boolean),
    );
    const ordered: string[] = LOCAL_LANG_OPTIONS.map((item) => item.value).filter(
      (id) => found.has(id),
    );
    for (const id of found) {
      if (!ordered.includes(id)) ordered.push(id);
    }
    return ordered;
  }, [query.data]);

  const filters = useMemo(() => {
    const apps = query.data?.apps || [];
    return [
      { value: "all", label: "全部", count: apps.length },
      {
        value: "service",
        label: "服务候选",
        count: apps.filter((app) => app.kind === "service").length,
      },
      ...runtimes.map((id) => ({
        value: id,
        label: localLangLabel(id),
        count: runtimeCounts[id] || 0,
      })),
    ];
  }, [query.data, runtimeCounts, runtimes]);

  const treeRows = useMemo(() => {
    const apps = query.data?.apps || [];
    let filtered = apps;
    if (runtime === "service") {
      filtered = apps.filter((a) => a.kind === "service");
    } else if (runtime !== "all") {
      filtered = apps.filter((a) => (a.runtime || "") === runtime);
    }
    const built = filtered.map(appToRow);
    const q = keyword.trim().toLowerCase();
    const rows = filterTree(built, q);
    rows.sort((a, b) => compareAppRows(a, b, sortKey, sortDirection));
    rows.forEach((row, i) => {
      if (row.kind === "app") row.seq = i + 1;
    });
    return rows;
  }, [keyword, query.data, runtime, sortKey, sortDirection]);

  function changeSort(nextKey: SortKey) {
    if (sortKey === nextKey) {
      setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(nextKey);
    setSortDirection(DEFAULT_SORT_DIRECTIONS[nextKey]);
  }

  const selectedRow = useMemo(() => {
    if (!selectedId) return null;
    for (const row of treeRows) {
      if (row.id === selectedId) return row;
      for (const c of row.children || []) {
        if (c.id === selectedId) return c;
      }
    }
    return null;
  }, [selectedId, treeRows]);

  // 刷新后清理无效展开键
  useEffect(() => {
    const valid = new Set(
      treeRows.filter((r) => (r.children || []).length > 0).map((r) => r.id),
    );
    setExpanded((prev) => {
      const next = new Set<string>();
      for (const id of prev) {
        if (valid.has(id)) next.add(id);
      }
      return next;
    });
  }, [treeRows]);

  useEffect(() => {
    setExpanded(new Set());
  }, [runtime]);

  function loadDetail(proc: localapps.ProcNode) {
    setDetail(proc);
  }

  function openKill(targets: KillTarget[]) {
    setForceKill(false);
    setKillError("");
    setKillTargets(targets);
  }

  async function confirmKill() {
    if (!killTargets.length) return;
    setKilling(true);
    setKillError("");
    let ok = 0;
    let lastErr: unknown = null;
    try {
      for (const t of killTargets) {
        try {
          await api.localAppsKill(t.pid, forceKill);
          ok += 1;
        } catch (error) {
          lastErr = error;
        }
      }
      if (ok === 0 && lastErr) {
        setKillError(formatErr(lastErr));
        return;
      }
      if (ok < killTargets.length && lastErr) {
        setKillError(`已结束 ${ok}/${killTargets.length}；其余失败：${formatErr(lastErr)}`);
      } else {
        setKillTargets([]);
      }
      setDetail(null);
      await query.refetch();
    } finally {
      setKilling(false);
    }
  }

  function toggleExpand(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const canKillSelected = (selectedRow?.killTargets || []).length > 0;
  const killButtonLabel =
    selectedRow?.kind === "app" ? "结束应用" : "结束进程";

  /** 展开后的扁平行，便于表格 key 稳定 */
  const flatRows = useMemo(() => {
    const out: { row: TreeRow; depth: number }[] = [];
    for (const row of treeRows) {
      out.push({ row, depth: 0 });
      if (expanded.has(row.id)) {
        for (const child of row.children || []) {
          out.push({ row: child, depth: 1 });
        }
      }
    }
    return out;
  }, [expanded, treeRows]);

  const detailIsService = shownDetail?.kind === "service";
  const detailKindLabel = detailIsService ? "服务候选" : "开发运行时";
  const detailKindClass = detailIsService
    ? "bg-warn text-white"
    : "bg-accent text-white";
  const detailConfidenceLabel =
    shownDetail?.confidence === "high"
      ? "高置信"
      : shownDetail?.confidence === "medium"
        ? "中置信"
        : "置信度未知";
  const detailConfidenceClass =
    shownDetail?.confidence === "high"
      ? "border border-success/30 bg-success-soft text-success"
      : shownDetail?.confidence === "medium"
        ? "border border-warn/30 bg-warn-soft text-warn"
        : "border border-line bg-raised text-muted";

  function renderFlatRow(row: TreeRow, depth: number) {
    const isApp = row.kind === "app";
    const hasChildren = (row.children || []).length > 0;
    const isOpen = expanded.has(row.id);
    const selected = selectedId === row.id;
    return (
      <tr
        key={row.id}
        className={
          selected
            ? "h-12 cursor-pointer border-t border-line bg-accent-soft font-semibold text-accent"
            : "h-12 cursor-pointer border-t border-line hover:bg-raised"
        }
        onClick={() => setSelectedId(row.id)}
        onDoubleClick={() => {
          if (hasChildren) toggleExpand(row.id);
          else if (row.proc) loadDetail(row.proc);
        }}
        onContextMenu={(event) => {
          if (!row.proc) return;
          event.preventDefault();
          setMenu({
            x: event.clientX,
            y: event.clientY,
            appName: treeRows.find((a) => a.appKey === row.appKey)?.name || row.name,
            runtime: row.runtime || "",
            proc: row.proc,
          });
        }}
      >
        <td className="px-2 text-center font-mono text-xs text-muted">
          {isApp ? row.seq : ""}
        </td>
        <td className="px-2">
          <div className="flex items-center gap-1">
            {depth > 0 ? <span className="local-apps-tree-indent" /> : null}
            {hasChildren ? (
              <button
                type="button"
                className="h-5 w-5 shrink-0 rounded border border-line text-xs"
                onClick={(e) => {
                  e.stopPropagation();
                  toggleExpand(row.id);
                }}
              >
                {isOpen ? "−" : "+"}
              </button>
            ) : (
              <span className="inline-block w-5" />
            )}
            <span className="truncate font-medium">{row.name}</span>
          </div>
        </td>
        <td className="px-2 text-sm text-muted">
          {isApp ? (
            <div className="min-w-0">
              <div>{row.typeLabel} · {row.confidence === "high" ? "高置信" : "中置信"}</div>
              {(row.evidence || []).length ? (
                <div
                  className="max-w-56 truncate text-xs"
                  title={(row.evidence || []).join("；")}
                >
                  {(row.evidence || []).join("；")}
                </div>
              ) : null}
            </div>
          ) : (
            row.typeLabel
          )}
        </td>
        <td className="px-2 font-mono text-sm">{row.pidLabel}</td>
        <td className="px-2 font-mono text-sm">
          {row.ports.length ? row.ports.join("、") : "—"}
        </td>
        <td
          className={
            row.cpu > 80
              ? "px-2 text-right font-mono text-sm text-danger"
              : row.cpu > 30
                ? "px-2 text-right font-mono text-sm text-warn"
                : "px-2 text-right font-mono text-sm"
          }
        >
          {Number(row.cpu || 0).toFixed(1)}
        </td>
        <td className="px-2 text-right font-mono text-sm">
          {formatBytes(row.rss || 0)}
        </td>
        <td className="px-2 text-right font-mono text-xs">
          {formatIoPair(row, "disk")}
        </td>
        <td className="px-2 text-right font-mono text-xs">
          {formatIoPair(row, "net")}
        </td>
        <td className="px-2 text-sm">
          {row.elapsed != null && row.elapsed > 0
            ? formatDurationLong(row.elapsed)
            : "—"}
        </td>
      </tr>
    );
  }

  return (
    <Page
      title="应用进程"
      actions={
        <>
          {filters.map((item) => {
            return (
              <Button
                key={item.value}
                variant={runtime === item.value ? "primary" : "secondary"}
                onClick={() => setRuntime(item.value)}
              >
                {item.label}
                {item.count > 0 ? (
                  <span className="opacity-70">({item.count})</span>
                ) : null}
              </Button>
            );
          })}
          <input
            className="h-8 w-56 rounded-control border border-line px-3"
            value={keyword}
            placeholder="搜索名称 / 命令 / 路径 / 端口"
            onChange={(event) => setKeyword(event.target.value)}
          />
          <Button
            disabled={!canKillSelected}
            onClick={() => openKill(selectedRow?.killTargets || [])}
          >
            {killButtonLabel}
          </Button>
          <Button onClick={() => void query.refetch()}>刷新</Button>
        </>
      }
    >
      {(query.data?.warnings || []).length ? (
        <Notice tone="warn" text={(query.data?.warnings || []).join("；")} />
      ) : null}
      {query.error ? <Notice text={formatErr(query.error)} /> : null}

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="min-h-48 flex-1 overflow-auto">
          <table className="w-full border-collapse text-left text-sm">
            <thead className="sticky top-0 z-10">
              <tr className="h-10 bg-raised">
                <th className="w-12 px-2 text-center">序</th>
                <SortableHeader
                  label="名称"
                  sortKey="name"
                  activeKey={sortKey}
                  direction={sortDirection}
                  onSort={changeSort}
                  className="min-w-[180px] px-2"
                />
                <SortableHeader
                  label="类型 / 依据"
                  sortKey="type"
                  activeKey={sortKey}
                  direction={sortDirection}
                  onSort={changeSort}
                  className="w-44 px-2"
                />
                <SortableHeader
                  label="进程数/PID"
                  sortKey="processes"
                  activeKey={sortKey}
                  direction={sortDirection}
                  onSort={changeSort}
                  className="w-28 px-2"
                />
                <SortableHeader
                  label="端口"
                  sortKey="port"
                  activeKey={sortKey}
                  direction={sortDirection}
                  onSort={changeSort}
                  className="w-28 px-2"
                />
                <SortableHeader
                  label="CPU%"
                  sortKey="cpu"
                  activeKey={sortKey}
                  direction={sortDirection}
                  onSort={changeSort}
                  className="w-20 px-2 text-right"
                  align="right"
                />
                <SortableHeader
                  label="内存"
                  sortKey="memory"
                  activeKey={sortKey}
                  direction={sortDirection}
                  onSort={changeSort}
                  className="w-24 px-2 text-right"
                  align="right"
                />
                <SortableHeader
                  label="磁盘读/写"
                  sortKey="disk"
                  activeKey={sortKey}
                  direction={sortDirection}
                  onSort={changeSort}
                  className="w-40 px-2 text-right"
                  align="right"
                />
                <SortableHeader
                  label="网络收/发"
                  sortKey="network"
                  activeKey={sortKey}
                  direction={sortDirection}
                  onSort={changeSort}
                  className="w-40 px-2 text-right"
                  align="right"
                />
                <th className="w-32 px-2">运行时长</th>
              </tr>
            </thead>
            <tbody>
              {flatRows.length === 0 ? (
                <tr className="h-12 border-t border-line">
                  <td className="px-3 text-muted" colSpan={10}>
                    {keyword.trim() || runtime !== "all"
                      ? "无匹配应用"
                      : "未发现本机开发运行时或监听服务"}
                  </td>
                </tr>
              ) : (
                flatRows.map(({ row, depth }) => renderFlatRow(row, depth))
              )}
            </tbody>
          </table>
        </div>

      </div>

      <DialogPrimitive.Root
        open={detail !== null}
        onOpenChange={(open) => !open && setDetail(null)}
      >
        <DialogPrimitive.Portal container={document.body}>
          <div className="pointer-events-none fixed inset-0 z-40 flex items-center justify-center p-4">
          <DialogPrimitive.Overlay className="motion-dialog-overlay pointer-events-auto absolute inset-0 bg-black/60" />
          {shownDetail ? (
            <DialogPrimitive.Content
              className={`motion-dialog-content pointer-events-auto relative z-10 flex max-h-[calc(100vh-48px)] w-[min(1280px,calc(100vw-64px))] flex-col overflow-hidden rounded-surface border border-line border-t-4 bg-surface text-ink shadow-[0_8px_10px_-5px_rgba(0,0,0,0.08),0_16px_24px_2px_rgba(0,0,0,0.04)] focus:outline-none ${detailIsService ? "border-t-warn" : "border-t-accent"}`}
            >
              <div className="flex h-14 shrink-0 items-center gap-3 border-b border-line bg-raised px-4">
                <div className="min-w-0 flex-1">
                  <DialogPrimitive.Title className="truncate text-base font-semibold text-ink">
                    {baseName(shownDetail.exe) || `PID ${shownDetail.pid}`}
                  </DialogPrimitive.Title>
                  <DialogPrimitive.Description className="text-xs text-muted">
                    本机进程详情 · PID {shownDetail.pid}
                  </DialogPrimitive.Description>
                </div>
                <Button size="sm" onClick={() => setDetail(null)}>
                  关闭
                </Button>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto">
                <section
                  className={`border-b border-line px-4 py-4 ${detailIsService ? "bg-warn-soft/55" : "bg-accent-soft"}`}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`inline-flex rounded-control px-2.5 py-1 text-xs font-semibold ${detailKindClass}`}>
                      {detailKindLabel}
                    </span>
                    <span className={`inline-flex rounded-control px-2.5 py-1 text-xs font-semibold ${detailConfidenceClass}`}>
                      {detailConfidenceLabel}
                    </span>
                  </div>
                  <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-4">
                    <div>
                      <dt className="text-xs text-muted">用户</dt>
                      <dd className="mt-0.5 font-medium">{shownDetail.user || "—"}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted">父进程</dt>
                      <dd className="mt-0.5 font-mono font-medium">{shownDetail.ppid || "—"}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted">线程</dt>
                      <dd className="mt-0.5 font-mono font-medium">{shownDetail.threadCount ?? "—"}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted">监听端口</dt>
                      <dd className="mt-0.5 font-mono font-medium text-accent">
                        {(shownDetail.ports || []).join("、") || "—"}
                      </dd>
                    </div>
                  </dl>
                </section>

                <div className="space-y-4 p-4">
                  <section>
                    <h3 className="text-sm font-semibold text-ink">监听地址</h3>
                    {(shownDetail.listenAddresses || []).length ? (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {(shownDetail.listenAddresses || []).map((address) => (
                          <code
                            key={address}
                            className="break-all rounded-control border border-accent/25 bg-accent-soft px-2 py-1 text-xs font-medium text-accent"
                          >
                            {address}
                          </code>
                        ))}
                      </div>
                    ) : (
                      <p className="mt-1 text-sm text-muted">未发现监听地址</p>
                    )}
                  </section>

                  {(shownDetail.evidence || []).length ? (
                    <section>
                      <h3 className="text-sm font-semibold text-ink">发现依据</h3>
                      <ul className="mt-1 space-y-1 text-sm text-muted">
                        {(shownDetail.evidence || []).map((item) => (
                          <li key={item} className="break-all">{item}</li>
                        ))}
                      </ul>
                    </section>
                  ) : null}

                  <section className="grid gap-3 border-y border-line py-3 text-sm">
                    <div className="min-w-0">
                      <div className="text-xs font-medium text-muted">可执行文件</div>
                      <div className="mt-0.5 break-all font-mono text-xs">{shownDetail.exe || "—"}</div>
                    </div>
                    <div className="min-w-0">
                      <div className="text-xs font-medium text-muted">工作目录</div>
                      <div className="mt-0.5 break-all font-mono text-xs">{shownDetail.cwd || "—"}</div>
                    </div>
                    <div className="min-w-0">
                      <div className="text-xs font-medium text-muted">命令</div>
                      <div className="mt-0.5 break-all font-mono text-xs">{shownDetail.cmd || "—"}</div>
                    </div>
                  </section>

                  {resourcesQuery.error ? (
                    <Notice text={formatErr(resourcesQuery.error)} />
                  ) : null}
                  {(resourcesQuery.data?.warnings || []).length ? (
                    <Notice
                      tone="warn"
                      text={(resourcesQuery.data?.warnings || []).join("；")}
                    />
                  ) : null}

                  <section className="overflow-hidden border border-line">
                    <div className="flex items-center justify-between gap-3 bg-raised px-3 py-2 text-sm">
                      <h3 className="font-semibold text-ink">打开的文件与 socket</h3>
                      <span className="shrink-0 font-mono text-xs font-medium text-accent">
                        {resourcesQuery.isFetching
                          ? "读取中…"
                          : `${resourcesQuery.data?.resources?.length || 0} 项`}
                      </span>
                    </div>
                    <div className="max-h-[min(46vh,560px)] overflow-auto">
                      {(resourcesQuery.data?.resources || []).length ? (
                        <table className="w-full min-w-[560px] text-left text-xs">
                          <thead className="sticky top-0 z-10 bg-raised">
                            <tr className="h-8">
                              <th className="w-10 px-2 text-center">序</th>
                              <th className="px-2">FD</th>
                              <th className="px-2">类型</th>
                              <th className="px-2">访问</th>
                              <th className="px-2">协议 / 状态</th>
                              <th className="min-w-64 px-2">名称 / 地址</th>
                            </tr>
                          </thead>
                          <tbody>
                            {(resourcesQuery.data?.resources || []).map((resource, index) => (
                              <tr
                                key={resource.fd + ":" + resource.type + ":" + resource.name}
                                className="border-t border-line align-top"
                              >
                                <td className="px-2 py-1 text-center font-mono text-muted">
                                  {index + 1}
                                </td>
                                <td className="px-2 py-1 font-mono">{resource.fd || "—"}</td>
                                <td className="px-2 py-1">{resource.type || "—"}</td>
                                <td className="px-2 py-1 font-mono">{resource.access || "—"}</td>
                                <td className="px-2 py-1">
                                  {[resource.protocol, resource.state].filter(Boolean).join(" / ") || "—"}
                                </td>
                                <td className="break-all px-2 py-1">
                                  <div>{resource.name || "—"}</div>
                                  {resource.localAddress || resource.remoteAddress ? (
                                    <div className="text-muted">
                                      {resource.localAddress ? `本地：${resource.localAddress}` : ""}
                                      {resource.localAddress && resource.remoteAddress ? " · " : ""}
                                      {resource.remoteAddress ? `远端：${resource.remoteAddress}` : ""}
                                    </div>
                                  ) : null}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      ) : resourcesQuery.isFetching ? null : (
                        <div className="px-3 py-4 text-sm text-muted">未读取到打开资源</div>
                      )}
                    </div>
                  </section>

                  {(shownDetail.threads || []).length ? (
                    <section className="overflow-hidden border border-line">
                      <h3 className="bg-raised px-3 py-2 text-sm font-semibold text-ink">线程</h3>
                      <div className="max-h-40 overflow-auto">
                        <table className="w-full text-left text-xs">
                          <thead className="sticky top-0 bg-raised">
                            <tr className="h-8">
                              <th className="w-10 px-2 text-center">序</th>
                              <th className="px-2">TID</th>
                              <th className="px-2">名称</th>
                              <th className="px-2">CPU</th>
                              <th className="px-2">状态</th>
                            </tr>
                          </thead>
                          <tbody>
                            {(shownDetail.threads || []).map((thread, index) => (
                              <tr key={thread.tid} className="h-8 border-t border-line">
                                <td className="px-2 text-center font-mono text-muted">
                                  {index + 1}
                                </td>
                                <td className="px-2 font-mono">{thread.tid}</td>
                                <td className="px-2">{thread.name || "—"}</td>
                                <td className="px-2 font-mono">
                                  {Number(thread.cpu || 0).toFixed(1)}
                                </td>
                                <td className="px-2">{thread.state || "—"}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </section>
                  ) : null}
                </div>
              </div>
            </DialogPrimitive.Content>
          ) : null}
          </div>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>

      <LocalAppContextMenu
        menu={menu}
        onClose={() => setMenu(null)}
        onDetail={loadDetail}
        onKill={(proc) => {
          openKill([
            {
              pid: proc.pid,
              name: baseName(proc.exe) || `pid-${proc.pid}`,
              cmd: proc.cmd || "",
            },
          ]);
        }}
      />

      <Dialog
        open={killTargets.length > 0}
        onOpenChange={(open) => !open && setKillTargets([])}
      >
        <DialogContent className="w-[min(420px,calc(100%-32px))]">
          <DialogTitle>
            {killTargets.length > 1 ? "结束应用" : "结束进程"}
          </DialogTitle>
          <DialogDescription>
            {killTargets.length === 1
              ? `确定结束 PID ${killTargets[0].pid}${
                  killTargets[0].cmd
                    ? `（${killTargets[0].cmd.slice(0, 80)}）`
                    : ""
                }？`
              : `确定结束 ${killTargets.length} 个进程（${killTargets
                  .slice(0, 3)
                  .map((t) => String(t.pid))
                  .join("、")}${killTargets.length > 3 ? "…" : ""}）？`}
          </DialogDescription>
          <label className="opt-check mt-3">
            <input
              type="checkbox"
              checked={forceKill}
              onChange={(event) => setForceKill(event.target.checked)}
            />
            强制结束（SIGKILL；默认发送 SIGTERM）
          </label>
          {killError ? <Notice text={killError} /> : null}
          <DialogFooter>
            <Button onClick={() => setKillTargets([])}>取消</Button>
            <Button
              variant="danger"
              disabled={killing}
              onClick={() => void confirmKill()}
            >
              {killing
                ? "结束中…"
                : killTargets.length > 1
                  ? "结束全部"
                  : "结束"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Page>
  );
}
