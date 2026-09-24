import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState, type ReactNode } from "react";
import { api } from "@/api";
import type { monitor } from "@/api";
import { Button } from "@/react/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/react/components/ui/dialog";
import { Notice, Page } from "@/react/components/page";
import { copyText } from "@/utils/clipboard";
import { formatErr } from "@/utils/format";

type AptPackage = monitor.AptPackage;
type SortKey = "name" | "version" | "depends" | "dependedBy";

function SimpleRows({
  headers,
  rows,
}: {
  headers: { key: string; label: string }[];
  rows: { id: string; cells: ReactNode[] }[];
}) {
  return (
    <div className="overflow-auto border border-line bg-surface">
      <table className="w-full border-collapse text-left text-sm">
        <thead className="bg-[#f7f8fa]">
          <tr className="h-10">
            {headers.map((header) => (
              <th key={header.key} className="px-3 font-medium">
                {header.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr className="h-12">
              <td className="px-3 text-muted" colSpan={headers.length}>
                暂无数据
              </td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr key={row.id} className="h-12 border-t border-line hover:bg-ink/5">
                {row.cells.map((cell, index) => (
                  <td key={index} className="max-w-[360px] truncate px-3">
                    {cell}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

function buildReverseIndex(pkgs: AptPackage[]) {
  const counts = new Map<string, number>();
  const lists = new Map<string, string[]>();
  if (!pkgs.length) return { counts, lists };
  const names = new Set(pkgs.map((p) => p.name));
  for (const pkg of pkgs) {
    for (const dep of pkg.depList ?? []) {
      if (!names.has(dep)) continue;
      counts.set(dep, (counts.get(dep) ?? 0) + 1);
      const arr = lists.get(dep) ?? [];
      arr.push(pkg.name);
      lists.set(dep, arr);
    }
  }
  return { counts, lists };
}

function pkgDependedBy(
  pkg: AptPackage,
  reverse: ReturnType<typeof buildReverseIndex>,
): number {
  if (pkg.dependedBy != null && pkg.dependedBy > 0) return pkg.dependedBy;
  const n = reverse.counts.get(pkg.name);
  if (n != null) return n;
  return pkg.dependedBy ?? 0;
}

function pkgRDeps(
  pkg: AptPackage,
  reverse: ReturnType<typeof buildReverseIndex>,
): string[] {
  if (pkg.rDepList?.length) return [...pkg.rDepList];
  return [...(reverse.lists.get(pkg.name) ?? [])];
}

export function PackagesPage({ host }: { host: string }) {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [copyHint, setCopyHint] = useState("");

  const [depOpen, setDepOpen] = useState(false);
  const [depLoading, setDepLoading] = useState(false);
  const [depError, setDepError] = useState("");
  const [depPkg, setDepPkg] = useState<AptPackage | null>(null);
  const [deps, setDeps] = useState<string[]>([]);
  const [rdeps, setRdeps] = useState<string[]>([]);

  const query = useQuery({
    queryKey: ["pkgs", host],
    queryFn: () => api.collectPackages(host),
  });

  const list = query.data || [];
  const reverse = useMemo(() => buildReverseIndex(list), [list]);

  const keyword = filter.trim().toLowerCase();
  const rows = useMemo(() => {
    let filtered = list;
    if (keyword) {
      filtered = list.filter(
        (p) =>
          p.name.toLowerCase().includes(keyword) ||
          (p.version || "").toLowerCase().includes(keyword),
      );
    }
    const dir = sortDir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      if (sortKey === "depends") {
        return dir * ((a.depends || 0) - (b.depends || 0));
      }
      if (sortKey === "dependedBy") {
        return dir * (pkgDependedBy(a, reverse) - pkgDependedBy(b, reverse));
      }
      if (sortKey === "version") {
        return dir * (a.version || "").localeCompare(b.version || "");
      }
      return dir * a.name.localeCompare(b.name);
    });
  }, [list, keyword, sortKey, sortDir, reverse]);

  const stats = useMemo(() => {
    if (!list.length) return null;
    let maxDeps = 0;
    let sum = 0;
    for (const p of list) {
      if (p.depends > maxDeps) maxDeps = p.depends;
      sum += p.depends;
    }
    return {
      total: list.length,
      maxDeps,
      avgDeps: Math.round((sum / list.length) * 10) / 10,
    };
  }, [list]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(key);
    setSortDir(key === "name" || key === "version" ? "asc" : "desc");
  }

  function cacheDepList(name: string, nextDeps: string[]) {
    if (!list.length || !nextDeps.length) return;
    const idx = list.findIndex((p) => p.name === name);
    if (idx < 0) return;
    const next = [...list];
    next[idx] = { ...next[idx]!, depList: nextDeps, depends: nextDeps.length };
    queryClient.setQueryData(["pkgs", host], next);
  }

  async function openDepDialog(pkg: AptPackage) {
    setDepPkg(pkg);
    setDepError("");
    setCopyHint("");
    setDeps(pkg.depList?.length ? [...pkg.depList] : []);
    setRdeps(pkgRDeps(pkg, reverse));
    setDepOpen(true);

    const needFetchDeps = !(pkg.depList?.length) && (pkg.depends || 0) > 0;
    if (!needFetchDeps) return;

    setDepLoading(true);
    try {
      const fetched = (await api.collectPackageDepends(host, pkg.name)) || [];
      setDeps(fetched);
      cacheDepList(pkg.name, fetched);
      setRdeps(pkgRDeps({ ...pkg, depList: fetched, depends: fetched.length }, reverse));
    } catch (e) {
      setDepError(formatErr(e));
    } finally {
      setDepLoading(false);
    }
  }

  async function copyList(items: string[], label: string) {
    if (!items.length) return;
    try {
      await copyText(items.join("\n"));
      setCopyHint(`已复制${label}`);
    } catch {
      setCopyHint(`复制${label}失败`);
    }
  }

  const depCountShown = deps.length || depPkg?.depends || 0;
  const rDepCountShown = rdeps.length || (depPkg ? pkgDependedBy(depPkg, reverse) : 0);

  return (
    <Page
      title="软件包"
      actions={
        <>
          <input
            className="h-8 rounded-control border border-line px-3"
            value={filter}
            placeholder="搜索包名/版本..."
            onChange={(e) => setFilter(e.target.value)}
          />
          <Button
            variant={sortKey === "name" ? "primary" : "secondary"}
            onClick={() => toggleSort("name")}
          >
            按名{sortKey === "name" ? (sortDir === "asc" ? " ↑" : " ↓") : ""}
          </Button>
          <Button
            variant={sortKey === "depends" ? "primary" : "secondary"}
            onClick={() => toggleSort("depends")}
          >
            按依赖数{sortKey === "depends" ? (sortDir === "asc" ? " ↑" : " ↓") : ""}
          </Button>
          <Button onClick={() => void query.refetch()} disabled={query.isFetching}>
            {query.isFetching ? "刷新中…" : "刷新"}
          </Button>
        </>
      }
    >
      {stats ? (
        <p className="mb-3 text-sm text-muted">
          共 {stats.total} 个 · 平均依赖 {stats.avgDeps} · 最多 {stats.maxDeps} 依赖
        </p>
      ) : null}
      {query.error ? <Notice text={formatErr(query.error)} /> : null}
      {!query.isFetching && !list.length && !query.error ? (
        <p className="text-sm text-muted">
          点击刷新加载软件包列表（体积较大，按需拉取）
        </p>
      ) : null}
      {list.length ? (
        <SimpleRows
          headers={[
            { key: "name", label: "包名" },
            { key: "ver", label: "版本" },
            { key: "deps", label: "依赖数" },
            { key: "rdeps", label: "被依赖" },
          ]}
          rows={rows.map((item) => {
            const depN = item.depends ?? item.depList?.length ?? 0;
            const rdepN = pkgDependedBy(item, reverse);
            return {
              id: item.name,
              cells: [
                <span key="n" className="font-medium">
                  {item.name}
                </span>,
                item.version || "—",
                depN > 0 ? (
                  <button
                    key="d"
                    type="button"
                    className="text-accent underline-offset-2 hover:underline"
                    title="查看依赖的包"
                    onClick={() => void openDepDialog(item)}
                  >
                    {depN}
                  </button>
                ) : (
                  ""
                ),
                rdepN > 0 ? (
                  <button
                    key="r"
                    type="button"
                    className="text-accent underline-offset-2 hover:underline"
                    title="查看被哪些包依赖"
                    onClick={() => void openDepDialog(item)}
                  >
                    {rdepN}
                  </button>
                ) : (
                  ""
                ),
              ],
            };
          })}
        />
      ) : null}

      <Dialog open={depOpen} onOpenChange={(v) => !v && setDepOpen(false)}>
        <DialogContent className="w-[min(560px,calc(100%-32px))]">
          <DialogTitle>
            {depPkg ? `${depPkg.name} 依赖关系` : "依赖关系"}
          </DialogTitle>
          <DialogDescription>
            版本 {depPkg?.version || "—"} · 依赖数 {depCountShown} · 被依赖数{" "}
            {rDepCountShown}
          </DialogDescription>
          {depError ? <Notice text={depError} /> : null}
          {copyHint ? <Notice text={copyHint} tone="warn" /> : null}
          {depLoading ? (
            <p className="mt-3 text-sm text-muted">加载依赖中…</p>
          ) : (
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="text-sm font-medium">这个包装了谁</span>
                  {deps.length ? (
                    <Button
                      size="sm"
                      onClick={() => void copyList(deps, "依赖列表")}
                    >
                      复制
                    </Button>
                  ) : null}
                </div>
                <div className="max-h-56 overflow-auto rounded-control border border-line p-2 font-mono text-xs">
                  {deps.length
                    ? deps.map((d) => <div key={`d-${d}`}>{d}</div>)
                    : "无"}
                </div>
              </div>
              <div>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="text-sm font-medium">谁装了这个包</span>
                  {rdeps.length ? (
                    <Button
                      size="sm"
                      variant="primary"
                      onClick={() => void copyList(rdeps, "被依赖列表")}
                    >
                      复制
                    </Button>
                  ) : null}
                </div>
                <div className="max-h-56 overflow-auto rounded-control border border-line p-2 font-mono text-xs">
                  {rdeps.length
                    ? rdeps.map((d) => <div key={`r-${d}`}>{d}</div>)
                    : "无"}
                </div>
              </div>
            </div>
          )}
          {!depLoading && !depError && !deps.length && !rdeps.length ? (
            <p className="mt-2 text-sm text-muted">无直接依赖关系</p>
          ) : null}
          <div className="mt-3 flex justify-end">
            <Button onClick={() => setDepOpen(false)}>关闭</Button>
          </div>
        </DialogContent>
      </Dialog>
    </Page>
  );
}
