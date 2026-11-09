import { useQuery } from "@tanstack/react-query";
import { Cable, Cpu, HardDrive, Laptop, MemoryStick, Network, ShieldCheck, Thermometer, Wifi } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { api } from "@/api";
import { ResourceRing } from "@/react/components/ui/resource-ring";
import { Tag } from "@/react/components/ui/tag";
import { Notice, Page } from "@/react/components/page";
import { TextCopy } from "@/react/components/text-reader";
import { formatBytes, formatDurationLong, formatErr, formatMemCapacity } from "@/utils/format";
import { buildDiskSummaryItems, diskParentOf, formatLocalDiskInfo, summarizeDiskItems } from "./disk-utils";
import { DetailFact, OverviewDetails } from "./overview-details";
import { refreshLocalMetrics, useLocalMetrics } from "./use-local-metrics";
import "./overview-page.css";

const IFACE_KIND_LABEL: Record<string, string> = {
  wifi: "Wi-Fi", ethernet: "有线", thunderbolt: "雷雳 / 网桥", vpn: "VPN", other: "其它",
};

function percentText(value: number | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? `${value.toFixed(1)}%` : "—";
}

function formatTemp(value: number | null | undefined) {
  return value != null && Number.isFinite(value) ? `${value.toFixed(0)} °C` : "—";
}

// 与本机传感器采集范围一致；缺失值、0 和异常值都不作为有效读数。
function validTemp(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 && value <= 120 ? value : undefined;
}

