import { expect, test } from "bun:test";
import { diffContext, diffTextLines } from "../src/react/lib/text-diff";

test("单行变化保留上下文和两侧行号", () => {
  expect(diffTextLines("Host demo\n  Port 22\n  User root\n", "Host demo\n  Port 2222\n  User root\n")).toEqual([
    { kind: "same", text: "Host demo\n", beforeLine: 1, afterLine: 1 },
    { kind: "removed", text: "  Port 22\n", beforeLine: 2, afterLine: undefined },
    { kind: "added", text: "  Port 2222\n", beforeLine: undefined, afterLine: 2 },
    { kind: "same", text: "  User root\n", beforeLine: 3, afterLine: 3 },
  ]);
});

test.each([
  ["", ""], ["", "\n"], ["Host demo\n", ""], ["Host demo", "Host demo\n"],
  ["a\r\nb\r\n", "a\nb\n"], ["a\rb\r", "a\rb"], ["a\na\nb\n", "a\nb\na\n"],
  ["a\nb\nc\nd\n", "b\nc\nx\nd\ny\n"],
  ["old\n".repeat(1100), "new\n".repeat(1100)],
])("差异可以完整还原两份输入 %#", (before, after) => {
  const rows = diffTextLines(before, after);
  expect(rows.filter((row) => row.kind !== "added").map((row) => row.text).join("")).toBe(before);
  expect(rows.filter((row) => row.kind !== "removed").map((row) => row.text).join("")).toBe(after);
  expect(rows.some((row) => row.kind !== "same")).toBe(before !== after);
});

test("折叠长段相同内容，但保留差异及前后三行上下文", () => {
  const before = Array.from({ length: 50 }, (_, i) => `${i}\n`).join("");
  const context = diffContext(diffTextLines(before, before.replace("25\n", "changed\n")));
  expect(context[0]).toBe(22);
  expect(context.at(-1)).toBe(21);
  expect(context.filter((row) => typeof row !== "number")).toHaveLength(8);
});
