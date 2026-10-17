import type { GroupDropMark } from "./hostRows";

export const PINNED_RACK = "rack-pinned";
export const UNGROUPED_RACK = "rack-ungrouped";

export type HostRack = { id: string; name: string; groups: string[] };
export type RackDropMark = GroupDropMark | { kind: "rack"; rackId: string };

/** 旧布局只迁移一次；置顶机柜的身份不再随非空排的位置改变。 */
export function parseHostRacks(value: unknown, legacyRows: string[][]): HostRack[] {
  if (!Array.isArray(value)) {
    const rows = legacyRows.length ? legacyRows : [[]];
    return [
      ...rows.map((groups, index) => ({ id: index === 0 ? PINNED_RACK : `rack-legacy-${index}`, name: "", groups: [...groups] })),
      { id: UNGROUPED_RACK, name: "", groups: [] },
    ];
  }
  const seen = new Set<string>();
  const racks: HostRack[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object" || typeof entry.id !== "string" || !entry.id || seen.has(entry.id)) continue;
    seen.add(entry.id);
    racks.push({
      id: entry.id,
      name: typeof entry.name === "string" ? entry.name.trim() : "",
      groups: Array.isArray(entry.groups) ? entry.groups.filter((id: unknown): id is string => typeof id === "string") : [],
    });
  }
  const pinned = racks.find((rack) => rack.id === PINNED_RACK) ?? { id: PINNED_RACK, name: "", groups: [] };
  const ungrouped = racks.find((rack) => rack.id === UNGROUPED_RACK) ?? { id: UNGROUPED_RACK, name: "", groups: [] };
  return [pinned, ...racks.filter((rack) => rack.id !== PINNED_RACK && rack.id !== UNGROUPED_RACK), { ...ungrouped, groups: [] }];
}

export function reconcileHostRacks(saved: HostRack[], orderedIds: string[]): HostRack[] {
  const known = new Set(orderedIds);
  const placed = new Set<string>();
  const racks = parseHostRacks(saved, []).map((rack) => ({
    ...rack,
    groups: rack.groups.filter((id) => {
      if (!known.has(id) || placed.has(id)) return false;
      placed.add(id);
      return true;
    }),
  })).filter((rack) => rack.id === PINNED_RACK || rack.id === UNGROUPED_RACK || rack.name || rack.groups.length);
  const rest = orderedIds.filter((id) => !placed.has(id));
  racks[racks.length - 2]!.groups.push(...rest);
  return racks;
}

export function moveGroupInRacks(racks: HostRack[], dragged: string, mark: RackDropMark, newId: string): HostRack[] {
  if (!racks.some((rack) => rack.groups.includes(dragged))) return racks;
  if (mark.kind === "block" && (mark.target === dragged || !racks.some((rack) => rack.groups.includes(mark.target)))) return racks;
  if (mark.kind === "rack" && !racks.some((rack) => rack.id === mark.rackId && rack.id !== UNGROUPED_RACK)) return racks;
  const next = racks.map((rack) => ({ ...rack, groups: rack.groups.filter((id) => id !== dragged) }));
  if (mark.kind === "block") {
    const target = next.find((rack) => rack.groups.includes(mark.target))!;
    target.groups.splice(target.groups.indexOf(mark.target) + Number(mark.after), 0, dragged);
  } else if (mark.kind === "rack") {
    next.find((rack) => rack.id === mark.rackId)!.groups.push(dragged);
  } else {
    const index = Math.max(1, Math.min(mark.beforeRow, next.length - 1));
    next.splice(index, 0, { id: newId, name: "", groups: [dragged] });
  }
  return next.filter((rack) => rack.id === PINNED_RACK || rack.id === UNGROUPED_RACK || rack.name || rack.groups.length);
}

/** 兼容旧版本布局读取及全站分组排序。 */
export function hostRackRows(racks: HostRack[]): string[][] {
  return racks.filter((rack) => rack.id !== UNGROUPED_RACK).map((rack) => [...rack.groups]);
}
