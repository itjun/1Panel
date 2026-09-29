import type { localsys } from "@/api";

/** 外置硬盘最多展示数量 */
export const MAX_EXTERNAL_DISKS = 16;

export type DiskSummaryItem = {
  key: string;
  label: string;
  total: number;
  used: number;
  avail: number;
  percent: number;
  scope: "disk" | "mount";
};

export type DiskGroup = {
  parent: string;
  label: string;
  displayName: string;
  external: boolean;
  physical?: localsys.DiskInfo;
  partitions: localsys.DiskInfo[];
};

export function isExternalMountPath(mount?: string | null): boolean {
  const m = (mount || "").trim();
  if (!m.startsWith("/Volumes/")) return false;
  if (m === "/Volumes/Recovery") return false;
  const name = m.slice("/Volumes/".length);
  return !!name && !name.includes("/");
}

export function diskMountLabel(d: localsys.DiskInfo): string {
  const m = (d.mount || "").trim();
  if (isExternalMountPath(m)) {
    const name = m.slice("/Volumes/".length);
    return name ? `${name}（外置）` : m;
  }
  return m || d.device || "磁盘";
}

export function diskExternalRowLabel(d: localsys.DiskInfo): string {
  const m = (d.mount || "").trim();
  if (isExternalMountPath(m)) {
    const name = m.slice("/Volumes/".length);
    return name || m;
  }
  return diskMountLabel(d);
}

export function diskPhysicalLabel(d: localsys.DiskInfo): string {
  if (d.kind === "disk" && d.external) {
    return `${d.name || d.device || d.filesystem || "外置磁盘"}（外置）`;
  }
  const m = (d.mount || "").trim();
  if (isExternalMountPath(m)) {
    const name = m.slice("/Volumes/".length);
    return name ? `${name}（外置）` : "外置磁盘";
  }
  if (d.kind === "disk" && (d.device || d.filesystem)) {
    return `本机磁盘（${d.device || d.filesystem}）`;
  }
  return diskMountLabel(d);
}

