import type { localsys } from "@/api";
import { Meter } from "@/react/components/ui/meter";
import { formatBytes } from "@/utils/format";
import { TextCopy } from "@/react/components/text-reader";
import { formatLocalDiskInfo, diskPhysicalLabel } from "./disk-utils";

/** 本机概览和磁盘空间共用容量摘要，型号与容量保持同一行分组。 */
export function LocalPhysicalDiskRows({ disks }: { disks: localsys.DiskInfo[] }) {
  return <div className="flex flex-col">{disks.filter((disk) => disk.kind === "disk" && disk.total > 0).map((disk) => (
    <div key={disk.filesystem || disk.device} className="grid grid-cols-1 items-center gap-4 border-b border-line py-4 @min-[700px]:grid-cols-[minmax(180px,1fr)_auto_minmax(260px,2fr)]">
      <div className="min-w-0">
        <div className="text-sm font-semibold">{diskPhysicalLabel(disk)}</div>
        <div className="mt-2 flex min-w-0 items-center gap-2 text-xs text-muted">
          <span className="shrink-0" title="系统报告的设备型号；外置硬盘可能显示硬盘盒型号">型号</span>
          <span className="min-w-0 select-text truncate font-mono" title={disk.modelError || disk.model || "系统未提供型号"}>
            {disk.model || (disk.modelError ? "读取失败" : "系统未提供")}
          </span>
          <TextCopy text={formatLocalDiskInfo(disk)} label={`复制硬盘信息（${disk.device}）`} />
        </div>
      </div>
      <div className="font-mono text-2xl font-semibold tabular-nums">{formatBytes(disk.total)}</div>
      <div className="min-w-0">
        <Meter value={((disk.used || 0) / disk.total) * 100} className="w-full" />
        <div className="mt-2 flex flex-wrap gap-x-5 text-xs text-muted">
          <span className="font-mono">已用 {formatBytes(disk.used || 0)}</span>
          <span className="font-mono">可用 {formatBytes(disk.avail ?? disk.free ?? 0)}</span>
        </div>
      </div>
    </div>
  ))}</div>;
}
