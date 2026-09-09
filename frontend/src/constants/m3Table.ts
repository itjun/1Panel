/**
 * M3 数据表统一尺寸（唯一来源）。
 * - el-table：靠 CSS 变量 `--m3-table-row-height` / `--m3-table-header-height`（见 index.scss `.data-table-unified`）
 * - el-table-v2：靠本常量的 `:row-height` / `:header-height`
 * 分组主机表与各主机页签表格共用，禁止页签内再写一套行高。
 */
export const M3_TABLE_ROW_HEIGHT = 52;
export const M3_TABLE_HEADER_HEIGHT = 48;

export function zebraRowClass({ rowIndex }: { rowIndex: number }): string {
  return rowIndex % 2 === 1 ? "zebra-row" : "";
}
