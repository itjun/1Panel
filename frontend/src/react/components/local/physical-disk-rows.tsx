import type { localsys } from "@/api";
import { PhysicalDiskRows } from "@/react/components/overview/overview-parts";
import { TextCopy } from "@/react/components/text-reader";
import { formatLocalDiskInfo, diskPhysicalLabel } from "./disk-utils";

/** 本机型号展示复用容量行；远程磁盘维持原有布局。 */
export function LocalPhysicalDiskRows({ disks }: { disks: localsys.DiskInfo[] }) {
  const physicals = disks.filter((disk) => disk.kind === "disk" && disk.total > 0);
  const byDevice = new Map(physicals.map((disk) => [disk.filesystem || disk.device, disk]));
  return <PhysicalDiskRows
    disks={physicals.map((disk) => ({
      filesystem: disk.filesystem || disk.device,
      mount: diskPhysicalLabel(disk),
      fsType: disk.fsType,
      total: disk.total,
      used: disk.used || 0,
      avail: disk.avail ?? disk.free ?? 0,
      percent: ((disk.used || 0) / disk.total) * 100,
      kind: "disk",
    }))}
    renderDetails={(row) => {
      const disk = byDevice.get(row.filesystem);
      if (!disk) return null;
      return <div className="flex min-w-0 items-center gap-2 text-xs text-muted">
        <span className="shrink-0" title="系统报告的设备型号；外置硬盘可能显示硬盘盒型号">型号</span>
        <span className="min-w-0 select-text truncate font-mono text-ink"
          title={disk.modelError || disk.model || "系统未提供型号"}>
          {disk.model || (disk.modelError ? "读取失败" : "系统未提供")}
        </span>
        <TextCopy text={formatLocalDiskInfo(disk)} label={`复制硬盘信息（${disk.device}）`} />
      </div>;
    }}
  />;
}
