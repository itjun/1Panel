import { useQuery } from "@tanstack/react-query";
import { Fragment, useEffect, useMemo, useState } from "react";
import { api, type localsys } from "@/api";
import { Button } from "@/react/components/ui/button";
import { Card } from "@/react/components/ui/card";
import { Notice, Page } from "@/react/components/page";
import { formatBytesSI, formatErr } from "@/utils/format";
import {
  INTERNAL_DISK_BAR_COLOR,
} from "./disk-utils";
import "./local.css";

type TabId = "apps" | "tree" | "large";

function formatScanTime(sec: number) {
  if (!sec) return "";
  return new Date(sec * 1000).toLocaleString();
}

function formatModTime(sec: number) {
  if (!sec) return "—";
  return new Date(sec * 1000).toLocaleString();
}

export function LocalStoragePage() {
  const [tab, setTab] = useState<TabId>("apps");
  const [keyword, setKeyword] = useState("");
  const [treePath, setTreePath] = useState("");
  const [expandedApps, setExpandedApps] = useState<Set<string>>(() => new Set());

  const statusQuery = useQuery({
    queryKey: ["local-storage"],
    queryFn: () => api.localSysStorageStatus(),
    refetchInterval: (q) => (q.state.data?.state === "running" ? 1000 : false),
  });
  const status = statusQuery.data;
  const done = status?.state === "done";
  const hasRecord = (status?.finishedAt || 0) > 0 || done;

  const appsQuery = useQuery({
    queryKey: ["local-storage-apps"],
    queryFn: () => api.localSysStorageApps(),
    enabled: done,
  });
  const largeQuery = useQuery({
    queryKey: ["local-storage-large"],
    queryFn: () => api.localSysStorageLargeFiles(),
    enabled: done,
  });
  const treeQuery = useQuery({
    queryKey: ["local-storage-tree", treePath],
    queryFn: () => api.localSysStorageTree(treePath),
    enabled: done && tab === "tree",
  });

  useEffect(() => {
    if (status?.state === "done") {
      void appsQuery.refetch();
      void largeQuery.refetch();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status?.state, status?.finishedAt]);

  const coverage = useMemo(() => {
    const used = status?.containerUsed || 0;
    const scanned = status?.scannedBytes || 0;
    if (!used) return null;
    return Math.min(100, Math.round((scanned / used) * 100));
  }, [status]);

  const scanButtonLabel =
    status?.state === "running"
      ? "扫描中…"
      : hasRecord
        ? "重新扫描"
        : "开始扫描";

  const filteredApps = useMemo(() => {
    const list = appsQuery.data || [];
    const q = keyword.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (a) =>
        (a.name || "").toLowerCase().includes(q) ||
        (a.path || "").toLowerCase().includes(q) ||
        (a.bundleId || "").toLowerCase().includes(q),
    );
  }, [appsQuery.data, keyword]);

  const filteredLarge = useMemo(() => {
    const list = largeQuery.data || [];
    const q = keyword.trim().toLowerCase();
    if (!q) return list;
    return list.filter((f) => (f.path || "").toLowerCase().includes(q));
  }, [keyword, largeQuery.data]);

  const crumbs = useMemo(() => {
    if (!treePath) return [] as { name: string; path: string }[];
    const parts = treePath.split("/").filter(Boolean);
    const out: { name: string; path: string }[] = [];
    let cur = "";
    for (const part of parts) {
      cur += "/" + part;
      out.push({ name: part, path: cur });
    }
    return out;
  }, [treePath]);

  const treeChildren = treeQuery.data?.children || [];
  const parentSize = treeQuery.data?.size || 0;

  function treePercent(size: number) {
    if (!parentSize || !size) return 0;
    return Math.min(100, Math.round((size / parentSize) * 100));
  }

  async function startScan() {
    await api.localSysStorageScanStart();
    await statusQuery.refetch();
  }

  async function reveal(path: string) {
    try {
      await api.localSysStorageReveal(path);
    } catch {
      /* ignore */
    }
  }

  function toggleApp(path: string) {
    setExpandedApps((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  const idleNoRecord = status?.state === "idle" && !hasRecord;

  return (
    <Page
      title="磁盘空间"
      actions={
        <>
          <Button
            variant="primary"
            disabled={status?.state === "running"}
            onClick={() => void startScan()}
          >
            {scanButtonLabel}
          </Button>
          <Button onClick={() => void api.localSysStorageOpenPrivacy()}>
            打开完全磁盘访问
          </Button>
          <Button onClick={() => void statusQuery.refetch()}>刷新</Button>
        </>
      }
    >
      {statusQuery.error ? <Notice text={formatErr(statusQuery.error)} /> : null}
      {status?.error ? <Notice text={status.error} /> : null}

      <div className="flex flex-col gap-4">
        <Card>
          <div className="text-lg font-medium font-mono">
            {formatBytesSI(status?.containerUsed || 0)} /{" "}
            {formatBytesSI(status?.containerTotal || 0)}
          </div>
          <p className="mt-2 text-sm text-muted">
            <span>容器</span>
            {status?.containerAvail ? (
              <>
                <span> · </span>
                <span>可用 {formatBytesSI(status.containerAvail)}</span>
              </>
            ) : null}
            <span> · </span>
            {status?.state === "idle" && !status?.finishedAt ? (
              <span>尚未扫描</span>
            ) : (
              <>
                <span>
                  已扫描{" "}
                  <span className="font-mono">
                    {formatBytesSI(status?.scannedBytes || 0)}
                  </span>
                </span>
                {coverage != null ? (
                  <>
                    <span> · </span>
                    <span>覆盖约 {coverage}%</span>
                  </>
                ) : null}
                {status?.state === "running" ? (
                  <>
                    <span> · </span>
                    <span>{status.scannedFiles || 0} 文件</span>
                  </>
                ) : status?.finishedAt ? (
                  <>
                    <span> · </span>
                    <span>记录于 {formatScanTime(status.finishedAt)}</span>
                  </>
                ) : null}
              </>
            )}
          </p>
          {(status?.deniedDirs || 0) > 0 ? (
            <p className="mt-2 text-sm text-[#b97814]">
              {status?.deniedDirs} 个目录因权限跳过
              <button
                type="button"
                className="ml-2 text-accent"
                onClick={() => void api.localSysStorageOpenPrivacy()}
              >
                授予完全磁盘访问
              </button>
            </p>
          ) : null}
        </Card>

        {idleNoRecord ? (
          <Card>
            <p className="mb-3 text-sm text-muted">
              尚未扫描磁盘占用。全盘扫描可能需要一两分钟，请手动开始。
            </p>
            <Button variant="primary" onClick={() => void startScan()}>
              开始扫描
            </Button>
          </Card>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              {(
                [
                  { id: "apps" as const, label: "应用占用" },
                  { id: "tree" as const, label: "目录" },
                  { id: "large" as const, label: "大文件" },
                ] as const
              ).map((t) => (
                <Button
                  key={t.id}
                  variant={tab === t.id ? "primary" : "secondary"}
                  onClick={() => setTab(t.id)}
                >
                  {t.label}
                </Button>
              ))}
              {(tab === "apps" || tab === "large") && (
                <input
                  className="ml-auto h-8 w-56 rounded-control border border-line px-3"
                  value={keyword}
                  onChange={(e) => setKeyword(e.target.value)}
                  placeholder="搜索名称 / 路径…"
                />
              )}
            </div>

            {tab === "apps" ? (
              <Card className="overflow-hidden p-0">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="h-10 bg-[#f7f8fa]">
                      <th className="w-10 px-2" />
                      <th className="w-12 px-2 text-center">序</th>
                      <th className="px-3">应用</th>
                      <th className="px-3 text-right">程序</th>
                      <th className="px-3 text-right">数据</th>
                      <th className="px-3 text-right">合计</th>
                      <th className="px-3">路径</th>
                      <th className="w-16 px-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {filteredApps.length === 0 ? (
                      <tr className="h-12 border-t border-line">
                        <td className="px-3 text-muted" colSpan={8}>
                          暂无应用占用数据
                        </td>
                      </tr>
                    ) : (
                      filteredApps.map((app, idx) => {
                        const open = expandedApps.has(app.path);
                        const parts = app.parts || [];
                        return (
                          <Fragment key={app.path}>
                            <tr className="h-12 border-t border-line">
                              <td className="px-2 text-center">
                                <button
                                  type="button"
                                  className="h-5 w-5 rounded border border-line text-xs"
                                  onClick={() => toggleApp(app.path)}
                                >
                                  {open ? "−" : "+"}
                                </button>
                              </td>
                              <td className="px-2 text-center font-mono text-muted">
                                {idx + 1}
                              </td>
                              <td className="px-3">
                                {app.name || app.bundleId || "—"}
                              </td>
                              <td className="px-3 text-right font-mono">
                                {formatBytesSI(app.bundleSize || 0)}
                              </td>
                              <td className="px-3 text-right font-mono">
                                {formatBytesSI(app.dataSize || 0)}
                              </td>
                              <td className="px-3 text-right font-mono">
                                {formatBytesSI(app.total || 0)}
                              </td>
                              <td className="max-w-[240px] truncate px-3 font-mono text-muted">
                                {app.path}
                              </td>
                              <td className="px-2 text-center">
                                <button
                                  type="button"
                                  className="text-accent"
                                  onClick={() => void reveal(app.path)}
                                >
                                  显示
                                </button>
                              </td>
                            </tr>
                            {open ? (
                              <tr className="border-t border-line bg-[#fafbfc]">
                                <td colSpan={8} className="px-4 py-2">
                                  {parts.length ? (
                                    <div className="flex flex-col gap-1">
                                      {parts.map((p) => (
                                        <div
                                          key={p.path}
                                          className="flex flex-wrap items-center gap-3 text-sm"
                                        >
                                          <span className="w-24 shrink-0">
                                            {p.label}
                                          </span>
                                          <span className="min-w-0 flex-1 truncate font-mono text-muted">
                                            {p.path}
                                          </span>
                                          <span className="font-mono">
                                            {formatBytesSI(p.size || 0)}
                                          </span>
                                          <button
                                            type="button"
                                            className="text-accent"
                                            onClick={() => void reveal(p.path)}
                                          >
                                            显示
                                          </button>
                                        </div>
                                      ))}
                                    </div>
                                  ) : (
                                    <span className="text-sm text-muted">
                                      无关联数据目录
                                    </span>
                                  )}
                                </td>
                              </tr>
                            ) : null}
                          </Fragment>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </Card>
            ) : null}

            {tab === "tree" ? (
              <Card className="overflow-hidden p-0">
                <div className="flex flex-wrap items-center gap-1 border-b border-line px-3 py-2 text-sm">
                  <button
                    type="button"
                    className="text-accent"
                    onClick={() => setTreePath("")}
                  >
                    扫描范围
                  </button>
                  {crumbs.map((c, i) => (
                    <span key={c.path} className="flex items-center gap-1">
                      <span className="text-muted">/</span>
                      <button
                        type="button"
                        className="text-accent disabled:text-ink"
                        disabled={i === crumbs.length - 1}
                        onClick={() => setTreePath(c.path)}
                      >
                        {c.name}
                      </button>
                    </span>
                  ))}
                </div>
                {treeQuery.error ? (
                  <div className="p-3">
                    <Notice text={formatErr(treeQuery.error)} />
                  </div>
                ) : null}
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="h-10 bg-[#f7f8fa]">
                      <th className="w-12 px-2 text-center">序</th>
                      <th className="px-3">名称</th>
                      <th className="px-3 text-right">大小</th>
                      <th className="w-48 px-3">占比</th>
                      <th className="w-16 px-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {treeChildren.length === 0 ? (
                      <tr className="h-12 border-t border-line">
                        <td className="px-3 text-muted" colSpan={5}>
                          {treeQuery.isLoading ? "加载中…" : "无目录数据"}
                        </td>
                      </tr>
                    ) : (
                      treeChildren.map((row: localsys.StorageNode, idx) => {
                        const pct = treePercent(row.size || 0);
                        return (
                          <tr
                            key={row.path}
                            className="h-12 cursor-pointer border-t border-line hover:bg-[#f7f8fa]"
                            onClick={() => {
                              if (row.isDir) setTreePath(row.path);
                            }}
                          >
                            <td className="px-2 text-center font-mono text-muted">
                              {idx + 1}
                            </td>
                            <td className="px-3">
                              {row.name}
                              {row.isDir ? (
                                <span className="ml-1 text-xs text-muted">
                                  文件夹
                                </span>
                              ) : null}
                            </td>
                            <td className="px-3 text-right font-mono">
                              {formatBytesSI(row.size || 0)}
                            </td>
                            <td className="px-3">
                              <div className="flex items-center gap-2">
                                <div className="local-disk-bar flex-1">
                                  <i
                                    style={{
                                      width: `${pct}%`,
                                      background: INTERNAL_DISK_BAR_COLOR,
                                    }}
                                  />
                                </div>
                                <span className="w-10 text-right text-xs text-muted">
                                  {pct}%
                                </span>
                              </div>
                            </td>
                            <td className="px-2 text-center">
                              <button
                                type="button"
                                className="text-accent"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void reveal(row.path);
                                }}
                              >
                                显示
                              </button>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </Card>
            ) : null}

            {tab === "large" ? (
              <Card className="overflow-hidden p-0">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="h-10 bg-[#f7f8fa]">
                      <th className="w-12 px-2 text-center">序</th>
                      <th className="px-3">路径</th>
                      <th className="px-3 text-right">大小</th>
                      <th className="px-3">修改时间</th>
                      <th className="w-16 px-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {filteredLarge.length === 0 ? (
                      <tr className="h-12 border-t border-line">
                        <td className="px-3 text-muted" colSpan={5}>
                          暂无大文件
                        </td>
                      </tr>
                    ) : (
                      filteredLarge.map((file, idx) => (
                        <tr key={file.path} className="h-12 border-t border-line">
                          <td className="px-2 text-center font-mono text-muted">
                            {idx + 1}
                          </td>
                          <td className="max-w-[480px] truncate px-3 font-mono">
                            {file.path}
                          </td>
                          <td className="px-3 text-right font-mono">
                            {formatBytesSI(file.size || 0)}
                          </td>
                          <td className="px-3 text-sm text-muted">
                            {formatModTime(file.modTime || 0)}
                          </td>
                          <td className="px-2 text-center">
                            <button
                              type="button"
                              className="text-accent"
                              onClick={() => void reveal(file.path)}
                            >
                              显示
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </Card>
            ) : null}
          </>
        )}
      </div>
    </Page>
  );
}