export function diskParentOf(d: localsys.DiskInfo): string {
  const p = (d.parent || "").trim();
  if (p) return p;
  const device = (d.device || d.filesystem || "").trim();
  const bare = device.replace(/^\/dev\//, "");
  const m = /^disk\d+/.exec(bare);
  if (m) return m[0];
  if (isExternalMountPath(d.mount)) return (d.mount || "").trim();
  return device || (d.mount || "").trim() || "unknown";
}

export function diskMountPercent(d: localsys.DiskInfo): number {
  const total = d.total || 0;
  if (total <= 0) return 0;
  return Math.min(100, Math.round(((d.used || 0) / total) * 100));
}

export function diskGroupUsed(g: DiskGroup): number {
  if (g.physical && (g.physical.total || 0) > 0) return g.physical.used || 0;
  return g.partitions.reduce((s, d) => s + (d.used || 0), 0);
}

export function diskGroupTotal(g: DiskGroup): number {
  if (g.physical && (g.physical.total || 0) > 0) return g.physical.total || 0;
  return Math.max(0, ...g.partitions.map((d) => d.total || 0));
}

/** 弹出 / 环图：本机 + 外置最多 16 块 */
export function buildDiskSummaryItems(disks: localsys.DiskInfo[]): DiskSummaryItem[] {
  const all = disks || [];
  const physical = all.filter((d) => d.kind === "disk" && (d.total || 0) > 0);
  const list = physical.length
    ? physical
    : all.filter((d) => d.kind !== "disk" && (d.total || 0) > 0);
  const byKey = new Map<string, localsys.DiskInfo>();
  for (const d of list) {
    const key = d.filesystem || d.device || d.mount || "";
    const prev = byKey.get(key);
    if (!prev || (d.total || 0) > (prev.total || 0)) {
      byKey.set(key, d);
    }
  }
  const internal: DiskSummaryItem[] = [];
  const external: DiskSummaryItem[] = [];
  for (const [key, d] of byKey) {
    const total = d.total || 0;
    if (total <= 0) continue;
    const used = d.used || 0;
    const avail = d.avail || d.free || 0;
    const item: DiskSummaryItem = {
      key,
      label: diskPhysicalLabel(d),
      total,
      used,
      avail,
      percent: (used / total) * 100,
      scope: d.kind === "disk" ? "disk" : "mount",
    };
    if (d.external) {
      external.push(item);
    } else {
      internal.push(item);
    }
  }
  internal.sort((a, b) => b.total - a.total);
  external.sort((a, b) => b.total - a.total);
  return [...internal, ...external.slice(0, MAX_EXTERNAL_DISKS)];
}

export function summarizeDiskItems(items: DiskSummaryItem[]) {
  if (!items.length) return null;
  let total = 0;
  let used = 0;
  let avail = 0;
  for (const d of items) {
    total += d.total;
    used += d.used;
    avail += d.avail;
  }
  if (total <= 0) return null;
  return {
    total,
    used,
    avail,
    percent: (used / total) * 100,
    count: items.length,
  };
}

/** 按物理盘分组：本机竖排分区 + 外置最多 16 盘 */
export function buildDiskGroups(disks: localsys.DiskInfo[]): {
  internal: DiskGroup[];
  external: DiskGroup[];
  overflow: number;
} {
  const all = disks || [];
  const mounts = all.filter((d) => d.kind !== "disk");
  const physicals = all.filter((d) => d.kind === "disk" && (d.total || 0) > 0);
  const byParent = new Map<string, DiskGroup>();

  const ensure = (parent: string, external: boolean): DiskGroup => {
    let g = byParent.get(parent);
    if (!g) {
      g = {
        parent,
        label: "",
        displayName: parent,
        external,
        partitions: [],
      };
      byParent.set(parent, g);
    }
    return g;
  };

  for (const d of physicals) {
    const parent = diskParentOf(d);
    const external = !!d.external;
    const g = ensure(parent, external);
    g.external = g.external || external;
    g.physical = d;
    if (external) {
      g.displayName = diskPhysicalLabel(d);
      g.label = "";
    } else {
      g.label = "";
      g.displayName = d.device || parent;
    }
  }

  for (const d of mounts) {
    const parent = diskParentOf(d);
    const external = !!d.external;
    const g = ensure(parent, external);
    g.external = g.external || external;
    g.partitions.push(d);
    if (external && !g.physical) {
      g.displayName = diskMountLabel(d);
    }
  }

  const internal: DiskGroup[] = [];
  const external: DiskGroup[] = [];
  for (const g of byParent.values()) {
    if (!g.partitions.length && !g.physical) continue;
    if (g.external) {
      if (!g.partitions.length && g.physical) {
        g.partitions = [g.physical];
      }
      external.push(g);
    } else {
      if (!g.partitions.length) continue;
      internal.push(g);
    }
  }

  internal.sort((a, b) => {
    const at = a.physical?.total || a.partitions[0]?.total || 0;
    const bt = b.physical?.total || b.partitions[0]?.total || 0;
    return bt - at;
  });
  for (const g of internal) {
    g.partitions.sort((a, b) => {
      if (a.mount === "/") return -1;
      if (b.mount === "/") return 1;
      return (a.mount || "").localeCompare(b.mount || "");
    });
  }

  external.sort((a, b) => diskGroupTotal(b) - diskGroupTotal(a));
  const shown = external.slice(0, MAX_EXTERNAL_DISKS);

  const parents = new Set<string>();
  for (const d of all) {
    if (d.external) {
      parents.add(diskParentOf(d));
    }
  }
  const overflow = Math.max(0, parents.size - MAX_EXTERNAL_DISKS);

  return { internal, external: shown, overflow };
}

export function flattenExternalRows(groups: DiskGroup[]): localsys.DiskInfo[] {
  const rows: localsys.DiskInfo[] = [];
  for (const g of groups) {
    if (g.partitions.length) {
      rows.push(...g.partitions);
    } else if (g.physical) {
      rows.push(g.physical);
    }
  }
  return rows;
}
