import {
  moveGroupInRows,
  reconcileHostRows,
} from "../src/utils/hostRows.ts";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertRows(actual, expected, message) {
  assert(
    JSON.stringify(actual) === JSON.stringify(expected),
    `${message}：期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}`,
  );
}

// ---- reconcileHostRows：布局对账 ----

// 从未保存过布局：全部分组按 order 放一排
assertRows(reconcileHostRows([], ["a", "b", "c"]), [["a", "b", "c"]], "无布局时全部一排");

// 保存过布局：照原样返回
assertRows(reconcileHostRows([["a", "b"], ["c"]], ["c", "a", "b"]), [["a", "b"], ["c"]], "已有布局保持用户排布");

// 已删除的分组 id 丢弃，空排去掉
assertRows(reconcileHostRows([["x"], ["a"], []], ["a", "b"]), [["a", "b"]], "未知 id 丢弃且空排去掉");

// 重复 id 只保留第一次出现
assertRows(reconcileHostRows([["a", "a", "b"]], ["a", "b"]), [["a", "b"]], "重复 id 去重");

// 新建分组（不在布局里）追加到最后一排末尾
assertRows(reconcileHostRows([["a"], ["b"]], ["a", "b", "new"]), [["a"], ["b", "new"]], "新分组追加到最后一排末尾");

// ---- moveGroupInRows：拖拽落点 ----

// 同排内换位：插到目标之后
assertRows(
  moveGroupInRows([["a", "b", "c"]], "a", { kind: "block", target: "b", after: true }),
  [["b", "a", "c"]],
  "同排插到目标之后",
);

// 跨排移动：插到另一排目标之前
assertRows(
  moveGroupInRows([["a", "b"], ["c"]], "c", { kind: "block", target: "a", after: false }),
  [["c", "a", "b"]],
  "跨排插到目标之前",
);

// 跨排移动：插到另一排目标之后
assertRows(
  moveGroupInRows([["a", "b"], ["c"]], "a", { kind: "block", target: "c", after: true }),
  [["b"], ["c", "a"]],
  "跨排插到目标之后",
);

// 新建一排追加到最后
assertRows(
  moveGroupInRows([["a", "b"]], "a", { kind: "newRow", beforeRow: 1 }),
  [["b"], ["a"]],
  "新建一排追加到最后",
);

// 新建一排插在中间
assertRows(
  moveGroupInRows([["a", "b"], ["c"]], "a", { kind: "newRow", beforeRow: 1 }),
  [["b"], ["a"], ["c"]],
  "新建一排插在中间",
);

// 拖空原排后该排自动去掉
assertRows(
  moveGroupInRows([["a"], ["b"]], "a", { kind: "block", target: "b", after: true }),
  [["b", "a"]],
  "拖空的排去掉",
);

console.log("hostRows：全部断言通过");