export function LocalOverviewPage() {
  const [isRefreshing, setIsRefreshing] = useState(false);
  const isRefreshPending = useRef(false);
  const { overview: data, error } = useLocalMetrics();
  const network = useQuery({
    queryKey: ["local-net"],
    queryFn: () => api.localSysNetwork(),
    refetchInterval: 20000,
  });
  const diskItems = useMemo(() => buildDiskSummaryItems(data?.disks || []), [data?.disks]);
  const diskSummary = useMemo(() => summarizeDiskItems(diskItems), [diskItems]);
  const disks = data?.disks || [];
  const mounts = disks.filter(disk => disk.kind !== "disk");
  const diskLabel = diskItems.length === 1
    ? mounts.find(disk => disk.mount === "/")?.name || diskItems[0].label
    : `${diskItems.length} ${diskItems[0]?.scope === "disk" ? "块磁盘" : "个分区"}`;
  const allIfaces = network.data?.interfaces || [];
  const shownIfaces = [...allIfaces].sort((a, b) =>
    Number(b.name === network.data?.primaryIface) - Number(a.name === network.data?.primaryIface)
    || Number(!!b.ipv4) - Number(!!a.ipv4)
    || Number(b.state === "up") - Number(a.state === "up")
    || a.name.localeCompare(b.name)
  ).slice(0, 3);
  const osText = data?.productVer ? `${data.productName || ""} ${data.productVer}`.trim() : data?.osRelease || "未知系统";
  const coresText = data ? `${data.cpuCount} 核${data.perfCores || data.effCores ? `（性能 ${data.perfCores || 0}，能效 ${data.effCores || 0}）` : ""}` : "—";
  const swapText = data?.swapTotal ? `${formatBytes(data.swapUsed || 0)} / ${formatBytes(data.swapTotal)}` : "未启用";
  const cpuTemp = validTemp(data?.cpuTempC);
  const gpuTemp = validTemp(data?.gpuTempC);
  const temperature = validTemp(data?.tempC) ?? cpuTemp ?? gpuTemp;
  const isTemperatureKnown = temperature !== undefined;

  async function refreshAll() {
    if (isRefreshPending.current) return;
    isRefreshPending.current = true;
    setIsRefreshing(true);
    try {
      await Promise.all([refreshLocalMetrics(), network.refetch({ throwOnError: true })]);
      return true;
    } finally {
      isRefreshPending.current = false;
      setIsRefreshing(false);
    }
  }

  return <Page title="系统概览" heading={false} onRefresh={refreshAll} refreshing={isRefreshing}>
    <div className="local-summary">
      <div className="local-summary-heading drag-region"><h1>系统概览</h1></div>
      {error ? <Notice tone={data ? "warning" : "error"} text={`${data ? "采集更新失败，以下为最后已知读数：" : ""}${formatErr(error)}`} /> : null}
      {data ? <>
        <header className="local-summary-identity">
          <OverviewDetails label="本机设备详情" className="local-summary-device" trigger={<Laptop size={40} strokeWidth={1.5} aria-hidden />}>
            <h2><Laptop size={20} aria-hidden />本机设备</h2>
            <p>{data.hostname || "本机"}</p>
            <dl>
              <DetailFact label="系统">{osText}</DetailFact>
              <DetailFact label="内核">{data.kernel || "—"}</DetailFact>
              <DetailFact label="架构">{data.arch || "—"}</DetailFact>
              <DetailFact label="机型">{data.modelName || "—"}</DetailFact>
              <DetailFact label="CPU 核心">{coresText}</DetailFact>
              <DetailFact label="内存">{formatMemCapacity(data.memTotal || 0)}</DetailFact>
              <DetailFact label="已运行">{formatDurationLong(data.uptime)}</DetailFact>
            </dl>
          </OverviewDetails>
          <div className="local-summary-host">
            <h2>{data.hostname || "本机"}</h2>
            <p>{osText}<span>{data.cpuModel || "—"} / {data.cpuCount} 核</span></p>
          </div>
          <p className="local-summary-uptime">已运行 {formatDurationLong(data.uptime < 60 ? data.uptime : Math.floor(data.uptime / 60) * 60).replace(/ 0秒$/, "")}</p>
        </header>

        <section className={`local-summary-resources${isTemperatureKnown ? " has-temperature" : ""}`} aria-label="资源状态">
          <article className="local-summary-resource">
            <OverviewDetails label="CPU 详情" trigger={<ResourceRing value={data.cpuPercent} label="CPU" valueText={percentText(data.cpuPercent)}><strong>{percentText(data.cpuPercent)}</strong><span>CPU</span></ResourceRing>}>
              <h2><Cpu size={20} aria-hidden />CPU</h2>
              <p>{data.cpuModel || "—"}</p>
              <dl>
                <DetailFact label="核心">{coresText}</DetailFact>
                <DetailFact label="使用率">{percentText(data.cpuPercent)}</DetailFact>
                {data.perfCores ? <DetailFact label="性能核">{percentText(data.perfCpuPercent)}</DetailFact> : null}
                {data.effCores ? <DetailFact label="能效核">{percentText(data.effCpuPercent)}</DetailFact> : null}
                <DetailFact label="负载（1 / 5 / 15 分钟）">{[data.load1, data.load5, data.load15].map(value => value?.toFixed(2) ?? "—").join(" / ")}</DetailFact>
              </dl>
            </OverviewDetails>
            <p>{data.cpuModel || "—"} / {data.cpuCount} 核</p>
            <p className="local-summary-secondary">负载 {data.load1?.toFixed(2) ?? "—"}</p>
          </article>
          <article className="local-summary-resource">
            <OverviewDetails label="内存详情" trigger={<ResourceRing value={data.memPercent} label="内存" valueText={percentText(data.memPercent)}><strong>{percentText(data.memPercent)}</strong><span>内存</span></ResourceRing>}>
              <h2><MemoryStick size={20} aria-hidden />内存</h2>
              <dl>
                <DetailFact label="总量">{formatMemCapacity(data.memTotal || 0)}</DetailFact>
                <DetailFact label="已用">{formatBytes(data.memUsed || 0)}</DetailFact>
                <DetailFact label="可用">{formatBytes(Math.max(0, (data.memTotal || 0) - (data.memUsed || 0)))}</DetailFact>
                <DetailFact label="Swap">{swapText}</DetailFact>
                {data.swapTotal ? <DetailFact label="Swap 使用率">{percentText(data.swapPercent)}</DetailFact> : null}
              </dl>
            </OverviewDetails>
            <p>{formatBytes(data.memUsed || 0)} / {formatMemCapacity(data.memTotal || 0)}</p>
            <p className="local-summary-secondary">Swap {data.swapTotal ? formatBytes(data.swapUsed || 0) : "未启用"}</p>
          </article>
          <article className="local-summary-resource">
            <OverviewDetails label="磁盘详情" trigger={<ResourceRing value={diskSummary?.percent} label="磁盘" valueText={percentText(diskSummary?.percent)}><strong>{percentText(diskSummary?.percent)}</strong><span>磁盘</span></ResourceRing>}>
              <h2><HardDrive size={20} aria-hidden />{diskItems.length > 1 ? "磁盘" : "本机磁盘"}</h2>
              {!diskItems.length ? <p>暂无磁盘数据</p> : diskItems.map(item => {
                const physical = disks.find(disk => (disk.filesystem || disk.device || disk.mount) === item.key);
                const partitions = physical?.kind === "disk" ? mounts.filter(disk => diskParentOf(disk) === diskParentOf(physical)) : physical ? [physical] : [];
                return <section key={item.key} className="local-summary-disk-details">
                  <div className="local-summary-disk-model"><p className="text-muted">{physical?.device || item.label}{physical?.kind === "disk" ? ` / ${physical.model || (physical.modelError ? "型号读取失败" : "系统未提供型号")}` : ""}</p>{physical?.kind === "disk" ? <TextCopy text={formatLocalDiskInfo(physical)} label={`复制硬盘信息（${physical.device}）`} /> : null}</div>
                  {partitions.map((disk, index) => <dl key={`${disk.device}-${disk.mount}-${index}`}>
                    <DetailFact label="分区">{disk.name || disk.device || "—"}</DetailFact>
                    <DetailFact label="挂载点">{disk.mount || "—"}</DetailFact>
                    <DetailFact label="设备">{disk.device || disk.filesystem || "—"}</DetailFact>
                    <DetailFact label="格式">{disk.fsType || "—"}</DetailFact>
                  </dl>)}
                  <dl>
                    {diskItems.length > 1 ? <DetailFact label="已用 / 总量">{formatBytes(item.used)} / {formatBytes(item.total)}</DetailFact> : null}
                    <DetailFact label="可用">{formatBytes(item.avail)}</DetailFact>
                  </dl>
                </section>;
              })}
            </OverviewDetails>
            {diskSummary ? <><p>{diskLabel}</p><p>{formatBytes(diskSummary.used)} / {formatBytes(diskSummary.total)}</p><p className="local-summary-secondary">可用 {formatBytes(diskSummary.avail)}</p></> : <p className="local-summary-secondary">暂无磁盘数据</p>}
          </article>
          {isTemperatureKnown ? <article className="local-summary-resource">
            <OverviewDetails label="温度详情" trigger={<ResourceRing value={temperature} max={120} tone={temperature >= 85 ? "danger" : temperature >= 60 ? "warn" : "ok"} label="温度" valueText={formatTemp(temperature)}><strong>{formatTemp(temperature)}</strong><span>温度</span></ResourceRing>}>
              <h2><Thermometer size={20} aria-hidden />温度</h2>
              <dl>
                {validTemp(data.tempC) !== undefined ? <DetailFact label="综合温度">{formatTemp(data.tempC)}</DetailFact> : null}
                {cpuTemp !== undefined ? <DetailFact label="CPU 温度">{formatTemp(cpuTemp)}</DetailFact> : null}
                {gpuTemp !== undefined ? <DetailFact label="GPU 温度">{formatTemp(gpuTemp)}</DetailFact> : null}
                <DetailFact label="圆环刻度">0–120 °C</DetailFact>
              </dl>
            </OverviewDetails>
            <p>{validTemp(data.tempC) !== undefined ? "综合温度" : cpuTemp !== undefined ? "CPU 温度" : "GPU 温度"}</p>
            {cpuTemp !== undefined || gpuTemp !== undefined ? <p className="local-summary-secondary">{[cpuTemp !== undefined ? `CPU ${formatTemp(cpuTemp)}` : "", gpuTemp !== undefined ? `GPU ${formatTemp(gpuTemp)}` : ""].filter(Boolean).join(" / ")}</p> : null}
          </article> : null}
        </section>
      </> : !error ? <p className="text-sm text-muted">加载中…</p> : null}

      <section className="local-summary-network" aria-label="网络摘要">
        <h2><OverviewDetails label="网络详情" className="local-summary-network-title" trigger={<><Network size={20} aria-hidden /><span>网络</span></>}>
          <h2><Network size={20} aria-hidden />网络</h2>
          <dl>
            <DetailFact label="内网 IP">{network.data?.privateIPs?.join(", ") || data?.ipAddress || "—"}</DetailFact>
            <DetailFact label="公网 IP">{data?.publicIP || "—"}</DetailFact>
            <DetailFact label="默认网关">{network.data?.defaultGateway || "—"}</DetailFact>
            <DetailFact label="出口网卡">{network.data?.primaryIface || "—"}</DetailFact>
            <DetailFact label="网卡">{network.data ? `${allIfaces.filter(iface => iface.state === "up").length} 已连接 / ${allIfaces.length} 个` : "—"}</DetailFact>
          </dl>
          {allIfaces.map(iface => <dl key={iface.name} className="local-summary-disk-details"><DetailFact label={iface.name}>{iface.ipv4 || "—"} / {iface.state === "up" ? "已连接" : iface.state === "down" ? "未连接" : "状态未知"}</DetailFact></dl>)}
        </OverviewDetails></h2>
        {network.error ? <Notice tone="warning" text={`网络信息更新失败${network.data ? "，以下为最后已知读数" : ""}：${formatErr(network.error)}`} /> : null}
        {shownIfaces.length ? <div className="local-summary-interfaces">
          {shownIfaces.map(iface => {
            const Icon = iface.kind === "vpn" ? ShieldCheck : iface.kind === "wifi" ? Wifi : iface.kind === "ethernet" ? Cable : Network;
            const state = iface.state === "up" ? "已连接" : iface.state === "down" ? "未连接" : "状态未知";
            return <div key={iface.name} className="local-summary-interface">
              <OverviewDetails label={`${iface.name} 网卡详情`} className="local-summary-network-icon" trigger={<Icon size={28} strokeWidth={1.5} aria-hidden />}>
                <h2><Icon size={20} aria-hidden />{iface.display || iface.name}</h2>
                <dl>
                  <DetailFact label="接口">{iface.name}</DetailFact>
                  <DetailFact label="类型">{IFACE_KIND_LABEL[iface.kind] || iface.kind || "—"}</DetailFact>
                  <DetailFact label="状态">{state}</DetailFact>
                  <DetailFact label="IPv4">{iface.ipv4 || "—"}</DetailFact>
                  <DetailFact label="MAC">{iface.mac || "—"}</DetailFact>
                  <DetailFact label="接收（累计）">{formatBytes(iface.rxBytes)}</DetailFact>
                  <DetailFact label="发送（累计）">{formatBytes(iface.txBytes)}</DetailFact>
                </dl>
              </OverviewDetails>
              <div className="local-summary-interface-copy"><div><strong>{IFACE_KIND_LABEL[iface.kind] || iface.kind || "网卡"}</strong><span>{iface.name}</span><Tag tone={iface.state === "up" ? "ok" : "neutral"}>{state}</Tag></div><p>{iface.ipv4 || "—"}{iface.name === network.data?.primaryIface ? "（出口）" : ""}</p></div>
            </div>;
          })}
        </div> : <p className="text-sm text-muted">{network.isLoading ? "加载中…" : "暂无网卡数据"}</p>}
        <p className="local-summary-public-ip"><span>公网 IP</span>{data?.publicIP || "—"}</p>
      </section>
    </div>
  </Page>;
}
