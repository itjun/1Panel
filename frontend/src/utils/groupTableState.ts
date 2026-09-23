export interface HeaderColumnBox {
  key: string;
  left: number;
  right: number;
  width: number;
}

export interface ResizeTarget {
  key: string;
  startWidth: number;
}

export type GroupSortValue = string | number | null;

/**
 * Resolve the column whose width should change for a pointer near a header
 * boundary. The left edge belongs to the column on the left, so its measured
 * width must be used as the drag baseline.
 */
export function resolveResizeTarget(
  columns: readonly HeaderColumnBox[],
  hoveredKey: string,
  clientX: number,
  zone = 8
): ResizeTarget | null {
  const index = columns.findIndex((column) => column.key === hoveredKey);
  if (index < 0) return null;

  const hovered = columns[index];
  if (hovered.right - clientX <= zone) {
    return { key: hovered.key, startWidth: hovered.width };
  }

  if (index > 0 && clientX - hovered.left <= zone) {
    const left = columns[index - 1];
    return { key: left.key, startWidth: left.width };
  }

  return null;
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
