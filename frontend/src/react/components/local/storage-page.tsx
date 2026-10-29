import { useQuery } from "@tanstack/react-query";
import { Fragment, useEffect, useMemo, useState } from "react";
import { api, type localsys, type monitor } from "@/api";
import { OverviewTable, PhysicalDiskRows } from "@/react/components/overview/overview-parts";
import { isMacPlatform } from "@/react/lib/platform";
import { Button } from "@/react/components/ui/button";
import { Meter } from "@/react/components/ui/meter";
import { RadioGroup } from "@/react/components/ui/radio-group";
import { Tag } from "@/react/components/ui/tag";
import { Notice, Page } from "@/react/components/page";
import { formatBytes, formatBytesSI, formatErr } from "@/utils/format";
import { diskMountPercent, diskPhysicalLabel } from "./disk-utils";
import { refreshLocalMetrics, useLocalMetrics } from "./use-local-metrics";
import "./local.css";

/* 表头统一：36px、12px 次文字、无底色 + 下方 1px line（docs/design/specification.md §4.4） */
const THEAD_ROW_CLASS = "h-table-head border-b border-line text-xs font-normal text-muted";

type TabId = "apps" | "tree" | "large";

const TAB_OPTIONS: { value: TabId; label: string }[] = [
  { value: "apps", label: "应用占用" },
  { value: "tree", label: "目录" },
  { value: "large", label: "大文件" },
];

function formatScanTime(sec: number) {
  if (!sec) return "";
  return new Date(sec * 1000).toLocaleString();
}

function formatModTime(sec: number) {
  if (!sec) return "—";
  return new Date(sec * 1000).toLocaleString();
}

