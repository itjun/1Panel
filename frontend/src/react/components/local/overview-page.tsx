import { useMemo } from "react";
import type { localsys } from "@/api";
import { Button } from "@/react/components/ui/button";
import { Card } from "@/react/components/ui/card";
import { Notice, Page } from "@/react/components/page";
import { useSession } from "@/react/state/session";
import {
  formatBytes,
  formatBytesSI,
  formatErr,
  formatMemCapacity,
} from "@/utils/format";
import {
  EXTERNAL_DISK_BAR_COLOR,
  INTERNAL_DISK_BAR_COLOR,
  buildDiskGroups,
  buildDiskSummaryItems,
  diskExternalRowLabel,
  diskMountLabel,
  diskMountPercent,
  flattenExternalRows,
  summarizeDiskItems,
} from "./disk-utils";
import { MetricChart, buildLocalLineOption } from "./metric-chart";
import { RingMeter } from "./ring-meter";
import { useLocalMetrics } from "./use-local-metrics";

function formatTemp(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(Number(v))) return "—";
  return `${Number(v).toFixed(0)} °C`;
}

function loadLabel(pct: number): string {
  if (pct < 30) return "运行流畅";
  if (pct < 70) return "运行正常";
  if (pct < 80) return "运行缓慢";
  return "运行堵塞";
}

function CoreMiniGrid({ cores }: { cores: localsys.CPUCoreStat[] | null }) {
  const list = cores || [];
  if (!list.length) return null;
  return (
    <div className="mt-2 grid max-h-40 grid-cols-4 gap-1 overflow-auto">
      {list.map((c) => (
        <div
          key={c.index}
          className="rounded border border-line px-1 py-0.5 text-center font-mono text-[10px]"
          title={`${c.kind || "核"} #${c.index}`}
        >
          {(c.percent || 0).toFixed(0)}%
        </div>
      ))}
    </div>
  );
}

