import { describe, expect, test } from "bun:test";
import { pickBoardLayout } from "../src/utils/boardLayout";

describe("overview layout follows usable screen space", () => {
  test("the same eight hosts show histories on a large screen and compact cards in a small window", () => {
    const large = pickBoardLayout({ width: 1840, height: 860, hostCount: 8 });
    const small = pickBoardLayout({ width: 1224, height: 480, hostCount: 8 });
    expect(large.mode).toBe("trends");
    expect(large.columns).toBe(4);
    expect(large.rows).toBe(2);
    expect(large.overflow).toBe(false);
    expect(small.mode).toBe("grid");
    expect(small.columns).toBe(3);
    expect(small.overflow).toBe(true);
    expect(small.cardMinHeight).toBe(172);
  });

  test("twelve hosts on a 1080p screen use the fewest columns that fit all hosts", () => {
    const layout = pickBoardLayout({ width: 1840, height: 860, hostCount: 12 });
    expect(layout.mode).toBe("grid");
    expect(layout.columns).toBe(3);
    expect(layout.rows).toBe(4);
    expect(layout.capacity).toBe(12);
    expect(layout.overflow).toBe(false);
  });

  test("24 hosts on a 4K screen stay readable and fit in a four-column grid", () => {
    const layout = pickBoardLayout({ width: 3720, height: 1800, hostCount: 24 });
    expect(layout.scale).toBe(1.5);
    expect(layout.mode).toBe("grid");
    expect(layout.columns).toBe(4);
    expect(layout.rows).toBe(6);
    expect(layout.overflow).toBe(false);
  });

  test("a narrow window uses a single column and vertical scrolling", () => {
    const layout = pickBoardLayout({ width: 320, height: 550, hostCount: 12 });
    expect(layout.mode).toBe("grid");
    expect(layout.columns).toBe(1);
    expect(layout.capacity).toBe(3);
    expect(layout.overflow).toBe(true);
    expect(layout.scale).toBe(1);
  });

  test("spare height increases spacing without changing the capacity decision", () => {
    const trends = pickBoardLayout({ width: 1880, height: 920, hostCount: 8 });
    expect(trends.cardHeight).toBe(451);
    const grid = pickBoardLayout({ width: 1880, height: 920, hostCount: 12 });
    expect(grid.cardHeight).toBe(216);
    expect(grid.rows * grid.cardHeight + (grid.rows - 1) * grid.gap).toBeLessThanOrEqual(920);
  });

  test("one, two, three, four, five and eight hosts use deliberate readable arrangements", () => {
    for (const [hostCount, columns, rows] of [[1, 1, 1], [2, 2, 1], [3, 3, 1], [4, 2, 2], [5, 3, 2], [8, 4, 2]]) {
      const layout = pickBoardLayout({ width: 1880, height: 920, hostCount });
      expect(layout.mode).toBe("trends");
      expect(layout.columns).toBe(columns);
      expect(layout.rows).toBe(rows);
      expect(layout.cardHeight).toBeGreaterThanOrEqual(layout.cardMinHeight);
    }
  });

  test("sixteen histories fit on a 4K display but fall back to overview at 1080p", () => {
    const large = pickBoardLayout({ width: 3768, height: 1853, hostCount: 16 });
    expect(large.mode).toBe("trends");
    expect(large.columns).toBe(4);
    expect(large.rows).toBe(4);
    expect(pickBoardLayout({ width: 1880, height: 860, hostCount: 16 }).mode).toBe("grid");
  });

  test("history admission includes both axes, gaps and scaled minimum plot space", () => {
    const fits = { width: 812, height: 588, hostCount: 4 };
    expect(pickBoardLayout(fits).mode).toBe("trends");
    expect(pickBoardLayout({ ...fits, width: 811 }).mode).not.toBe("trends");
    expect(pickBoardLayout({ ...fits, height: 587 }).mode).not.toBe("trends");
    expect(pickBoardLayout({ ...fits, scale: 1.5 }).mode).not.toBe("trends");
    expect(pickBoardLayout({ width: 400, height: 588, hostCount: 2 }).columns).toBe(1);
    expect(pickBoardLayout({ width: 400, height: 588, hostCount: 2 }).mode).toBe("trends");
  });

  test("an extremely short window preserves card size and never claims a full host is visible", () => {
    const layout = pickBoardLayout({ width: 1224, height: 80, hostCount: 12 });
    expect(layout.capacity).toBe(0);
    expect(layout.columns).toBe(3);
    expect(layout.cardMinHeight).toBe(172);
    expect(layout.overflow).toBe(true);
  });

  test("table fit accounts for its header and uses a stable exact boundary", () => {
    const fits = { width: 1224, height: 464, hostCount: 5 };
    expect(pickBoardLayout(fits).mode).toBe("table");
    expect(pickBoardLayout({ ...fits, height: 463 }).mode).toBe("grid");
    expect(pickBoardLayout({ ...fits, height: 464.9 })).toEqual(pickBoardLayout(fits));
    expect(pickBoardLayout({ ...fits, width: 1039 }).mode).toBe("grid");
  });

  test("explicit display scaling cannot squeeze text below the readable minimum", () => {
    const small = pickBoardLayout({ width: 1224, height: 480, hostCount: 8, scale: 0.5 });
    const large = pickBoardLayout({ width: 1840, height: 860, hostCount: 8, scale: 1.5 });
    expect(small.scale).toBe(1);
    expect(small.tableRowHeight).toBe(84);
    expect(large.scale).toBe(1.5);
    expect(large.mode).toBe("grid");
    expect(large.tableRowHeight).toBe(126);
  });

  test("zero hosts and unmeasured areas produce finite, non-negative geometry", () => {
    for (const input of [
      { width: 0, height: 0, hostCount: 0 },
      { width: NaN, height: Infinity, hostCount: 8, scale: NaN },
      { width: -1, height: -1, hostCount: -1 },
    ]) {
      const layout = pickBoardLayout(input);
      for (const value of Object.values(layout)) {
        if (typeof value === "number") {
          expect(Number.isFinite(value)).toBe(true);
          expect(value).toBeGreaterThanOrEqual(0);
        }
      }
    }
    expect(pickBoardLayout({ width: 0, height: 0, hostCount: 0 }).overflow).toBe(false);
  });

  test("one through forty hosts never overflow silently or exceed the usable width", () => {
    for (const [width, height] of [[1224, 480], [1840, 860], [3720, 1800]]) {
      for (let hostCount = 1; hostCount <= 40; hostCount++) {
        const layout = pickBoardLayout({ width, height, hostCount });
        expect(layout.overflow).toBe(hostCount > layout.capacity);
        if (layout.mode === "table") {
          expect(layout.tableHeaderHeight + hostCount * layout.tableRowHeight).toBeLessThanOrEqual(height);
        } else {
          expect(layout.columns * layout.cardMinWidth + (layout.columns - 1) * layout.gap).toBeLessThanOrEqual(width);
          if (!layout.overflow) {
            expect(layout.rows * layout.cardHeight + (layout.rows - 1) * layout.gap).toBeLessThanOrEqual(height);
          }
        }
      }
    }
  });
});
