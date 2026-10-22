import { describe, expect, test } from "bun:test";
import {
  buildRailGroups,
  groupRailKey,
  railOrderOf,
  reorderRailGroups,
  resolveRailDrop,
  type RailGroup,
} from "../src/utils/railGroups";

const ungroupedId = "__ungrouped__";
const membership: Record<string, string> = { a1: "A", a2: "A", b1: "B", b2: "B", A: "A" };
const build = (openedHosts: string[], visitedGroupIds: string[] = [], railOrder: string[] = []) =>
  buildRailGroups({ openedHosts, visitedGroupIds, railOrder, groupIdOf: (name) => membership[name] || "", ungroupedId });
const blocks: RailGroup[] = [
  { kind: "group", id: "A", key: groupRailKey("A"), hosts: ["a1", "a2"] },
  { kind: "group", id: "B", key: groupRailKey("B"), hosts: ["b1", "b2"] },
  { kind: "group", id: "empty", key: groupRailKey("empty"), hosts: [] },
];

describe("侧栏打开内容跟随分组", () => {
  test("恢复旧的散列顺序时，保留分组顺序并聚合组内主机", () => {
    expect(railOrderOf(build(["a1", "b1", "a2"], ["B", "A"], ["group:B", "a1", "a2", "b1", "group:A"])))
      .toEqual(["group:B", "b1", "group:A", "a1", "a2"]);
  });

  test("从全部主机打开主机时不带出分组，主机单独列出", () => {
    expect(railOrderOf(build(["a1", "b1", "a2", "free"], [], ["group:A", "a1", "group:B", "b1"])))
      .toEqual(["a1", "b1", "a2", "free"]);
    expect(railOrderOf(build(["a1", "b1", "a2"], ["A"], ["a1", "b1"])))
      .toEqual(["group:A", "a1", "a2", "b1"]);
  });

  test("兼容旧分组键，去掉重复条目和已关闭的主机", () => {
    expect(railOrderOf(build(["a1", "a1", "b1"], ["A", "B", "B"], ["B", "b1", "closed", "A", "a1", "a1"])))
      .toEqual(["group:B", "b1", "group:A", "a1"]);
  });

  test("同名主机与分组保持独立", () => {
    expect(railOrderOf(build(["A", "b1"], ["A", "B"], ["group:B", "b1", "group:A", "A"])))
      .toEqual(["group:B", "b1", "group:A", "A"]);
  });

  test("主机更换归属后，显示位置跟随当前配置", () => {
    const next = buildRailGroups({
      openedHosts: ["a1", "b1", "a2"], visitedGroupIds: ["A", "B"],
      railOrder: ["group:A", "a1", "a2", "group:B", "b1"],
      groupIdOf: (name) => name === "a2" ? "B" : membership[name], ungroupedId,
    });
    expect(railOrderOf(next)).toEqual(["group:A", "a1", "group:B", "a2", "b1"]);
  });

  test("关闭分组页保留仍在打开的主机，空分组页可以关闭", () => {
    expect(build(["a1"], [])).toEqual([{ kind: "host", name: "a1" }]);
    expect(build([], ["A"])).toEqual([{ kind: "group", id: "A", key: "group:A", hosts: [] }]);
    expect(build([], [])).toEqual([]);
  });
});

describe("拖动分组整体移动", () => {
  test("落在另一组的主机上时，整组插入目标组之前或之后", () => {
    for (const before of [true, false]) {
      const drop = resolveRailDrop(blocks, "group:A", "b1", before)!;
      expect(drop).toEqual({ key: "group:B", before });
      const next = reorderRailGroups(blocks, "group:A", drop)!;
      expect(railOrderOf(next)).toEqual(before
        ? ["group:A", "a1", "a2", "group:B", "b1", "b2", "group:empty"]
        : ["group:B", "b1", "b2", "group:A", "a1", "a2", "group:empty"]);
      expect(blocks[0].hosts).toEqual(["a1", "a2"]);
    }
  });

  test("支持向上移动、空分组移动和持久化后的恢复", () => {
    const next = reorderRailGroups(blocks, "group:empty", { key: "a1", before: true })!;
    expect(railOrderOf(next)).toEqual(["group:empty", "group:A", "a1", "a2", "group:B", "b1", "b2"]);
    expect(build(["a1", "a2", "b1", "b2"], ["A", "B", "empty"], railOrderOf(next))).toEqual(next);
  });

  test("分组不能插入自己的内容中，主机不能拖离所属分组", () => {
    expect(resolveRailDrop(blocks, "group:A", "a2", false)).toBeNull();
    expect(reorderRailGroups(blocks, "a1", { key: "b1", before: false })).toBeNull();
    expect(reorderRailGroups(blocks, "missing", { key: "b1", before: false })).toBeNull();
  });

  test("组内主机仍可排序，拖到组标题移到组内首位", () => {
    const moved = reorderRailGroups(blocks, "a1", { key: "a2", before: false })!;
    expect(railOrderOf(moved)).toEqual(["group:A", "a2", "a1", "group:B", "b1", "b2", "group:empty"]);
    expect(reorderRailGroups(moved, "a1", { key: "group:A", before: true })).toEqual(blocks);
  });
});
