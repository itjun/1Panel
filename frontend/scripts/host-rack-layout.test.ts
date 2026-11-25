import { describe, expect, test } from "bun:test";
import { hostRackColumnCount, hostRackGroupColumns } from "../src/utils/hostRackLayout";

describe("横向机柜布局", () => {
  test("卡片至少 240px，宽屏最多六列，窄窗换行而不压小卡片", () => {
    expect(hostRackColumnCount(1499, 240, 12)).toBe(5);
    expect(hostRackColumnCount(1500, 240, 12)).toBe(6);
    expect(hostRackColumnCount(4000, 240, 12)).toBe(6);
    expect(hostRackColumnCount(1247, 240, 12)).toBe(4);
    expect(hostRackColumnCount(585, 240, 12)).toBe(2);
    expect(hostRackColumnCount(0, 240, 12)).toBe(1);
  });

  test("顶部四台与两台分组合占六列，分组宽度跟随匹配数量", () => {
    const columns = hostRackColumnCount(1800, 240, 12);
    expect([4, 2].map(count => hostRackGroupColumns(count, columns))).toEqual([4, 2]);
    expect(hostRackGroupColumns(1, columns)).toBe(1);
    expect(hostRackGroupColumns(2, columns)).toBe(2);
  });

  test("大组占满整排后内部换行；空组占一列", () => {
    expect(hostRackGroupColumns(8, 6)).toBe(6);
    expect(hostRackGroupColumns(4, 3)).toBe(3);
    expect(hostRackGroupColumns(0, 6)).toBe(1);
    expect(hostRackGroupColumns(4, 6)).toBe(4);
    expect(hostRackGroupColumns(8, 1)).toBe(1);
  });
});