export function LocalStoragePage() {
  const { overview: device, error: metricsError } = useLocalMetrics();
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
      ? "扫描中"
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

  const physicalDisks: monitor.DiskInfo[] = useMemo(
    () => (device?.disks || [])
      .filter((disk) => disk.kind === "disk" && (disk.total || 0) > 0)
      .map((disk) => ({
        filesystem: disk.filesystem || disk.device || disk.mount,
        fsType: disk.fsType || "",
        mount: diskPhysicalLabel(disk),
        total: disk.total,
        used: disk.used || 0,
        avail: disk.avail || disk.free || 0,
        percent: ((disk.used || 0) / disk.total) * 100,
        kind: "disk",
      })),
    [device?.disks],
  );
  const partitions = useMemo(
    () => (device?.disks || [])
      .filter((disk) => disk.kind !== "disk")
      .sort((a, b) => {
        if (a.mount === "/") return -1;
        if (b.mount === "/") return 1;
        return Number(!!a.external) - Number(!!b.external) || (a.mount || "").localeCompare(b.mount || "");
      }),
    [device?.disks],
  );

  return (
    <Page
      title="磁盘空间"
      actions={
        <>
          <Button
            variant="primary"
            size="sm"
            disabled={status?.state === "running"}
            onClick={() => void startScan()}
          >
            {scanButtonLabel}
          </Button>
          {isMacPlatform() ? (
            <Button size="sm" onClick={() => void api.localSysStorageOpenPrivacy()}>
              打开完全磁盘访问
            </Button>
          ) : null}
        </>
      }
      onRefresh={async () => { await Promise.all([statusQuery.refetch(), refreshLocalMetrics()]); }}
    >
      {metricsError ? <Notice tone={device ? "warning" : "error"} text={`${device ? "磁盘更新失败，显示上次读数：" : "磁盘采集失败："}${formatErr(metricsError)}`} /> : null}
      {statusQuery.error ? <Notice text={formatErr(statusQuery.error)} /> : null}
      {status?.error ? <Notice text={status.error} /> : null}

      <div className="gap-section flex flex-col">
        <section>
          <div className="mb-3 text-sm font-semibold text-ink">物理磁盘</div>
          {physicalDisks.length ? (
            <PhysicalDiskRows disks={physicalDisks} />
          ) : (
            <p className="text-sm text-muted">
              {!device && !metricsError ? "加载中…" : "未采集到物理磁盘"}
            </p>
          )}
        </section>

        <section>
          <div className="mb-3 text-sm font-semibold text-ink">分区</div>
          {partitions.length ? (
            <OverviewTable
              columns={[
                { key: "mount", label: "挂载点" },
                { key: "fs", label: "设备" },
                { key: "type", label: "类型" },
                { key: "used", label: "已用 / 总量", align: "right" },
                { key: "pct", label: "使用率" },
              ]}
              rows={partitions.map((disk) => ({
                id: `${disk.mount}-${disk.device || disk.filesystem}`,
                cells: [
                  <span key="mount" className="font-mono">
                    {disk.name ? <>{disk.name} <span className="text-muted">{disk.mount}</span></> : disk.mount || "—"}
                  </span>,
                  <span key="fs" className="font-mono">{disk.device || disk.filesystem || "—"}</span>,
                  disk.fsType || "—",
                  `${formatBytes(disk.used || 0)} / ${formatBytes(disk.total || 0)}`,
                  <Meter key="pct" value={diskMountPercent(disk)} className="w-full whitespace-nowrap" />,
                ],
              }))}
            />
          ) : (
            <p className="text-sm text-muted">{!device && !metricsError ? "加载中…" : "暂无分区数据"}</p>
          )}
        </section>

        <section>
          <div className="mb-3 text-sm font-semibold text-ink">扫描状态</div>
          <p className="mt-2 text-xs text-muted">
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
            <p className="mt-2 text-sm text-warn">
              {status?.deniedDirs} 个目录因权限跳过
              {isMacPlatform() ? (
                <button
                  type="button"
                  className="ml-2 text-accent"
                  onClick={() => void api.localSysStorageOpenPrivacy()}
                >
                  授予完全磁盘访问
                </button>
              ) : null}
            </p>
          ) : null}
        </section>

        <section>
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <span className="text-sm font-semibold text-ink">占用明细</span>
            <RadioGroup
              value={tab}
              onChange={setTab}
              options={TAB_OPTIONS}
              disabled={idleNoRecord}
              aria-label="占用视图"
            />
            {!idleNoRecord && (tab === "apps" || tab === "large") ? (
              <input
                className="motion-field ml-auto h-8 w-56 rounded-control px-3 text-sm text-ink"
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                placeholder="搜索名称 / 路径…"
              />
            ) : null}
          </div>

        {idleNoRecord ? (
          <p className="text-sm text-muted">尚未扫描</p>
        ) : (
          <>
            {tab === "apps" ? (
              <div className="max-w-full overflow-x-auto">
                <div className="min-w-[800px]">
                <table className="w-full border-collapse text-left text-sm">
                  <thead>
                    <tr className={THEAD_ROW_CLASS}>
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
                      <tr className="h-table-row border-t border-line">
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
                            <tr className="h-table-row border-t border-line">
                              <td className="px-2 text-center">
                                <button
                                  type="button"
                                  className="h-5 w-5 rounded-control bg-raised text-xs hover:bg-line"
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
                              <td className="whitespace-nowrap px-3 text-right font-mono">
                                {formatBytesSI(app.bundleSize || 0)}
                              </td>
                              <td className="whitespace-nowrap px-3 text-right font-mono">
                                {formatBytesSI(app.dataSize || 0)}
                              </td>
                              <td className="whitespace-nowrap px-3 text-right font-mono">
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
                              <tr className="border-t border-line bg-raised">
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
                </div>
              </div>
            ) : null}

            {tab === "tree" ? (
              <>
                <div className="mb-2 flex flex-wrap items-center gap-1 px-3 text-sm">
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
                  <div className="mb-3">
                    <Notice text={formatErr(treeQuery.error)} />
                  </div>
                ) : null}
                <table className="w-full border-collapse text-left text-sm">
                  <thead>
                    <tr className={THEAD_ROW_CLASS}>
                      <th className="w-12 px-2 text-center">序</th>
                      <th className="px-3">名称</th>
                      <th className="px-3 text-right">大小</th>
                      <th className="w-48 px-3">占比</th>
                      <th className="w-16 px-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {treeChildren.length === 0 ? (
                      <tr className="h-table-row border-t border-line">
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
                            className="h-table-row cursor-pointer border-t border-line hover:bg-raised"
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
                                <Tag className="ml-1">文件夹</Tag>
                              ) : null}
                            </td>
                            <td className="px-3 text-right font-mono">
                              {formatBytesSI(row.size || 0)}
                            </td>
                            <td className="px-3">
                              <Meter
                                value={pct}
                                valueText={`${pct}%`}
                                className="w-full"
                              />
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
              </>
            ) : null}

            {tab === "large" ? (
              <div className="max-w-full overflow-x-auto">
                <div className="min-w-[900px]">
                <table className="w-full border-collapse text-left text-sm">
                  <thead>
                    <tr className={THEAD_ROW_CLASS}>
                      <th className="w-12 px-2 text-center">序</th>
                      <th className="px-3">路径</th>
                      <th className="px-3 text-right">大小</th>
                      <th className="px-3">修改时间</th>
                      <th className="w-16 px-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {filteredLarge.length === 0 ? (
                      <tr className="h-table-row border-t border-line">
                        <td className="px-3 text-muted" colSpan={5}>
                          暂无大文件
                        </td>
                      </tr>
                    ) : (
                      filteredLarge.map((file, idx) => (
                        <tr key={file.path} className="h-table-row border-t border-line">
                          <td className="px-2 text-center font-mono text-muted">
                            {idx + 1}
                          </td>
                          <td className="max-w-[480px] truncate px-3 font-mono">
                            {file.path}
                          </td>
                          <td className="whitespace-nowrap px-3 text-right font-mono">
                            {formatBytesSI(file.size || 0)}
                          </td>
                          <td className="whitespace-nowrap px-3 text-sm text-muted">
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
                </div>
              </div>
            ) : null}
          </>
        )}
        </section>
      </div>
    </Page>
  );
}
