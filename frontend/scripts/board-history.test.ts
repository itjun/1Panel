import { describe, expect, test } from "bun:test";
import { boardHistorySeries, normalizeBoardHistory } from "../src/utils/boardHistory";

const start = 1_792_000_000;
function point(ts: number, cpuPercent = 12, memUsed = 1024) {
  return { ts, cpuPercent, memUsed, load1: 0, netRxKBps: 0, netTxKBps: 0, diskReadKBps: 0, diskWriteKBps: 0 };
}

describe("board history uses actual samples", () => {
  test("keeps all 720 samples, exact timestamps and short CPU peaks", () => {
    const input = Array.from({ length: 720 }, (_, i) => point(start + i * 5, i === 333 ? 99 : 2));
    const result = normalizeBoardHistory(input, start * 1000, (start + 3600) * 1000);
    expect(result).toHaveLength(720);
    expect(result[333]).toEqual({ at: (start + 333 * 5) * 1000, cpu: 99, memUsed: 1024 });
    expect(boardHistorySeries(result, 4096).mem[333]).toEqual([(start + 333 * 5) * 1000, 25]);
  });
  test("sorts and deduplicates timestamps, dropping samples outside the requested range", () => {
    const result = normalizeBoardHistory([
      point(start + 10, 10), point(start - 1), point(start + 5, 5),
      point(start + 10, 20), point(start + 31), point(NaN),
    ], start * 1000, (start + 30) * 1000);
    expect(result.map((p) => [p.at, p.cpu])).toEqual([[(start + 5) * 1000, 5], [(start + 10) * 1000, 20]]);
  });
  test("invalid values stay missing; real zero is preserved", () => {
    const result = normalizeBoardHistory([point(start, NaN, -1), point(start + 5, 0, 0), point(start + 10, 101, Infinity)], start * 1000, (start + 30) * 1000);
    expect(result.map((p) => p.cpu)).toEqual([null, 0, null]);
    expect(boardHistorySeries(result, 4096).mem.map((p) => p[1])).toEqual([null, 0, null]);
  });
  test("history arriving before overview does not invent memory percentages", () => {
    const result = normalizeBoardHistory([point(start)], start * 1000, (start + 30) * 1000);
    expect(boardHistorySeries(result).mem[0][1]).toBeNull();
    expect(boardHistorySeries(result, 0).mem[0][1]).toBeNull();
    expect(boardHistorySeries(result, 4096).mem[0][1]).toBe(25);
    expect(boardHistorySeries(result, 512).mem[0][1]).toBeNull();
  });
  test("offline gaps split curves instead of interpolating a healthy interval", () => {
    const input = [0, 5, 10, 15, 180, 185, 190].map((delta) => point(start + delta));
    const result = boardHistorySeries(normalizeBoardHistory(input, start * 1000, (start + 3600) * 1000), 4096);
    expect(result.cpu).toHaveLength(8);
    expect(result.cpu[4]).toEqual([(start + 20) * 1000, null]);
    expect(result.mem[4]).toEqual([(start + 20) * 1000, null]);
    expect(result.cpu[5]).toEqual([(start + 180) * 1000, 12]);
  });
  test("an empty range produces empty curves", () => {
    expect(boardHistorySeries(normalizeBoardHistory([], 0, 3600000), 4096)).toEqual({ cpu: [], mem: [] });
  });
});
