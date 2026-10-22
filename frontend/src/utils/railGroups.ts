/** 手动打开的分组是不可拆开的排序块；只打开主机时不带出分组。主机归属以当前配置为准。 */
export type RailGroup = { kind: "group"; id: string; key: string; hosts: string[] };
export type RailHost = { kind: "host"; name: string };
export type RailItem = RailGroup | RailHost;
export type RailDrop = { key: string; before: boolean };

const GROUP_KEY_PREFIX = "group:";
export const groupRailKey = (id: string) => GROUP_KEY_PREFIX + id;

function itemKey(item: RailItem): string {
  return item.kind === "group" ? item.key : item.name;
}

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
}): RailItem[] {
  const hostGroups = new Map(
    openedHosts.map((name) => [name, groupIdOf(name) || ungroupedId]),
  );
  const visited = new Set(visitedGroupIds.filter((id) => id));
  const groupIdFromKey = (key: string) => {
    if (key.startsWith(GROUP_KEY_PREFIX)) {
      const id = key.slice(GROUP_KEY_PREFIX.length);
      return visited.has(id) ? id : "";
    }
    // 兼容旧版无前缀的分组键；同名主机优先按主机解释。
    return !hostGroups.has(key) && visited.has(key) ? key : "";
  };

  const items: RailItem[] = [];
  const placedGroups = new Map<string, RailGroup>();
  const placedHosts = new Set<string>();

  function placeGroup(id: string) {
    const existing = placedGroups.get(id);
    if (existing) return existing;
    if (!visited.has(id)) return null;
    const block: RailGroup = { kind: "group", id, key: groupRailKey(id), hosts: [] };
    placedGroups.set(id, block);
    items.push(block);
    return block;
  }

  function placeHost(name: string) {
    if (placedHosts.has(name) || !hostGroups.has(name)) return;
    placedHosts.add(name);
    const groupId = hostGroups.get(name)!;
    if (visited.has(groupId)) {
      placeGroup(groupId)!.hosts.push(name);
      return;
    }
    items.push({ kind: "host", name });
  }

  for (const key of railOrder) {
    const id = groupIdFromKey(key);
    if (id) {
      placeGroup(id);
      continue;
    }
    placeHost(key);
  }
  for (const id of visited) placeGroup(id);
  for (const name of openedHosts) placeHost(name);
  return items;
}

export function railOrderOf(items: RailItem[]): string[] {
  return items.flatMap((item) => item.kind === "group" ? [item.key, ...item.hosts] : [item.name]);
}

/** 拖分组或未归组的主机时移动整行；拖组内主机只调整该组内的顺序。 */
export function resolveRailDrop(
  items: RailItem[],
  sourceKey: string,
  targetKey: string,
  before: boolean,
): RailDrop | null {
  if (sourceKey === targetKey) return null;
  const sourceGroup = items.find((item) => item.kind === "group" && (item.key === sourceKey || item.hosts.includes(sourceKey)));
  if (sourceGroup && sourceGroup.kind === "group" && sourceGroup.hosts.includes(sourceKey)) {
    if (sourceGroup.key === targetKey) {
      const firstHost = sourceGroup.hosts[0];
      return firstHost === sourceKey ? null : { key: firstHost, before: true };
    }
    if (!sourceGroup.hosts.includes(targetKey)) return null;
    return { key: targetKey, before };
  }

  const loose = items.find((item) => item.kind === "host" && item.name === sourceKey);
  const movingGroup = sourceGroup && sourceGroup.kind === "group" && sourceGroup.key === sourceKey;
  if (!loose && !movingGroup) return null;
  let topKey = targetKey;
  for (const item of items) {
    if (item.kind === "group" && (item.key === targetKey || item.hosts.includes(targetKey))) {
      topKey = item.key;
      break;
    }
  }
  let sourceTop = "";
  if (movingGroup && sourceGroup.kind === "group") {
    sourceTop = sourceGroup.key;
  } else if (loose && loose.kind === "host") {
    sourceTop = loose.name;
  }
  if (topKey === sourceTop) return null;
  if (!items.some((item) => itemKey(item) === topKey)) return null;
  return { key: topKey, before };
}

export function reorderRailGroups(
  items: RailItem[],
  sourceKey: string,
  drop: RailDrop,
): RailItem[] | null {
  const target = resolveRailDrop(items, sourceKey, drop.key, drop.before);
  if (!target) return null;
  const sourceGroup = items.find((item) => item.kind === "group" && item.hosts.includes(sourceKey));
  if (sourceGroup && sourceGroup.kind === "group") {
    const hosts = sourceGroup.hosts.filter((name) => name !== sourceKey);
    const index = hosts.indexOf(target.key);
    if (index < 0) return null;
    hosts.splice(index + (target.before ? 0 : 1), 0, sourceKey);
    return items.map((item) => item === sourceGroup ? { ...item, hosts } : item);
  }
  const moving = items.find((item) => itemKey(item) === sourceKey);
  if (!moving) return null;
  const next = items.filter((item) => item !== moving);
  const index = next.findIndex((item) => itemKey(item) === target.key);
  if (index < 0) return null;
  next.splice(index + (target.before ? 0 : 1), 0, moving);
  return next;
}
