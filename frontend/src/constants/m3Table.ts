/** M3 数据表统一行高（el-table / el-table-v2 共用） */
export const M3_TABLE_ROW_HEIGHT = 40;
export const M3_TABLE_HEADER_HEIGHT = 44;

export function zebraRowClass({ rowIndex }: { rowIndex: number }): string {
  return rowIndex % 2 === 1 ? "zebra-row" : "";
}
