import { h } from "vue";

/**
 * M3 数据表统一尺寸（唯一来源）。
 * - el-table：靠 CSS 变量 `--m3-table-row-height` / `--m3-table-header-height`（见 index.scss `.data-table-unified`）
 * - el-table-v2：靠本常量的 `:row-height` / `:header-height`
 * 分组主机表与各主机页签表格共用，禁止页签内再写一套行高。
 */
export const M3_TABLE_ROW_HEIGHT = 52;
export const M3_TABLE_HEADER_HEIGHT = 48;
/** 「序」列宽：保底可舒适显示三位数（含单元格左右 padding） */
export const M3_TABLE_INDEX_WIDTH = 64;

export function zebraRowClass({ rowIndex }: { rowIndex: number }): string {
  return rowIndex % 2 === 1 ? "zebra-row" : "";
}

/** el-table-v2 首列：序（从 1 起） */
export function m3TableIndexColumn() {
  return {
    key: "__seq",
    title: "序",
    width: M3_TABLE_INDEX_WIDTH,
    align: "center" as const,
    cellRenderer: ({ rowIndex }: { rowIndex: number }) =>
      h("span", String(rowIndex + 1)),
  };
}
