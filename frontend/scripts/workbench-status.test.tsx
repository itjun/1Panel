import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { Meter } from "../src/react/components/ui/meter";
import { collectionState } from "../src/utils/collectionState";

const pending = { data: undefined, isError: false, isFetching: true, failureCount: 0, errorUpdatedAt: 0, dataUpdatedAt: 0 };
describe("collection state across polling and retries", () => {
  test("first request has no last-known reading", () => {
    expect(collectionState(pending)).toMatchObject({ unavailable: false, sampleLabel: "首次采样中…" });
  });
  test("connection failure and retries never revert to first loading", () => {
    expect(collectionState(pending, true)).toMatchObject({ unavailable: true, sampleLabel: "暂无有效读数" });
    expect(collectionState({ ...pending, failureCount: 1 }).label).toBe("采集异常 · 重试中");
    expect(collectionState({ ...pending, errorUpdatedAt: 20 })).toMatchObject({ unavailable: true, hasData: false, sampleLabel: "暂无有效读数" });
  });
  test("cached results stay explicitly stale until a new successful sample", () => {
    const cached = { ...pending, data: { cpuPercent: 0 }, dataUpdatedAt: 10, errorUpdatedAt: 20 };
    expect(collectionState(cached)).toMatchObject({ unavailable: true, sampleLabel: "最后已知读数" });
    expect(collectionState({ ...cached, dataUpdatedAt: 30 })).toMatchObject({ unavailable: false, label: "采集正常", sampleLabel: "当前" });
  });
});

describe("unknown resource accessibility", () => {
  test("unknown readings never expose a numeric meter", () => {
    for (const value of [undefined, NaN]) {
      for (const showValue of [true, false]) {
        const html = renderToStaticMarkup(<Meter value={value} showValue={showValue} />);
        expect(html).not.toContain('role="meter"');
        expect(html).not.toContain("aria-value");
        expect(html).toContain(showValue ? "—" : "暂无数据");
      }
    }
  });
  test("a genuine zero remains a valid numeric meter", () => {
    const html = renderToStaticMarkup(<Meter value={0} />);
    expect(html).toContain('role="meter"');
    expect(html).toContain('aria-valuenow="0"');
    expect(html).toContain("0.0%");
  });
});
