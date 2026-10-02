import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { api, type localsys, type monitor } from "@/api";
import { Button } from "@/react/components/ui/button";
import { Meter } from "@/react/components/ui/meter";
import { Tag } from "@/react/components/ui/tag";
import { Notice, Page } from "@/react/components/page";
import {
  OverviewFact,
  OverviewTable,
  PhysicalDiskRows,
} from "@/react/components/overview/overview-parts";
import { useSession } from "@/react/state/session";
import {
  formatBytes,
  formatDurationLong,
  formatErr,
  formatMemCapacity,
} from "@/utils/format";
import {
  buildDiskGroups,
  buildDiskSummaryItems,
  diskMountPercent,
  flattenExternalRows,
  summarizeDiskItems,
} from "./disk-utils";
import { RingMeter } from "./ring-meter";
import { refreshLocalMetrics, useLocalMetrics } from "./use-local-metrics";

const VIRTUAL_IFACE_FOLD = 3;

const IFACE_KIND_LABEL: Record<string, string> = {
  wifi: "无线",
  ethernet: "有线",
  thunderbolt: "雷雳 / 网桥",
  vpn: "VPN",
  other: "其它",
};

function loadWord(pct: number): string {
  if (pct < 30) return "运行流畅";
  if (pct < 70) return "运行正常";
  if (pct < 80) return "运行缓慢";
  return "运行堵塞";
}

function formatTemp(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(Number(v))) return "—";
  return `${Number(v).toFixed(0)} °C`;
}

function isVirtualIface(iface: localsys.NetInterface): boolean {
  return iface.kind !== "wifi" && iface.kind !== "ethernet" && iface.kind !== "thunderbolt";
}

