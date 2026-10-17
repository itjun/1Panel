import { describe, expect, test } from "bun:test";
import { currentGroupSample } from "../src/utils/groupSnapshot";
import { moveColumn } from "../src/utils/groupTableState";

describe("group current readings", () => {
  const snapshot = { overview: { cpuCount: 8, cpuPercent: 0, memTotal: 16000 }, disks: [{ percent: 45 }] };
  test("a genuine zero utilization remains a valid reading", () => {
    expect(currentGroupSample(snapshot).overview?.cpuPercent).toBe(0);
    expect(currentGroupSample(snapshot).disks).toEqual(snapshot.disks);
  });
  test("partial zero-filled snapshots from a failed collection are unknown", () => {
    const failed = { ...snapshot, overview: { cpuCount: 0, cpuPercent: 0, memTotal: 0 }, error: "timeout" };
    expect(currentGroupSample(failed)).toEqual({ overview: null, disks: undefined });
  });
  test("an installed-status failure or unavailable group cannot expose stale current readings", () => {
    expect(currentGroupSample({ ...snapshot, notInstalled: true }).overview).toBeNull();
    expect(currentGroupSample(snapshot, true)).toEqual({ overview: null, disks: undefined });
    expect(currentGroupSample()).toEqual({ overview: null, disks: undefined });
  });
  test("reordering visible columns retains the hidden columns and their settings slots", () => {
    const fullOrder = ["host", "addr", "agent", "user", "cpu", "mem", "disk"];
    const moved = moveColumn(fullOrder, "disk", "cpu", false);
    expect(moved).toEqual(["host", "addr", "agent", "user", "disk", "cpu", "mem"]);
    expect(moved.filter(key => !["addr", "user"].includes(key))).toEqual(["host", "agent", "disk", "cpu", "mem"]);
  });
});
