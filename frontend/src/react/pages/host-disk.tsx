import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { api } from "@/api";
import type { monitor } from "@/api";
import { Notice, Page } from "@/react/components/page";
import { Button } from "@/react/components/ui/button";
import { Meter } from "@/react/components/ui/meter";
import { isDiskFull, mountDisks, physicalDisks } from "@/utils/alerts";
import { USAGE_DANGER } from "@/react/lib/usage-tone";
import { formatBytes, formatErr } from "@/utils/format";

const LARGE_FILES_LIMIT = 10;

export function DiskPage({ host }: { host: string }) {
  return <HostDiskPage key={host} host={host} />;
}

function HostDiskPage({ host }: { host: string }) {
  const disks = useQuery({
    queryKey: ["disks", host],
    queryFn: () => api.collectDisks(host),
    refetchInterval: 15000,
  });
  const [selectedDisk, setSelectedDisk] = useState<string | null>(null);
  const [selectedMount, setSelectedMount] = useState<string | null>(null);
  const [scanningMount, setScanningMount] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, monitor.LargeFilesResult>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  const physDisks = physicalDisks(disks.data);
  const mounts = mountDisks(disks.data);

  const isCancelRequested = useRef(false);
  const scanTask = useRef<ReturnType<typeof api.collectLargestFiles> | null>(null);
  useEffect(() => {
    setSelectedDisk(null);
    setSelectedMount(null);
    setScanningMount(null);
    setResults({});
    setErrors({});
    return () => {
      const task = scanTask.current;
      scanTask.current = null;
      task?.cancel();
    };
  }, [host]);

  async function scan(mount: string) {
    if (scanTask.current) return;
    isCancelRequested.current = false;
    const task = api.collectLargestFiles(host, mount, LARGE_FILES_LIMIT);
    scanTask.current = task;
    setResults((prev) => {
      const next = { ...prev };
      delete next[mount];
      return next;
    });
    setSelectedMount(mount);
    setScanningMount(mount);
    setErrors((prev) => {
      const next = { ...prev };
      delete next[mount];
      return next;
    });
    try {
      const result = await task;
      if (scanTask.current !== task) return;
      if (!result) throw new Error("扫描未返回结果");
      setResults((prev) => ({ ...prev, [mount]: result }));
    } catch (err) {
      if (scanTask.current !== task) return;
      setErrors((prev) => ({ ...prev, [mount]: isCancelRequested.current ? "扫描已取消" : `扫描失败：${formatErr(err)}` }));
    } finally {
      if (scanTask.current === task) {
        scanTask.current = null;
        setScanningMount(null);
      }
    }
  }

  // 默认展示首个挂载分区；只切换选择，不自动启动扫描。
  const activeDisk = physDisks.find((d) => d.filesystem === selectedDisk);
  const activeMount = activeDisk ? null : mounts.find((d) => d.mount === selectedMount)?.mount || mounts[0]?.mount || null;
  const selectedResult = activeMount ? results[activeMount] : undefined;
  const selectedError = activeMount ? errors[activeMount] : undefined;
  const isSelectedScanning = !!activeMount && scanningMount === activeMount;
  const files = [...(selectedResult?.files || [])].sort((a, b) => b.size - a.size);

  return (
    <Page title="磁盘" onRefresh={async () => { await disks.refetch({ throwOnError: true }); return true; }}>
      {disks.error ? <Notice text={formatErr(disks.error)} /> : null}
      <div className="@container min-h-0 flex-1"><div className="flex min-h-full flex-col gap-6 @min-[720px]:flex-row">
        <aside aria-label="磁盘和分区" className="w-full shrink-0 space-y-6 @min-[720px]:w-[280px] @min-[720px]:border-r @min-[720px]:border-line @min-[720px]:pr-5">
          <section>
            <h2 className="mb-3 text-sm font-semibold">物理磁盘</h2>
            {physDisks.length ? physDisks.map((d) => (
              <button key={d.filesystem} type="button" aria-pressed={selectedDisk === d.filesystem}
                onClick={() => setSelectedDisk(d.filesystem)}
                className={`mb-1 block w-full space-y-2 rounded-control p-3 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-accent ${selectedDisk === d.filesystem ? "bg-accent-soft" : "hover:bg-raised"}`}>
                <span className="flex items-center justify-between gap-3 font-mono"><span className="truncate">{d.mount || d.filesystem}</span><span>{formatBytes(d.total)}</span></span>
                <Meter value={d.percent || 0} className="w-full" />
                <span className="flex flex-wrap justify-between gap-1 text-xs text-muted"><span>已用 {formatBytes(d.used)}</span><span>可用 {formatBytes(d.avail)}</span></span>
              </button>
            )) : <p className="text-sm text-muted">{disks.isLoading ? "加载中…" : "未采集到物理磁盘"}</p>}
          </section>
          <section className="border-t border-line pt-5">
            <h2 className="mb-3 text-sm font-semibold">分区</h2>
            {isDiskFull(disks.data) ? <div className="mb-3"><Notice text={`有分区使用率达到 ${USAGE_DANGER}%`} tone="warning" /></div> : null}
            {mounts.length ? mounts.map((d) => (
              <button key={`${d.mount}-${d.filesystem}`} type="button" aria-pressed={activeMount === d.mount}
                onClick={() => { setSelectedDisk(null); setSelectedMount(d.mount); }}
                className={`mb-1 block w-full space-y-2 rounded-control p-3 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-accent ${activeMount === d.mount ? "bg-accent-soft" : "hover:bg-raised"}`}>
                <span className="flex justify-between gap-3"><span className="truncate font-mono" title={d.mount}>{d.mount || "—"}{d.mount === "/" ? <span className="ml-3 font-sans">根目录</span> : null}</span><span className="text-xs text-muted">{d.fsType || "—"}</span></span>
                <span className="block truncate font-mono text-xs text-muted" title={d.filesystem}>{d.filesystem}</span>
                <span className="block font-mono text-xs">{formatBytes(d.used)} / {formatBytes(d.total)}</span>
                <Meter value={d.percent || 0} className="w-full" />
                {scanningMount === d.mount ? <span className="block text-xs text-accent">扫描中…</span> : errors[d.mount] ? <span className="block text-xs text-muted">{errors[d.mount] === "扫描已取消" ? "扫描已取消" : "扫描失败"}</span> : results[d.mount] ? <span className="block text-xs text-muted">{results[d.mount].incomplete ? "部分结果" : "已扫描"}</span> : null}
              </button>
            )) : <p className="text-sm text-muted">{disks.isLoading ? "加载中…" : "暂无分区数据"}</p>}
          </section>
        </aside>
        <section aria-label="磁盘检查结果" className="min-w-0 flex-1">
          {activeDisk ? (
            <>
              <h2 className="text-sm font-semibold">物理磁盘 <span className="ml-2 font-mono">{activeDisk.mount || activeDisk.filesystem}</span></h2>
              <dl className="mt-5 grid max-w-lg grid-cols-3 gap-4 text-sm">
                <div><dt className="text-xs text-muted">总容量</dt><dd className="mt-2 font-mono">{formatBytes(activeDisk.total)}</dd></div>
                <div><dt className="text-xs text-muted">已用</dt><dd className="mt-2 font-mono">{formatBytes(activeDisk.used)}</dd></div>
                <div><dt className="text-xs text-muted">可用</dt><dd className="mt-2 font-mono">{formatBytes(activeDisk.avail)}</dd></div>
              </dl>
              <p className="mt-6 text-sm text-muted">从左侧选择挂载分区，检查其中的大文件。</p>
            </>
          ) : (
            <>
              <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="text-sm font-semibold">大文件 Top {LARGE_FILES_LIMIT}<span className="ml-3 break-all font-mono font-normal text-muted">{activeMount}</span></h2>
                  <p role="status" className="mt-2 text-xs text-muted">
                    {isSelectedScanning ? "正在扫描，可能需要几十秒…" : selectedError ? selectedError === "扫描已取消" ? "扫描已取消" : "扫描未完成" : selectedResult ? `${selectedResult.incomplete ? "部分结果" : "扫描完成"}　${files.length} 个文件　耗时 ${(selectedResult.elapsedMs / 1000).toFixed(1)} 秒` : activeMount ? "尚未扫描此分区" : "选择挂载分区后开始扫描"}
                  </p>
                </div>
                {isSelectedScanning ? (
                  <Button size="sm" variant="secondary" onClick={() => { isCancelRequested.current = true; scanTask.current?.cancel(); }}>取消扫描</Button>
                ) : (
                  <Button size="sm" variant="primary" disabled={!activeMount || !!scanningMount} onClick={() => activeMount && void scan(activeMount)}>{selectedResult ? "重新扫描" : selectedError ? "重试扫描" : "扫描大文件"}</Button>
                )}
              </div>
              {selectedError && selectedError !== "扫描已取消" ? (
                <div className="mb-4 space-y-2"><Notice text="扫描失败，请查看错误详情后重试。" /><details className="text-xs text-muted"><summary className="cursor-pointer">错误详情</summary><p className="mt-2 whitespace-pre-wrap break-all select-text">{selectedError}</p></details></div>
              ) : null}
              {selectedResult?.incomplete ? <div className="mb-4"><Notice text={selectedResult.message || "扫描超时，结果可能不完整"} tone="warning" /></div> : null}
              {scanningMount && !isSelectedScanning ? <p className="mb-4 text-xs text-muted">正在扫描 {scanningMount}，可切回该分区查看或取消。</p> : null}
              {selectedResult && !isSelectedScanning ? files.length ? (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[580px] table-fixed border-collapse text-left text-sm">
                    <thead className="text-xs text-muted"><tr className="h-table-head border-b border-line">
                      <th className="w-12 px-2 text-center font-semibold">序</th><th className="w-[34%] px-3 font-semibold">文件</th><th className="w-[112px] px-3 text-right font-semibold">大小</th><th className="px-3 font-semibold">位置</th>
                    </tr></thead>
                    <tbody>{files.map((file, index) => (
                      <tr key={file.path} className="h-table-row border-b border-line hover:bg-raised">
                        <td className="px-2 text-center font-mono text-xs text-muted">{index + 1}</td>
                        <td className="px-3"><span className="inline-block max-w-full select-text truncate align-middle" data-tip={file.name} data-tip-overflow="">{file.name}</span></td>
                        <td className="px-3 text-right font-mono tabular-nums">{formatBytes(file.size)}</td>
                        <td className="px-3 font-mono"><span className="inline-block max-w-full select-text truncate align-middle" data-tip={file.path} data-tip-overflow="">{file.dir}</span></td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              ) : <p className="py-8 text-sm text-muted">{selectedResult.message || "没有找到文件"}</p> : !isSelectedScanning && !selectedError ? <p className="border-t border-line py-8 text-sm text-muted">{activeMount ? "扫描此分区，查看占用空间最大的 10 个文件。" : "暂无可扫描的挂载分区。"}</p> : null}
            </>
          )}
        </section>
      </div></div>
    </Page>
  );
}
