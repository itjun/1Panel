/**
 * 首页机柜分组排布的纯逻辑（DESIGN.md §9）：
 * 布局是「每排若干分组 id」的二维数组，持久化在 UI 偏好 hostHomeRows。
 */

/**
 * 分组拖拽落点：
 * - block：插到某分组块之前 / 之后
 * - newRow：新建一排放入被拖分组；beforeRow 为新排插在第几排之前，等于排数表示追加到最后
 */
export type GroupDropMark =
  | { kind: "block"; target: string; after: boolean }
  | { kind: "newRow"; beforeRow: number };

/**
 * 布局对账：丢弃已不存在的分组 id 与重复 id；不在布局里的分组按 order 追加到最后一排末尾；
 * 去掉空排。没有保存过布局时，全部分组按 order 放在一排。
 */
export function reconcileHostRows(saved: string[][], orderedIds: string[]): string[][] {
  const known = new Set(orderedIds);
  const placed = new Set<string>();
  const rows: string[][] = [];
  for (const savedRow of saved) {
    const row: string[] = [];
    for (const id of savedRow) {
      if (!known.has(id)) continue;
      if (placed.has(id)) continue;
      placed.add(id);
      row.push(id);
    }
    if (row.length > 0) rows.push(row);
  }
  const rest = orderedIds.filter((id) => !placed.has(id));
  if (rest.length > 0) {
    if (rows.length === 0) {
      rows.push(rest);
    } else {
      rows[rows.length - 1]!.push(...rest);
    }
  }
  return rows;
}

/** 按落点移动分组，返回新布局（拖空的排自动去掉） */
export function moveGroupInRows(rows: string[][], dragged: string, mark: GroupDropMark): string[][] {
  const next = rows.map((row) => row.filter((id) => id !== dragged));
  if (mark.kind === "block") {
    if (mark.target === dragged) return rows;
    for (const row of next) {
      const index = row.indexOf(mark.target);
      if (index < 0) continue;
      if (mark.after) {
        row.splice(index + 1, 0, dragged);
      } else {
        row.splice(index, 0, dragged);
      }
      break;
    }
  } else {
    next.splice(mark.beforeRow, 0, [dragged]);
  }
  return next.filter((row) => row.length > 0);
}
