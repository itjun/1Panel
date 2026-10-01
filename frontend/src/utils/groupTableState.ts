export type GroupSortValue = string | number | null;

export interface FitColumn {
  key: string;
  /** 内容完整显示所需宽度 */
  natural: number;
  /** 压缩下限 */
  min: number;
  /** 有富余时分得多余空间的权重；0 表示定宽 */
  flex?: number;
  /** 空间不够时可压到 min（文字截断）；弹性列总是可压 */
  shrink?: boolean;
  /** 用户手动拖出的宽度，固定不参与分配 */
  manual?: number;
}

/**
 * 按可用宽度分配列宽：先给每列自然宽度；有富余按 flex 权重分给弹性列；
 * 不够时先压弹性列、再压可截断列到各自 min，仍不够则保持合计超宽（交给横向滚动）。
 */
export function fitColumnWidths(
  cols: readonly FitColumn[],
  available: number
): Record<string, number> {
  const widths: Record<string, number> = {};
  for (const col of cols) {
    widths[col.key] = Math.round(col.manual ?? Math.max(col.natural, col.min));
  }
  if (!(available > 0) || !Number.isFinite(available)) return widths;
  const total = () => cols.reduce((sum, col) => sum + widths[col.key], 0);
  const auto = cols.filter((col) => col.manual == null);

  let diff = Math.floor(available) - total();
  if (diff > 0) {
    const flexCols = auto.filter((col) => (col.flex ?? 0) > 0);
    const weight = flexCols.reduce((sum, col) => sum + (col.flex ?? 0), 0);
    if (weight > 0) {
      let given = 0;
      flexCols.forEach((col, i) => {
        const add =
          i === flexCols.length - 1 ? diff - given : Math.floor((diff * (col.flex ?? 0)) / weight);
        widths[col.key] += add;
        given += add;
      });
    }
    return widths;
  }

  const shrinkStages = [
    auto.filter((col) => (col.flex ?? 0) > 0),
    auto.filter((col) => !(col.flex ?? 0) && col.shrink),
  ];
  for (const stage of shrinkStages) {
    if (diff >= 0) break;
    const roomOf = (col: FitColumn) => Math.max(0, widths[col.key] - col.min);
    const room = stage.reduce((sum, col) => sum + roomOf(col), 0);
    if (room <= 0) continue;
    const need = Math.min(-diff, room);
    let taken = 0;
    for (const col of stage) {
      const cut = Math.min(roomOf(col), Math.floor((need * roomOf(col)) / room));
      widths[col.key] -= cut;
      taken += cut;
    }
    // 取整后的零头逐列补齐，避免差 1–2px 冒出横向滚动条
    for (const col of stage) {
      if (taken >= need) break;
      const cut = Math.min(roomOf(col), need - taken);
      widths[col.key] -= cut;
      taken += cut;
    }
    diff += taken;
  }
  return widths;
}

/** Return a new order with one column inserted immediately before/after target. */
export function moveColumn(
  order: readonly string[],
  movingKey: string,
  targetKey: string,
  after: boolean
): string[] {
  if (movingKey === targetKey) return [...order];

  const next = order.filter((key) => key !== movingKey);
  const targetIndex = next.indexOf(targetKey);
  if (targetIndex < 0 || order.indexOf(movingKey) < 0) return [...order];

  next.splice(targetIndex + (after ? 1 : 0), 0, movingKey);
  return next;
}

export function compareGroupSortValues(
  a: GroupSortValue,
  b: GroupSortValue
): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b), undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

/** Sort stable, numeric values numerically, and keep missing values at the end. */
export function sortRowsByGroupValue<T>(
  rows: readonly T[],
  valueOf: (row: T) => GroupSortValue,
  order: "ascending" | "descending"
): T[] {
  const direction = order === "descending" ? -1 : 1;
  return rows
    .map((row, index) => ({ row, index, value: valueOf(row) }))
    .sort((a, b) => {
      const aMissing = a.value === null || a.value === "";
      const bMissing = b.value === null || b.value === "";
      if (aMissing || bMissing) {
        if (aMissing && bMissing) return a.index - b.index;
        return aMissing ? 1 : -1;
      }
      const compared = direction * compareGroupSortValues(a.value, b.value);
      return compared === 0 ? a.index - b.index : compared;
    })
    .map(({ row }) => row);
}
