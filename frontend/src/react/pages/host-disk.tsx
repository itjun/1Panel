import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { api } from "@/api";
import type { monitor } from "@/api";
import { FileSearch } from "lucide-react";
import { Notice, Page } from "@/react/components/page";
import { Button } from "@/react/components/ui/button";
import { PhysicalDiskRows } from "@/react/components/overview/overview-parts";
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
  const [selectedMount, setSelectedMount] = useState<string | null>(null);
  const [scanningMount, setScanningMount] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, monitor.LargeFilesResult>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  const physDisks = physicalDisks(disks.data);
  const mounts = mountDisks(disks.data);

  const isCancelRequested = useRef(false);
  const scanTask = useRef<ReturnType<typeof api.collectLargestFiles> | null>(null);
  useEffect(() => {
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
  const activeMount = mounts.find((d) => d.mount === selectedMount)?.mount || mounts[0]?.mount || null;
  const selectedResult = activeMount ? results[activeMount] : undefined;
  const selectedError = activeMount ? errors[activeMount] : undefined;
  const isSelectedScanning = !!activeMount && scanningMount === activeMount;
  const files = [...(selectedResult?.files || [])].sort((a, b) => b.size - a.size);

  return (
    <Page title="磁盘" onRefresh={async () => { await disks.refetch({ throwOnError: true }); return true; }}>
      {disks.error ? <Notice text={formatErr(disks.error)} /> : null}
      <div className="flex flex-col gap-section">
        <section aria-label="物理磁盘">
          <h2 className="mb-3 text-sm font-semibold">物理磁盘</h2>
          {physDisks.length ? <PhysicalDiskRows disks={physDisks} /> : <p className="text-sm text-muted">{disks.isLoading ? "加载中…" : "未采集到物理磁盘"}</p>}
        </section>
        <section aria-label="分区">
          <h2 className="mb-3 text-sm font-semibold">分区</h2>
          {isDiskFull(disks.data) ? <Notice text={`有分区使用率达到 ${USAGE_DANGER}%`} tone="warning" /> : null}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse text-left text-sm">
              <thead className="text-xs text-muted"><tr className="h-table-head border-b border-line">
                <th className="px-3">挂载点</th><th className="px-3">设备</th><th className="px-3">类型</th>
                <th className="px-3 text-right">已用 / 总量</th><th className="w-56 px-3">使用率</th><th className="w-32 px-3 text-right">操作</th>
              </tr></thead>
              <tbody>{mounts.map((d) => (
                <tr key={`${d.mount}-${d.filesystem}`} className={`h-table-row border-b border-line ${activeMount === d.mount ? "bg-accent-tint" : "hover:bg-raised"}`}>
                  <td className="px-3 py-2">
                    <button type="button" aria-pressed={activeMount === d.mount} className="max-w-64 truncate text-left font-mono text-accent" title={d.mount} onClick={() => setSelectedMount(d.mount)}>
                      {d.mount || "—"}{d.mount === "/" ? <span className="ml-2 font-sans text-ink">根目录</span> : null}
                    </button>
                    <div className="text-xs text-muted">{scanningMount === d.mount ? "扫描中…" : errors[d.mount] ? errors[d.mount] === "扫描已取消" ? "扫描已取消" : "扫描失败" : results[d.mount] ? results[d.mount].incomplete ? "部分结果" : "扫描完成" : "尚未扫描"}</div>
                  </td>
                  <td className="px-3 font-mono">{d.filesystem}</td><td className="px-3">{d.fsType || "—"}</td>
                  <td className="whitespace-nowrap px-3 text-right font-mono">{formatBytes(d.used)} / {formatBytes(d.total)}</td>
                  <td className="px-3"><Meter value={d.percent ?? Number.NaN} className="w-full" /></td>
                  <td className="px-3 text-right">{scanningMount === d.mount ? (
                    <Button size="sm" onClick={(event) => { if (event.detail > 1 || isCancelRequested.current) return; isCancelRequested.current = true; scanTask.current?.cancel(); }}>取消扫描</Button>
                  ) : (
                    <Button size="sm" variant="primary" disabled={!!scanningMount} onClick={() => void scan(d.mount)}>{results[d.mount] ? "重新扫描" : errors[d.mount] ? "重试扫描" : "扫描大文件"}</Button>
                  )}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          {!mounts.length ? <p className="py-4 text-sm text-muted">{disks.isLoading ? "加载中…" : "暂无分区数据"}</p> : null}
        </section>
        <section aria-label="磁盘检查结果" className="min-w-0 border-t border-line pt-5">
          <div className="mb-4 flex flex-wrap items-baseline justify-between gap-3">
            <h2 className="text-sm font-semibold">大文件 Top {LARGE_FILES_LIMIT}<span className="ml-3 font-normal text-muted">当前分区 <span className="font-mono">{activeMount || "—"}</span></span></h2>
            <p role="status" className="text-xs text-muted">
              {isSelectedScanning ? "正在扫描，可能需要几十秒…" : selectedError ? selectedError === "扫描已取消" ? "扫描已取消" : "扫描未完成" : selectedResult ? `${selectedResult.incomplete ? "部分结果" : "扫描完成"}　${files.length} 个文件　耗时 ${(selectedResult.elapsedMs / 1000).toFixed(1)} 秒` : "尚未扫描此分区"}
            </p>
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
                      <th className="w-12 px-2 text-center font-semibold">序</th><th className="px-3 font-semibold">文件路径</th><th className="w-32 px-3 text-right font-semibold">大小</th>
                    </tr></thead>
                    <tbody>{files.map((file, index) => (
                      <tr key={file.path} className="h-table-row border-b border-line hover:bg-raised">
                        <td className="px-2 text-center font-mono text-xs text-muted">{index + 1}</td>
                        <td className="px-3 font-mono"><span className="inline-block max-w-full select-text truncate align-middle" data-tip={file.path} data-tip-overflow="">{file.path}</span></td>
                        <td className="px-3 text-right font-mono tabular-nums">{formatBytes(file.size)}</td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              ) : <p className="py-8 text-sm text-muted">{selectedResult.message || "没有找到文件"}</p> : !isSelectedScanning && !selectedError ? <div className="flex min-h-48 flex-col items-center justify-center gap-3 text-sm text-muted"><FileSearch aria-hidden className="size-8" /><p>{activeMount ? "点击分区后的扫描按钮，查看占用空间最大的 10 个文件。" : "暂无可扫描的挂载分区。"}</p></div> : null}
        </section>
      </div>
    </Page>
  );
}
