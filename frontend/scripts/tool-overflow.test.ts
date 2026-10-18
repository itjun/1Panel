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

import { measuredToolIndices } from "../src/utils/toolOverflow";
describe("measured device tool navigation", () => {
  test("variable labels and larger fonts fit without hiding the active tool", () => {
    for (const widths of [[52, 76, 61, 104, 88], [90, 140, 100, 170, 130]]) {
      for (const available of [230, 320, 500, 900]) {
        for (let active = 0; active < widths.length; active++) {
          const result = measuredToolIndices(widths, available, active, 64);
          expect(result).toContain(active);
          expect(result).toEqual([...new Set(result)].sort((a, b) => a - b));
          const used = result.reduce((sum, index) => sum + widths[index], 0) + (result.length < widths.length ? 64 : 0);
          if (available >= widths[active] + 64) expect(used).toBeLessThanOrEqual(available);
        }
      }
    }
  });
  test("an exactly fitting complete toolbar has no unnecessary More menu", () => {
    expect(measuredToolIndices([52, 72, 94], 218, 2, 64)).toEqual([0, 1, 2]);
    expect(measuredToolIndices([52, 72, 94], 0, 2, 64)).toEqual([2]);
  });
});
