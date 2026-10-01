import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "@/api";
import type { monitor } from "@/api";
import { PhysicalDiskRows } from "@/react/components/overview/overview-parts";
import { Notice, Page } from "@/react/components/page";
import { Button } from "@/react/components/ui/button";
import { Meter } from "@/react/components/ui/meter";
import { isDiskFull, mountDisks, physicalDisks } from "@/utils/alerts";
import { USAGE_DANGER } from "@/react/lib/usage-tone";
import { formatBytes, formatErr } from "@/utils/format";

const LARGE_FILES_LIMIT = 10;

export function DiskPage({ host }: { host: string }) {
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

  async function scan(mount: string) {
    if (scanningMount) return;
    setSelectedMount(mount);
    setScanningMount(mount);
    setErrors((prev) => {
      const next = { ...prev };
      delete next[mount];
      return next;
    });
    try {
      const result = await api.collectLargestFiles(host, mount, LARGE_FILES_LIMIT);
      setResults((prev) => ({ ...prev, [mount]: result }));
    } catch (err) {
      setErrors((prev) => ({ ...prev, [mount]: `扫描失败：${formatErr(err)}` }));
    } finally {
      setScanningMount(null);
    }
  }

  const selectedResult = selectedMount ? results[selectedMount] : undefined;
  const selectedError = selectedMount ? errors[selectedMount] : undefined;
  const selectedScanning = !!selectedMount && scanningMount === selectedMount;
  const files = [...(selectedResult?.files || [])].sort((a, b) => b.size - a.size);

  return (
    <Page title="磁盘" onRefresh={() => void disks.refetch()}>
      {disks.error ? <Notice text={formatErr(disks.error)} /> : null}

      <div className="flex flex-col gap-section">
        <section>
          <div className="mb-3 text-sm font-semibold text-ink">物理磁盘</div>
          {physDisks.length ? (
            <PhysicalDiskRows disks={physDisks} />
          ) : (
            <p className="text-sm text-muted">
              {disks.isLoading ? "加载中…" : "未采集到物理磁盘"}
            </p>
          )}
        </section>

        <section>
          <div className="mb-3 text-sm font-semibold text-ink">分区</div>
          {isDiskFull(disks.data) ? (
            <div className="mb-3">
              <Notice text={`有分区使用率达到危险档（≥ ${USAGE_DANGER}%）`} tone="warning" />
            </div>
          ) : null}
          {mounts.length ? (
            <table className="w-full border-collapse text-left text-sm">
              <thead className="text-xs text-muted">
                <tr className="h-table-head border-b border-line">
                  <th className="px-3 font-normal">挂载点</th>
                  <th className="px-3 font-normal">文件系统</th>
                  <th className="px-3 font-normal">类型</th>
                  <th className="px-3 text-right font-normal">已用 / 总量</th>
                  <th className="px-3 font-normal">使用率</th>
                  <th className="px-3 font-normal" aria-label="操作" />
                </tr>
              </thead>
              <tbody>
                {mounts.map((d) => {
                  const mount = d.mount;
                  const selected = mount === selectedMount;
                  let scanLabel = "扫描大文件";
                  if (scanningMount === mount) scanLabel = "扫描中…";
                  else if (results[mount]) scanLabel = "查看结果";
                  return (
                    <tr
                      key={`${d.mount}-${d.filesystem}`}
                      className={`h-table-row border-b border-line ${
                        selected ? "bg-accent-soft" : "hover:bg-raised"
                      }`}
                    >
                      <td className={`px-3 font-mono ${selected ? "text-accent" : ""}`}>
                        {mount || "—"}
                      </td>
                      <td className="max-w-[240px] truncate px-3 font-mono">
                        {d.filesystem || "—"}
                      </td>
                      <td className="px-3">{d.fsType || "—"}</td>
                      <td className="px-3 text-right font-mono tabular-nums">
                        {formatBytes(d.used)} / {formatBytes(d.total)}
                      </td>
                      <td className="w-[240px] px-3">
                        <Meter value={d.percent || 0} className="w-full whitespace-nowrap" />
                      </td>
                      <td className="w-[112px] px-3 text-right">
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={!mount || (!!scanningMount && scanningMount !== mount)}
                          onClick={() => {
                            if (results[mount] && scanningMount !== mount) {
                              setSelectedMount(mount);
                              return;
                            }
                            void scan(mount);
                          }}
                        >
                          {scanLabel}
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <p className="text-sm text-muted">
              {disks.isLoading ? "加载中…" : "暂无分区数据"}
            </p>
          )}
        </section>

        <section>
          <div className="mb-3 flex items-center gap-2">
            <span className="text-sm font-semibold text-ink">
              大文件 Top {LARGE_FILES_LIMIT}
            </span>
            {selectedMount ? (
              <span className="font-mono text-sm text-muted">{selectedMount}</span>
            ) : null}
          </div>
          {!selectedMount ? (
            <p className="text-sm text-muted">在上方分区列表点「扫描大文件」，找出该挂载点下最大的文件。</p>
          ) : null}
          {selectedError ? (
            <div className="mb-3">
              <Notice text={selectedError} />
            </div>
          ) : null}
          {selectedResult?.incomplete ? (
            <div className="mb-3">
              <Notice
                text={selectedResult.message || "扫描超时，结果可能不完整"}
                tone="warning"
              />
            </div>
          ) : null}
          {selectedScanning ? (
            <p className="text-sm text-muted">正在扫描 {selectedMount}，可能需要几十秒…</p>
          ) : null}
          {selectedResult && !selectedScanning ? (
            <>
              {files.length ? (
                <table className="w-full table-fixed border-collapse text-left text-sm">
                  <thead className="text-xs text-muted">
                    <tr className="h-table-head border-b border-line">
                      <th className="w-12 px-2 text-center font-normal">序</th>
                      <th className="w-[112px] px-3 text-right font-normal">大小</th>
                      <th className="w-[30%] px-3 font-normal">文件</th>
                      <th className="px-3 font-normal">位置</th>
                    </tr>
                  </thead>
                  <tbody>
                    {files.map((file, index) => (
                      <tr key={file.path} className="h-table-row border-b border-line hover:bg-raised">
                        <td className="px-2 text-center font-mono text-xs tabular-nums text-muted">
                          {index + 1}
                        </td>
                        <td className="px-3 text-right font-mono tabular-nums">
                          {formatBytes(file.size)}
                        </td>
                        <td className="truncate px-3" data-tip={file.name} data-tip-overflow="">
                          {file.name}
                        </td>
                        <td
                          className="truncate px-3 font-mono"
                          data-tip={file.path}
                          data-tip-overflow=""
                        >
                          {file.dir}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="text-sm text-muted">没有找到文件</p>
              )}
              <div className="mt-2 flex items-center gap-3">
                <span className="text-xs text-muted">
                  共 {files.length} 个，耗时 {(selectedResult.elapsedMs / 1000).toFixed(1)} 秒
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={!!scanningMount}
                  onClick={() => void scan(selectedMount!)}
                >
                  重新扫描
                </Button>
              </div>
            </>
          ) : null}
        </section>
      </div>
    </Page>
  );
}