export function LocalOverviewPage() {
  const session = useSession();
  const {
    overview,
    error,
    cpuSeries,
    memSeries,
    ioSeries,
    ioRates,
    memTotalBytes,
    hasCpuClusters,
  } = useLocalMetrics(true);

  const data = overview;
  const loadPct =
    data && data.cpuCount > 0
      ? Math.min(100, ((data.load1 || 0) / data.cpuCount) * 100)
      : 0;

  const diskItems = useMemo(
    () => buildDiskSummaryItems(data?.disks || []),
    [data?.disks],
  );
  const diskSummary = useMemo(() => summarizeDiskItems(diskItems), [diskItems]);
  const diskGroups = useMemo(
    () => buildDiskGroups(data?.disks || []),
    [data?.disks],
  );
  const externalRows = useMemo(
    () => flattenExternalRows(diskGroups.external),
    [diskGroups.external],
  );

  const diskPercent = diskSummary?.percent || 0;
  const diskUsed = diskSummary?.used || 0;
  const diskTotal = diskSummary?.total || 0;

  const tempC =
    data?.tempC != null && Number.isFinite(Number(data.tempC))
      ? Number(data.tempC)
      : null;
  const tempRing = tempC == null ? 0 : Math.max(0, Math.min(100, tempC));
  const tempDanger = (tempC ?? 0) > 90;
  const tempLabel = tempC == null ? "—" : `${tempC.toFixed(0)} °C`;

  const cpuOption = useMemo(() => {
    const series = [
      { name: "全核心", data: cpuSeries.map((p) => p.total) },
    ];
    if (hasCpuClusters) {
      series.push({ name: "性能核", data: cpuSeries.map((p) => p.perf) });
      series.push({ name: "能效核", data: cpuSeries.map((p) => p.eff) });
    }
    return buildLocalLineOption({
      xData: cpuSeries.map((p) => p.time),
      series,
      unit: "percent",
      yMax: 100,
    });
  }, [cpuSeries, hasCpuClusters]);

  const memOption = useMemo(
    () =>
      buildLocalLineOption({
        xData: memSeries.map((p) => p.time),
        series: [
          { name: "物理内存", data: memSeries.map((p) => p.phys) },
          {
            name: "交换内存",
            data: memSeries.map((p) => p.swap),
            yAxisIndex: 1,
          },
        ],
        unit: "bytes",
        markLine: memTotalBytes
          ? {
              name: `物理总量 ${formatBytes(memTotalBytes)}`,
              value: memTotalBytes,
            }
          : undefined,
      }),
    [memSeries, memTotalBytes],
  );

  const ioOption = useMemo(
    () =>
      buildLocalLineOption({
        xData: ioSeries.map((p) => p.time),
        series: [
          { name: "读", data: ioSeries.map((p) => p.read) },
          { name: "写", data: ioSeries.map((p) => p.write) },
        ],
        unit: "kbps",
      }),
    [ioSeries],
  );

  return (
    <Page title="系统概览">
      {error && !data ? <Notice text={formatErr(error)} /> : null}
      {!data ? (
        <p className="text-sm text-muted">加载中…</p>
      ) : (
        <div className="flex flex-col gap-4">
          {/* 状态环图 */}
          <Card>
            <div className="mb-3 font-medium">状态</div>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
              <RingMeter
                title="负载"
                percent={loadPct}
                danger={loadPct > 80}
                caption={loadLabel(loadPct)}
              >
                <div className="local-pop-row">
                  <span>1 分钟</span>
                  <span className="num">{(data.load1 || 0).toFixed(2)}</span>
                </div>
                <div className="local-pop-row">
                  <span>5 分钟</span>
                  <span className="num">{(data.load5 || 0).toFixed(2)}</span>
                </div>
                <div className="local-pop-row">
                  <span>15 分钟</span>
                  <span className="num">{(data.load15 || 0).toFixed(2)}</span>
                </div>
              </RingMeter>

              <RingMeter
                title="CPU"
                percent={data.cpuPercent || 0}
                danger={(data.cpuPercent || 0) > 85}
                caption={
                  (data.perfCores || 0) > 0 || (data.effCores || 0) > 0 ? (
                    <>
                      <div>
                        性能 {data.perfCores || 0} · 能效 {data.effCores || 0} · 共{" "}
                        {data.cpuCount} 核
                      </div>
                      <div>
                        全核心 {(data.cpuPercent || 0).toFixed(1)}% · 性能{" "}
                        {(data.perfCpuPercent || 0).toFixed(1)}% · 能效{" "}
                        {(data.effCpuPercent || 0).toFixed(1)}%
                      </div>
                    </>
                  ) : (
                    `${(data.cpuPercent || 0).toFixed(1)}% / ${data.cpuCount} 核`
                  )
                }
              >
                <div className="local-pop-row">
                  <span>型号</span>
                  <span className="max-w-[240px] truncate">{data.cpuModel || "—"}</span>
                </div>
                <div className="local-pop-row">
                  <span>总核心</span>
                  <span className="num">{data.cpuCount} 核</span>
                </div>
                <div className="local-pop-row">
                  <span>使用率</span>
                  <span className="num">{(data.cpuPercent || 0).toFixed(2)}%</span>
                </div>
                {(data.perfCores || 0) > 0 || (data.effCores || 0) > 0 ? (
                  <>
                    <div className="local-pop-row">
                      <span>性能核</span>
                      <span className="num">
                        {(data.perfCpuPercent || 0).toFixed(1)}% · {data.perfCores} 核
                      </span>
                    </div>
                    <div className="local-pop-row">
                      <span>能效核</span>
                      <span className="num">
                        {(data.effCpuPercent || 0).toFixed(1)}% · {data.effCores} 核
                      </span>
                    </div>
                  </>
                ) : null}
                <CoreMiniGrid cores={data.cpuCores} />
              </RingMeter>

              <RingMeter
                title="内存"
                percent={data.memPercent || 0}
                danger={(data.memPercent || 0) > 90}
                caption={
                  <>
                    <div>
                      物理 {formatBytes(data.memUsed || 0)} /{" "}
                      {formatMemCapacity(data.memTotal || 0)}
                    </div>
                    <div>
                      {(data.swapTotal || 0) > 0
                        ? `交换 ${formatBytes(data.swapUsed || 0)} / ${formatBytes(data.swapTotal || 0)} · ${(data.swapPercent || 0).toFixed(0)}%`
                        : "交换 未启用"}
                    </div>
                  </>
                }
              >
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <div className="mb-1 font-medium">物理内存</div>
                    <div className="local-pop-row">
                      <span>总量</span>
                      <span className="num">{formatMemCapacity(data.memTotal || 0)}</span>
                    </div>
                    <div className="local-pop-row">
                      <span>已用</span>
                      <span className="num">{formatBytes(data.memUsed || 0)}</span>
                    </div>
                    <div className="local-pop-row">
                      <span>可用</span>
                      <span className="num">
                        {formatBytes((data.memTotal || 0) - (data.memUsed || 0))}
                      </span>
                    </div>
                    <div className="local-pop-row">
                      <span>使用率</span>
                      <span className="num">{(data.memPercent || 0).toFixed(2)}%</span>
                    </div>
                  </div>
                  {(data.swapTotal || 0) > 0 ? (
                    <div>
                      <div className="mb-1 font-medium">交换内存</div>
                      <div className="local-pop-row">
                        <span>总量</span>
                        <span className="num">{formatBytes(data.swapTotal || 0)}</span>
                      </div>
                      <div className="local-pop-row">
                        <span>已用</span>
                        <span className="num">{formatBytes(data.swapUsed || 0)}</span>
                      </div>
                      <div className="local-pop-row">
                        <span>使用率</span>
                        <span className="num">{(data.swapPercent || 0).toFixed(2)}%</span>
                      </div>
                    </div>
                  ) : null}
                </div>
              </RingMeter>

              <RingMeter
                title="磁盘"
                percent={diskPercent}
                danger={diskPercent > 90}
                caption={`${formatBytesSI(diskUsed)} / ${formatBytesSI(diskTotal)}`}
              >
                {diskItems.length ? (
                  <div className="grid max-w-[420px] gap-2 sm:grid-cols-2">
                    {diskItems.map((item) => (
                      <div key={item.key}>
                        <div className="mb-1 flex justify-between gap-2">
                          <span className="max-w-[140px] truncate">{item.label}</span>
                          <span className="num">{item.percent.toFixed(0)}%</span>
                        </div>
                        <div className="local-disk-bar">
                          <i
                            style={{
                              width: `${Math.min(100, Math.max(0, item.percent))}%`,
                              background:
                                item.percent > 90 ? "#d64545" : INTERNAL_DISK_BAR_COLOR,
                            }}
                          />
                        </div>
                        <div className="mt-1 flex justify-between text-[10px] text-muted">
                          <span>{formatBytesSI(item.used)} 已用</span>
                          <span>{formatBytesSI(item.avail)} 可用</span>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <span className="text-muted">无磁盘数据</span>
                )}
                {diskItems.length > 1 ? (
                  <div className="mt-2 border-t border-line pt-2 text-muted">
                    {diskItems.length} 块合计 {formatBytesSI(diskUsed)} /{" "}
                    {formatBytesSI(diskTotal)} · {diskPercent.toFixed(1)}%
                  </div>
                ) : null}
              </RingMeter>

              <RingMeter
                title="温度"
                percent={tempRing}
                danger={tempDanger}
                caption={tempLabel}
              >
                <div className="local-pop-row">
                  <span>综合</span>
                  <span className="num">{tempLabel}</span>
                </div>
                <div className="local-pop-row">
                  <span>CPU</span>
                  <span className="num">{formatTemp(data.cpuTempC)}</span>
                </div>
                <div className="local-pop-row">
                  <span>GPU</span>
                  <span className="num">{formatTemp(data.gpuTempC)}</span>
                </div>
              </RingMeter>
            </div>
          </Card>

          {/* 磁盘分区：本机 / 外置 */}
          <Card>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <span className="font-medium">磁盘分区</span>
              {diskGroups.overflow > 0 ? (
                <span className="text-xs text-muted">
                  外置另有 {diskGroups.overflow} 块未显示
                </span>
              ) : null}
              <Button
                className="ml-auto"
                size="sm"
                variant="ghost"
                onClick={() => session.setLocalSection("storage")}
              >
                查看占用
              </Button>
            </div>
            {!diskGroups.internal.length && !externalRows.length ? (
              <p className="text-sm text-muted">无磁盘数据</p>
            ) : (
              <div className="flex flex-col gap-4">
                {diskGroups.internal.length ? (
                  <div>
                    <div className="mb-2 text-sm text-muted">本机磁盘</div>
                    <div className="flex flex-col gap-3">
                      {diskGroups.internal.map((g) =>
                        g.partitions.map((d) => {
                          const pct = diskMountPercent(d);
                          return (
                            <div key={d.mount || d.device}>
                              <div className="mb-1 flex justify-between gap-2 text-sm">
                                <span className="truncate" title={d.mount}>
                                  {diskMountLabel(d)}
                                </span>
                                <span className="shrink-0 font-mono text-muted">
                                  {formatBytesSI(d.used || 0)} /{" "}
                                  {formatBytesSI(d.total || 0)}
                                </span>
                              </div>
                              <div className="local-disk-bar">
                                <i
                                  style={{
                                    width: `${pct}%`,
                                    background:
                                      pct > 90 ? "#d64545" : INTERNAL_DISK_BAR_COLOR,
                                  }}
                                />
                              </div>
                            </div>
                          );
                        }),
                      )}
                    </div>
                  </div>
                ) : null}
                {externalRows.length ? (
                  <div>
                    <div className="mb-2 text-sm text-muted">外置磁盘</div>
                    <div className="flex flex-col gap-3">
                      {externalRows.map((d) => {
                        const pct = diskMountPercent(d);
                        return (
                          <div key={d.mount || d.device}>
                            <div className="mb-1 flex justify-between gap-2 text-sm">
                              <span className="truncate" title={d.mount}>
                                {diskExternalRowLabel(d)}
                              </span>
                              <span className="shrink-0 font-mono text-muted">
                                {formatBytesSI(d.used || 0)} /{" "}
                                {formatBytesSI(d.total || 0)}
                              </span>
                            </div>
                            <div className="local-disk-bar">
                              <i
                                style={{
                                  width: `${pct}%`,
                                  background:
                                    pct > 90 ? "#d64545" : EXTERNAL_DISK_BAR_COLOR,
                                }}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : null}
              </div>
            )}
          </Card>

          {/* CPU / 内存曲线 */}
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className="font-medium">CPU</span>
                <span className="rounded border border-line px-1.5 py-0.5 text-xs">
                  全核心 {(data.cpuPercent || 0).toFixed(1)}%
                </span>
                {hasCpuClusters ? (
                  <>
                    <span className="rounded border border-line px-1.5 py-0.5 text-xs">
                      性能 {(data.perfCpuPercent || 0).toFixed(1)}%
                    </span>
                    <span className="rounded border border-line px-1.5 py-0.5 text-xs">
                      能效 {(data.effCpuPercent || 0).toFixed(1)}%
                    </span>
                  </>
                ) : null}
              </div>
              <MetricChart option={cpuOption} height={220} />
            </Card>
            <Card>
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className="font-medium">内存</span>
                <span className="rounded border border-line px-1.5 py-0.5 text-xs">
                  物理 {formatBytes(data.memUsed || 0)} /{" "}
                  {formatMemCapacity(data.memTotal || 0)}
                </span>
                <span className="rounded border border-line px-1.5 py-0.5 text-xs">
                  {(data.swapTotal || 0) > 0
                    ? `交换 ${formatBytes(data.swapUsed || 0)} / ${formatBytes(data.swapTotal || 0)}`
                    : "交换 未启用"}
                </span>
              </div>
              <MetricChart option={memOption} height={220} />
            </Card>
          </div>

          <Card>
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <span className="font-medium">磁盘 IO</span>
              <span className="rounded border border-line px-1.5 py-0.5 text-xs">
                读 {formatBytes(ioRates.readBps)}/s
              </span>
              <span className="rounded border border-line px-1.5 py-0.5 text-xs">
                写 {formatBytes(ioRates.writeBps)}/s
              </span>
            </div>
            <MetricChart option={ioOption} height={220} />
          </Card>
        </div>
      )}
    </Page>
  );
}
