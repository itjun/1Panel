import { describe, expect, test } from "bun:test";
import { hostRackColumnCount, hostRackGroupColumns } from "../src/utils/hostRackLayout";

describe("横向机柜布局", () => {
  test("卡片至少 240px，宽屏最多六列，窄窗换行而不压小卡片", () => {
    expect(hostRackColumnCount(1559, 240, 24)).toBe(5);
    expect(hostRackColumnCount(1560, 240, 24)).toBe(6);
    expect(hostRackColumnCount(4000, 240, 24)).toBe(6);
    expect(hostRackColumnCount(1235, 240, 24)).toBe(4);
    expect(hostRackColumnCount(585, 240, 24)).toBe(2);
    expect(hostRackColumnCount(0, 240, 24)).toBe(1);
  });

  test("顶部四台与两台分组合占六列，分组宽度跟随匹配数量", () => {
    const columns = hostRackColumnCount(1800, 240, 24);
    expect([4, 2].map(count => hostRackGroupColumns(count, columns, false))).toEqual([4, 2]);
    expect(hostRackGroupColumns(1, columns, false)).toBe(1);
    expect(hostRackGroupColumns(2, columns, false)).toBe(2);
  });

  test("大组占满整排后内部换行；空组和折叠组收为一列", () => {
    expect(hostRackGroupColumns(8, 6, false)).toBe(6);
    expect(hostRackGroupColumns(4, 3, false)).toBe(3);
    expect(hostRackGroupColumns(0, 6, false)).toBe(1);
    expect(hostRackGroupColumns(4, 6, true)).toBe(1);
    expect(hostRackGroupColumns(8, 1, false)).toBe(1);
  });
});