export function LocalOverviewPage() {
  const session = useSession();
  const [showAllIfaces, setShowAllIfaces] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const { overview: data, error } = useLocalMetrics();
  // 与网络页共用缓存键，切页不重复请求
  const network = useQuery({
    queryKey: ["local-net"],
    queryFn: () => api.localSysNetwork(),
    refetchInterval: 20000,
  });

  const diskItems = useMemo(() => buildDiskSummaryItems(data?.disks || []), [data?.disks]);
  const diskSummary = useMemo(() => summarizeDiskItems(diskItems), [diskItems]);
  const diskGroups = useMemo(() => buildDiskGroups(data?.disks || []), [data?.disks]);

  const physDisks: monitor.DiskInfo[] = diskItems.map((item) => ({
    filesystem: item.key,
    mount: item.label,
    fsType: "",
    total: item.total,
    used: item.used,
    avail: item.avail,
    percent: item.percent,
    kind: "disk",
  }));
  const partitions: localsys.DiskInfo[] = [
    ...diskGroups.internal.flatMap((g) => g.partitions),
    ...flattenExternalRows(diskGroups.external),
  ];

  const allIfaces = network.data?.interfaces || [];
  const mainIfaces = allIfaces.filter((iface) => !isVirtualIface(iface));
  const virtualIfaces = allIfaces.filter((iface) => isVirtualIface(iface));
  let shownIfaces = [...mainIfaces, ...virtualIfaces];
  let hiddenIfaceCount = 0;
  if (virtualIfaces.length > VIRTUAL_IFACE_FOLD && !showAllIfaces) {
    shownIfaces = mainIfaces;
    hiddenIfaceCount = virtualIfaces.length;
  }

  let privateIpText = "—";
  if (network.data?.privateIPs?.length) {
    privateIpText = network.data.privateIPs.join(", ");
  } else if (data?.ipAddress) {
    privateIpText = data.ipAddress;
  }

  let loadPercent = 0;
  if (data && data.cpuCount > 0) {
    loadPercent = Math.min(100, ((data.load1 || 0) / data.cpuCount) * 100);
  }

  let swapText = "未启用";
  if (data && (data.swapTotal || 0) > 0) {
    swapText = `${formatBytes(data.swapUsed || 0)} / ${formatBytes(data.swapTotal || 0)}`;
  }

  let coresText = "—";
  if (data) {
    coresText = `${data.cpuCount} 核`;
    if ((data.perfCores || 0) > 0 || (data.effCores || 0) > 0) {
      coresText = `${data.cpuCount} 核（性能 ${data.perfCores || 0} · 能效 ${data.effCores || 0}）`;
    }
  }

  let osText = "未知系统";
  if (data?.productVer) {
    osText = `${data.productName || ""} ${data.productVer}`.trim();
  } else if (data?.osRelease) {
    osText = data.osRelease;
  }

  let diskScopeText = "";
  if (diskSummary) {
    if (diskItems[0]?.scope === "disk") {
      diskScopeText = `${diskSummary.count} 块物理硬盘`;
    } else {
      diskScopeText = `${diskSummary.count} 个分区`;
    }
  }

  async function refreshAll() {
    setRefreshing(true);
    try {
      await Promise.all([refreshLocalMetrics(), network.refetch()]);
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <Page title="概览" onRefresh={() => refreshAll()} refreshing={refreshing}>
      {error && !data ? <Notice text={formatErr(error)} /> : null}

      <div className="flex flex-col gap-section">
        {data ? (
          <section>
            <div className="mb-3 text-sm font-semibold text-ink">系统</div>
            <div className="min-w-0">
              <div className="truncate text-base font-semibold text-ink">
                {data.hostname || "本机"}
              </div>
              <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
                <span>{osText}</span>
                <span>
                  内核 <span className="font-mono">{data.kernel || "—"}</span>
                </span>
                {data.arch ? <span className="font-mono">{data.arch}</span> : null}
                <span>已运行 {formatDurationLong(data.uptime)}</span>
              </div>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
              <OverviewFact label="CPU 型号" className="col-span-2">
                {data.cpuModel || "—"}
              </OverviewFact>
              <OverviewFact label="CPU 核心" mono>{coresText}</OverviewFact>
              <OverviewFact label="内存" mono>{formatMemCapacity(data.memTotal || 0)}</OverviewFact>
              <OverviewFact label="Swap" mono>{swapText}</OverviewFact>
              <OverviewFact label="温度" mono>{formatTemp(data.tempC)}</OverviewFact>
              <OverviewFact label="机型" mono>{data.modelName || "—"}</OverviewFact>
            </div>
          </section>
        ) : null}

        {data ? (
          <section>
            <div className="mb-3 text-sm font-semibold text-ink">资源</div>
            <div className="grid grid-cols-2 gap-card md:grid-cols-4">
              <RingMeter
                title="负载"
                percent={loadPercent}
                danger={loadPercent > 80}
                center={(data.load1 || 0).toFixed(2)}
                caption={
                  <>
                    <div className="font-mono tabular-nums">
                      {(data.load1 || 0).toFixed(2)} / {data.cpuCount} 核
                    </div>
                    <div>{loadWord(loadPercent)}</div>
                  </>
                }
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
                center={`${(data.cpuPercent || 0).toFixed(1)}%`}
                caption={
                  <>
                    <div className="font-mono tabular-nums">
                      {(data.cpuPercent || 0).toFixed(1)}% / {data.cpuCount} 核
                    </div>
                    <div className="max-w-[200px] truncate">{data.cpuModel || "—"}</div>
                  </>
                }
              >
                <div className="local-pop-row">
                  <span>型号</span>
                  <span className="max-w-[200px] truncate">{data.cpuModel || "—"}</span>
                </div>
                <div className="local-pop-row">
                  <span>核心数</span>
                  <span className="num">{coresText}</span>
                </div>
                <div className="local-pop-row">
                  <span>使用率</span>
                  <span className="num">{(data.cpuPercent || 0).toFixed(2)}%</span>
                </div>
                {(data.perfCores || 0) > 0 ? (
                  <div className="local-pop-row">
                    <span>性能核</span>
                    <span className="num">{(data.perfCpuPercent || 0).toFixed(1)}%</span>
                  </div>
                ) : null}
                {(data.effCores || 0) > 0 ? (
                  <div className="local-pop-row">
                    <span>能效核</span>
                    <span className="num">{(data.effCpuPercent || 0).toFixed(1)}%</span>
                  </div>
                ) : null}
              </RingMeter>

              <RingMeter
                title="内存"
                percent={data.memPercent || 0}
                danger={(data.memPercent || 0) > 90}
                center={`${(data.memPercent || 0).toFixed(1)}%`}
                caption={
                  <>
                    <div className="font-mono tabular-nums">
                      {formatBytes(data.memUsed || 0)} / {formatMemCapacity(data.memTotal || 0)}
                    </div>
                    <div>Swap {swapText}</div>
                  </>
                }
              >
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
                    {formatBytes(Math.max(0, (data.memTotal || 0) - (data.memUsed || 0)))}
                  </span>
                </div>
                <div className="local-pop-row">
                  <span>使用率</span>
                  <span className="num">{(data.memPercent || 0).toFixed(2)}%</span>
                </div>
                <div className="local-pop-row">
                  <span>Swap</span>
                  <span className="num">
                    {(data.swapTotal || 0) > 0
                      ? `${swapText} · ${(data.swapPercent || 0).toFixed(1)}%`
                      : "未启用"}
                  </span>
                </div>
              </RingMeter>

              <RingMeter
                title="磁盘"
                percent={diskSummary?.percent || 0}
                danger={(diskSummary?.percent || 0) > 90}
                center={diskSummary ? `${diskSummary.percent.toFixed(1)}%` : "—"}
                caption={
                  diskSummary ? (
                    <>
                      <div className="font-mono tabular-nums">
                        {formatBytes(diskSummary.used)} / {formatBytes(diskSummary.total)}
                      </div>
                      <div>{diskScopeText}</div>
                    </>
                  ) : (
                    "暂无磁盘数据"
                  )
                }
              >
                <div className="local-pop-row">
                  <span>范围</span>
                  <span className="num">{diskScopeText || "—"}</span>
                </div>
                <div className="local-pop-row">
                  <span>总量</span>
                  <span className="num">{formatBytes(diskSummary?.total || 0)}</span>
                </div>
                <div className="local-pop-row">
                  <span>已用</span>
                  <span className="num">{formatBytes(diskSummary?.used || 0)}</span>
                </div>
                <div className="local-pop-row">
                  <span>可用</span>
                  <span className="num">{formatBytes(diskSummary?.avail || 0)}</span>
                </div>
              </RingMeter>
            </div>
          </section>
        ) : null}

        {data ? (
          <section>
            <div className="mb-3 flex items-center gap-2">
              <span className="text-sm font-semibold text-ink">磁盘</span>
              <Button size="sm" variant="ghost" onClick={() => session.setLocalSection("storage")}>
                查看占用
              </Button>
            </div>
            {!physDisks.length && !partitions.length ? (
              <p className="text-sm text-muted">暂无磁盘数据</p>
            ) : null}
            {physDisks.length ? (
              <div className="mb-4">
                <div className="mb-1 text-xs text-muted">物理磁盘</div>
                <PhysicalDiskRows disks={physDisks} />
              </div>
            ) : null}
            {partitions.length ? (
              <div>
                <div className="mb-1 text-xs text-muted">分区</div>
                <OverviewTable
                  columns={[
                    { key: "mount", label: "挂载点" },
                    { key: "fs", label: "设备" },
                    { key: "type", label: "类型" },
                    { key: "used", label: "已用 / 总量", align: "right" },
                    { key: "pct", label: "使用率" },
                  ]}
                  rows={partitions.map((d) => ({
                    id: `${d.mount}-${d.device || d.filesystem}`,
                    cells: [
                      <span key="mount" className="font-mono">
                        {d.name ? (
                          <>
                            {d.name} <span className="text-muted">{d.mount}</span>
                          </>
                        ) : (
                          d.mount || "—"
                        )}
                      </span>,
                      <span key="fs" className="font-mono">{d.device || d.filesystem || "—"}</span>,
                      d.fsType || "—",
                      `${formatBytes(d.used || 0)} / ${formatBytes(d.total || 0)}`,
                      <Meter key="pct" value={diskMountPercent(d)} className="w-full whitespace-nowrap" />,
                    ],
                  }))}
                />
                {diskGroups.overflow > 0 ? (
                  <p className="mt-2 text-xs text-muted">
                    外置另有 {diskGroups.overflow} 块未显示
                  </p>
                ) : null}
              </div>
            ) : null}
          </section>
        ) : null}

        <section>
          <div className="mb-3 text-sm font-semibold text-ink">网络</div>
          {network.data ? (
            <>
              <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                <OverviewFact label="内网 IP" mono>{privateIpText}</OverviewFact>
                <OverviewFact label="出口公网" mono>{data?.publicIP || "—"}</OverviewFact>
                <OverviewFact label="默认网关" mono>
                  {network.data.defaultGateway || "—"}
                </OverviewFact>
                <OverviewFact label="主网卡" mono>{network.data.primaryIface || "—"}</OverviewFact>
              </div>
              {shownIfaces.length ? (
                <div className="mt-4">
                  <div className="mb-1 text-xs text-muted">网卡</div>
                  <OverviewTable
                    columns={[
                      { key: "name", label: "名称" },
                      { key: "kind", label: "类型" },
                      { key: "state", label: "状态" },
                      { key: "ipv4", label: "IPv4" },
                      { key: "mac", label: "MAC" },
                      { key: "rx", label: "接收", align: "right" },
                      { key: "tx", label: "发送", align: "right" },
                    ]}
                    rows={shownIfaces.map((iface) => ({
                      id: iface.name,
                      cells: [
                        <span key="name" className="font-mono">{iface.name}</span>,
                        IFACE_KIND_LABEL[iface.kind || "other"] || iface.kind || "—",
                        <Tag key="state" tone={iface.state === "up" ? "ok" : "neutral"}>
                          {iface.state || "—"}
                        </Tag>,
                        <span key="ipv4" className="font-mono">{iface.ipv4 || "—"}</span>,
                        <span key="mac" className="font-mono">{iface.mac || "—"}</span>,
                        formatBytes(iface.rxBytes),
                        formatBytes(iface.txBytes),
                      ],
                    }))}
                  />
                </div>
              ) : null}
              {virtualIfaces.length > VIRTUAL_IFACE_FOLD ? (
                <Button
                  size="sm"
                  variant="ghost"
                  className="mt-2"
                  onClick={() => setShowAllIfaces((prev) => !prev)}
                >
                  {hiddenIfaceCount > 0
                    ? `显示另外 ${hiddenIfaceCount} 个虚拟网卡`
                    : "收起虚拟网卡"}
                </Button>
              ) : null}
            </>
          ) : (
            <p className="text-sm text-muted">
              {network.isLoading ? "加载中…" : "暂无网络数据"}
            </p>
          )}
        </section>
      </div>

      {!data && !error ? <p className="text-sm text-muted">加载中…</p> : null}
    </Page>
  );
}
