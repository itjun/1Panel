/** 侧栏分组是不可拆开的排序块；主机归属始终以当前配置为准。 */
export type RailGroup = { id: string; key: string; hosts: string[] };
export type RailDrop = { key: string; before: boolean };

const GROUP_KEY_PREFIX = "group:";
export const groupRailKey = (id: string) => GROUP_KEY_PREFIX + id;

export function buildRailGroups({
  openedHosts,
  visitedGroupIds,
  railOrder,
  groupIdOf,
  ungroupedId,
}: {
  openedHosts: string[];
  visitedGroupIds: string[];
  railOrder: string[];
  groupIdOf: (host: string) => string;
  ungroupedId: string;
}): RailGroup[] {
  const hostGroups = new Map(
    openedHosts.map((name) => [name, groupIdOf(name) || ungroupedId]),
  );
  const groupIds = new Set([...visitedGroupIds, ...hostGroups.values()]);
  const groupIdFromKey = (key: string) => {
    if (key.startsWith(GROUP_KEY_PREFIX)) {
      const id = key.slice(GROUP_KEY_PREFIX.length);
      if (groupIds.has(id)) return id;
    }
    // 兼容旧版无前缀的分组键；同名主机优先按主机解释。
    return !hostGroups.has(key) && groupIds.has(key) ? key : "";
  };
  const explicitlyOrdered = new Set(railOrder.map(groupIdFromKey).filter(Boolean));
  const orderedGroupIds = new Set<string>();
  const orderedHosts = new Set<string>();
  for (const key of railOrder) {
    const id = groupIdFromKey(key);
    if (id) orderedGroupIds.add(id);
    if (!hostGroups.has(key)) continue;
    orderedHosts.add(key);
    const hostGroup = hostGroups.get(key)!;
    if (!explicitlyOrdered.has(hostGroup)) orderedGroupIds.add(hostGroup);
  }
  for (const id of groupIds) orderedGroupIds.add(id);
  for (const name of openedHosts) orderedHosts.add(name);

  const blocks = new Map(
    [...orderedGroupIds].map((id) => [id, { id, key: groupRailKey(id), hosts: [] as string[] }]),
  );
  for (const name of orderedHosts) blocks.get(hostGroups.get(name)!)!.hosts.push(name);
  return [...blocks.values()];
}

export function railOrderOf(groups: RailGroup[]): string[] {
  return groups.flatMap((group) => [group.key, ...group.hosts]);
}

/** 拖分组落在整组边界；拖主机仅调整所属组内的顺序。 */
export function resolveRailDrop(
  groups: RailGroup[],
  sourceKey: string,
  targetKey: string,
  before: boolean,
): RailDrop | null {
  const source = groups.find((group) => group.key === sourceKey || group.hosts.includes(sourceKey));
  const target = groups.find((group) => group.key === targetKey || group.hosts.includes(targetKey));
  if (!source || !target || sourceKey === targetKey) return null;
  if (source.key === sourceKey) {
    return source === target ? null : { key: target.key, before };
  }
  if (source !== target) return null;
  if (target.key === targetKey) {
    const firstHost = target.hosts[0];
    return firstHost === sourceKey ? null : { key: firstHost, before: true };
  }
  return { key: targetKey, before };
}

export function reorderRailGroups(
  groups: RailGroup[],
  sourceKey: string,
  drop: RailDrop,
): RailGroup[] | null {
  const target = resolveRailDrop(groups, sourceKey, drop.key, drop.before);
  if (!target) return null;
  const sourceGroup = groups.find((group) => group.key === sourceKey || group.hosts.includes(sourceKey))!;
  if (sourceGroup.key === sourceKey) {
    const next = groups.filter((group) => group !== sourceGroup);
    const index = next.findIndex((group) => group.key === target.key);
    next.splice(index + (target.before ? 0 : 1), 0, sourceGroup);
    return next;
  }
  const hosts = sourceGroup.hosts.filter((name) => name !== sourceKey);
  const index = hosts.indexOf(target.key);
  hosts.splice(index + (target.before ? 0 : 1), 0, sourceKey);
  return groups.map((group) => group === sourceGroup ? { ...group, hosts } : group);
}
