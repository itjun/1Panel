import type { monitor } from "@/api";
import { OverviewResources, type OverviewMetric } from "@/react/components/overview/device-overview";
import { fullestDisk, isDiskFull, summarizeDisks } from "@/utils/alerts";
import { formatBytes, formatMemCapacity } from "@/utils/format";

export function HostWorkbenchSummary({ data, disks, isUnavailable, isDiskUnavailable }: {
  data?: monitor.Overview;
  disks?: monitor.DiskInfo[];
  isUnavailable: boolean;
  isDiskUnavailable: boolean;
}) {
  const disk = summarizeDisks(disks);
  const fullDisk = isDiskFull(disks) ? fullestDisk(disks) : null;
  const diskPercent = fullDisk ? (fullDisk.used / fullDisk.total) * 100 : disk?.percent;
  const displayedDisk = fullDisk || disk;
  const diskScope = fullDisk
    ? `挂载点：${fullDisk.mount || "—"}\n设备：${fullDisk.filesystem || "—"}\n类型：${fullDisk.fsType || "—"}`
    : disk ? `范围：${disk.count} ${disk.scope === "disk" ? "块物理盘" : "个分区"}` : "";
  const swapText = data && data.swapTotal > 0
    ? `${formatBytes(data.swapUsed)} / ${formatBytes(data.swapTotal)}，${data.swapPercent.toFixed(1)}%`
    : "未启用";
  const metrics: OverviewMetric[] = [
    {
      id: "cpu", label: "CPU",
      text: data ? `${data.cpuPercent.toFixed(1)}%` : "—",
      detail: data ? `${data.cpuCount} 核心` : undefined,
      tooltip: data ? `型号：${data.cpuModel || "—"}\n核心数：${data.cpuCount} 核\n使用率：${data.cpuPercent.toFixed(2)}%` : undefined,
      percent: data?.cpuPercent,
    },
    {
      id: "memory", label: "内存",
      text: data ? `${data.memPercent.toFixed(1)}%` : "—",
      detail: data ? `${formatBytes(data.memUsed)} / ${formatBytes(data.memTotal)}` : undefined,
      tooltip: data ? `标称容量（估算）：${formatMemCapacity(data.memTotal)}\n系统容量：${formatBytes(data.memTotal)}\n已用：${formatBytes(data.memUsed)}\n可用：${formatBytes(Math.max(0, data.memTotal - data.memUsed))}\n使用率：${data.memPercent.toFixed(2)}%\nSwap：${swapText}` : undefined,
      percent: data?.memPercent,
    },
    {
      id: "disk", label: "磁盘",
      text: diskPercent != null ? `${diskPercent.toFixed(1)}%` : "—",
      detail: fullDisk
        ? `${fullDisk.mount || fullDisk.filesystem} ${formatBytes(fullDisk.used)} / ${formatBytes(fullDisk.total)}`
        : disk ? `${formatBytes(disk.used)} / ${formatBytes(disk.total)}` : undefined,
      percent: diskPercent,
      tooltip: displayedDisk ? `${diskScope}\n总量：${formatBytes(displayedDisk.total)}\n已用：${formatBytes(displayedDisk.used)}\n可用：${formatBytes(displayedDisk.avail)}\n使用率：${diskPercent!.toFixed(2)}%` : undefined,
      isUnavailable: isDiskUnavailable,
    },
    {
      id: "load", label: "负载",
      text: data ? data.load1.toFixed(2) : "—",
      detail: data ? `1 分钟 / ${data.cpuCount} 核` : "1 分钟",
      tooltip: data ? `1 分钟：${data.load1.toFixed(2)}\n5 分钟：${data.load5.toFixed(2)}\n15 分钟：${data.load15.toFixed(2)}\n核心数：${data.cpuCount} 核` : undefined,
      percent: data?.cpuCount ? (data.load1 / data.cpuCount) * 100 : undefined,
    },
  ];
  return <OverviewResources metrics={metrics} isUnavailable={isUnavailable} isLoading={!data && !isUnavailable} />;
}
