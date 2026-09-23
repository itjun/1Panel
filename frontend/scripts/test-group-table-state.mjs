import {
  compareGroupSortValues,
  moveColumn,
  resolveResizeTarget,
  sortRowsByGroupValue,
} from "../src/utils/groupTableState.ts";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const columns = [
  { key: "host", left: 0, right: 220, width: 220 },
  { key: "addr", left: 220, right: 320, width: 100 },
  { key: "agent", left: 320, right: 420, width: 100 },
];

const leftBoundary = resolveResizeTarget(columns, "addr", 222, 8);
assert(leftBoundary?.key === "host", "左边界应该调整左邻列");
assert(leftBoundary?.startWidth === 220, "左边界应该读取左邻列的实际宽度");

const rightBoundary = resolveResizeTarget(columns, "addr", 318, 8);
assert(rightBoundary?.key === "addr", "右边界应该调整当前列");
assert(rightBoundary?.startWidth === 100, "右边界应该读取当前列的实际宽度");

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
