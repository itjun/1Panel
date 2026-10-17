import {
  compareGroupSortValues,
  moveColumn,
  fitColumnWidths,
  sortRowsByGroupValue,
} from "../src/utils/groupTableState.ts";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const columns = [
  { key: "host", natural: 190, min: 168, flex: 1 },
  { key: "addr", natural: 176, min: 176 },
  { key: "cpu", natural: 120, min: 112, flex: 2 },
];
const narrow = fitColumnWidths(columns, 300);
assert(narrow.host >= 168 && narrow.addr >= 176 && narrow.cpu >= 112, "窄窗口不能把身份和指标压到最小宽度以下");
assert(Object.values(narrow).reduce((sum, width) => sum + width, 0) > 300, "无法容纳时应保留可读宽度并允许横向滚动");
const manual = fitColumnWidths(columns.map(c => c.key === "host" ? { ...c, manual: 240 } : c), 800);
assert(manual.host === 240, "手动列宽应在容器变化后保持不变");
const wide = fitColumnWidths(columns, 800);
assert(Object.values(wide).reduce((sum, width) => sum + width, 0) === 800, "宽窗口应按权重分配可用空间");

assert(
  JSON.stringify(moveColumn(["index", "host", "addr"], "addr", "index", false)) ===
    JSON.stringify(["addr", "index", "host"]),
  "列拖动应该支持插入到目标列之前"
);

const rows = [
  { name: "host-10", value: 10 },
  { name: "host-2", value: 2 },
  { name: "host-unknown", value: null },
];
assert(compareGroupSortValues(10, 2) > 0, "数字排序应该按数值比较");
assert(
  sortRowsByGroupValue(rows, (row) => row.value, "ascending")
    .map((row) => row.name)
    .join(",") === "host-2,host-10,host-unknown",
  "升序应该使用数值排序并把空值放到末尾"
);
assert(
  sortRowsByGroupValue(rows, (row) => row.value, "descending")
    .map((row) => row.name)
    .join(",") === "host-10,host-2,host-unknown",
  "降序应该使用数值排序并把空值放到末尾"
);

console.log("group-table-state: ok");
