import { describe, expect, test } from "bun:test";
import { visibleToolIndices } from "../src/utils/toolOverflow";
describe("adaptive host tool navigation", () => {
  test("wide windows keep every tool in source order", () => {
    expect(visibleToolIndices(15, 960, 14)).toEqual(
      Array.from({ length: 15 }, (_, i) => i),
    );
  });
  test("narrow windows reserve More and keep the active trailing tool visible", () => {
    const result = visibleToolIndices(15, 400, 14);
    expect(result).toEqual([0, 1, 2, 3, 14]);
    expect(result.length * 64 + 76).toBeLessThanOrEqual(400);
    expect(new Set(result).size).toBe(result.length);
  });
  test("a visible active tool does not reorder its peers", () => {
    expect(visibleToolIndices(15, 400, 2)).toEqual([0, 1, 2, 3, 4]);
  });
  test("initial measurement and minimal width retain an active entry", () => {
    expect(visibleToolIndices(15, 0, 12)).toEqual([12]);
    expect(visibleToolIndices(15, 140, 0)).toEqual([0]);
  });
});
