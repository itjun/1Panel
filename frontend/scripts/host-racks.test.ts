import { describe, expect, test } from "bun:test";
import { hostRackRows, moveGroupInRacks, parseHostRacks, reconcileHostRacks, PINNED_RACK, UNGROUPED_RACK } from "../src/utils/hostRacks";

const legacy = () => parseHostRacks(undefined, [["a", "b"], ["c", "d"], ["e"]]);

describe("首页机柜身份与名称", () => {
  test("旧布局迁移保留排布，固定置顶和未分组机柜", () => {
    const racks = legacy();
    expect(hostRackRows(racks)).toEqual([["a", "b"], ["c", "d"], ["e"]]);
    expect(racks[0].id).toBe(PINNED_RACK);
    expect(racks.at(-1)?.id).toBe(UNGROUPED_RACK);
  });

  test("置顶排全部移到下排后，下排不会并入置顶；重新加载仍独立", () => {
    const original = legacy();
    let moved = moveGroupInRacks(original, "a", { kind: "block", target: "d", after: true }, "unused");
    moved = moveGroupInRacks(moved, "b", { kind: "block", target: "a", after: true }, "unused");
    const restored = reconcileHostRacks(parseHostRacks(JSON.parse(JSON.stringify(moved)), []), ["a", "b", "c", "d", "e"]);
    expect(hostRackRows(restored)).toEqual([[], ["c", "d", "a", "b"], ["e"]]);
    expect(restored[1].id).toBe(original[1].id);
    expect(hostRackRows(original)).toEqual([["a", "b"], ["c", "d"], ["e"]]);
  });

  test("可移回仅剩置顶块的机柜，名称不跟随排号或分组移动", () => {
    const racks = legacy();
    racks[0].name = "常用服务";
    racks[1].name = "生产环境";
    racks[2].name = "测试环境";
    const moved = moveGroupInRacks(racks, "e", { kind: "rack", rackId: PINNED_RACK }, "unused");
    expect(moved.map((rack) => rack.name)).toEqual(["常用服务", "生产环境", "测试环境", ""]);
    expect(moved[2].groups).toEqual([]);
    const split = moveGroupInRacks(moved, "a", { kind: "newRow", beforeRow: 1 }, "rack-new");
    expect(split[2]).toEqual(racks[1]);
    expect(split[1]).toEqual({ id: "rack-new", name: "", groups: ["a"] });
  });

  test("对账删除旧分组、去重、追加新分组，保留命名空机柜", () => {
    const racks = legacy();
    racks[1].name = "生产环境";
    racks[1].groups.push("a");
    const next = reconcileHostRacks(racks, ["a", "e", "new"]);
    expect(hostRackRows(next)).toEqual([["a"], [], ["e", "new"]]);
    expect(next[1].name).toBe("生产环境");
  });

  test("普通机柜拖空后删除，其他机柜的名称身份不变", () => {
    const racks = legacy();
    racks[1].name = "生产环境";
    const next = moveGroupInRacks(racks, "e", { kind: "block", target: "c", after: false }, "unused");
    expect(next.map((rack) => rack.id)).toEqual([PINNED_RACK, racks[1].id, UNGROUPED_RACK]);
    expect(next[1].name).toBe("生产环境");
  });

  test("不存在的落点、自身落点、未分组机柜不会丢失原分组", () => {
    const racks = legacy();
    for (const mark of [
      { kind: "block", target: "missing", after: false },
      { kind: "block", target: "a", after: false },
      { kind: "rack", rackId: UNGROUPED_RACK },
      { kind: "rack", rackId: "missing" },
    ] as const) expect(moveGroupInRacks(racks, "a", mark, "new")).toEqual(racks);
  });

  test("新排始终位于固定置顶与未分组之间", () => {
    for (const beforeRow of [0, 100]) {
      const moved = moveGroupInRacks(legacy(), "a", { kind: "newRow", beforeRow }, "new");
      expect(moved[0].id).toBe(PINNED_RACK);
      expect(moved.at(-1)?.id).toBe(UNGROUPED_RACK);
      expect(moved.flatMap((rack) => rack.groups).sort()).toEqual(["a", "b", "c", "d", "e"]);
    }
  });

  test("无布局和损坏记录均补齐固定机柜，名称可往返保存", () => {
    expect(hostRackRows(reconcileHostRacks(parseHostRacks(undefined, []), ["a"]))).toEqual([["a"]]);
    const racks = parseHostRacks([null, {}, { id: "custom", name: "  中文机柜  ", groups: ["a", 1] }, { id: "custom", name: "重复", groups: [] }], []);
    expect(racks[1]).toEqual({ id: "custom", name: "中文机柜", groups: ["a"] });
    expect(parseHostRacks(JSON.parse(JSON.stringify(racks)), [])).toEqual(racks);
  });
});
