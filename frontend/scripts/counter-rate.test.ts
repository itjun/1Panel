import { expect, test } from "bun:test";
import { counterRate } from "../src/utils/counterRate";
test("traffic uses actual elapsed time, including idle links", () => {
  expect(counterRate(100, 5100, 5000)).toBe(1000);
  expect(counterRate(100, 100, 5000)).toBe(0);
});
test("missing, invalid, reset and stale counters remain unavailable", () => {
  expect(counterRate(undefined, 100, 5000)).toBeUndefined();
  expect(counterRate(100, 0, 5000)).toBeUndefined();
  expect(counterRate(100, NaN, 5000)).toBeUndefined();
  expect(counterRate(100, 200, 0)).toBeUndefined();
  expect(counterRate(100, 200, 60000)).toBeUndefined();
});
