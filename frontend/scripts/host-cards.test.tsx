import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { main, monitor } from "../src/api";
import { HostCardContent } from "../src/react/components/host-card";
import { hostCardView, summarizeHostCards } from "../src/utils/hostCardModel";
import { HostCardPoller, type HostCardEntry } from "../src/utils/hostCardPoller";

const now = 100000;
function snapshot(patch: Partial<main.HostCardSnapshot> = {}): main.HostCardSnapshot {
  return { name: "demo", connection: "online", agentState: "running", agentVersion: "1.2.3", sampledAt: now / 1000,
    overview: { cpuPercent: 0, memPercent: 25, memTotal: 8 * 1024 ** 3, cpuCount: 4, osRelease: "Ubuntu" } as monitor.Overview,
    disks: [{ kind: "disk", total: 200 * 1024 ** 3, used: 40 * 1024 ** 3, avail: 160 * 1024 ** 3 }] as monitor.DiskInfo[],
    error: "", overviewError: "", diskError: "", detailsIncluded: true, ...patch };
}
function entry(patch: Partial<main.HostCardSnapshot> = {}): HostCardEntry {
  return { snapshot: snapshot(patch), updatedAt: now, detailsAt: now };
}
const flush = () => new Promise(resolve => setTimeout(resolve, 0));

describe("紧凑主机卡状态", () => {
  test("零占用有效，不输出 SSH 地址；三个资源位置固定", () => {
    const html = renderToStaticMarkup(createElement(HostCardContent, { name: "demo", entry: entry(), now, onEdit() {} }));
    expect(html).toContain('aria-valuenow="0"');
    expect(html.match(/role="meter"/g)?.length).toBe(3);
    expect(html.indexOf('demo CPU')).toBeLessThan(html.indexOf('demo 内存'));
    expect(html.indexOf('demo 内存')).toBeLessThan(html.indexOf('demo 磁盘'));
    expect(html).toContain("Agent v1.2.3");
    expect(html).not.toContain("SSH");
  });

  test("未知、缺失、未运行、连接失败分别呈现，不把零结构当读数", () => {
    expect(hostCardView(undefined, now).isUnknown).toBe(true);
    for (const [connection, agentState, label] of [
      ["online", "missing", "Agent 未安装"], ["online", "stopped", "Agent 未运行"],
      ["failed", "unknown", "Agent 状态未知"],
    ]) {
      const view = hostCardView(entry({ connection, agentState, error: "unavailable" }), now);
      expect(view.agentLabel).toBe(label);
      expect(view.metrics.every(metric => metric.value == null)).toBe(true);
      expect(view.isAttention).toBe(true);
    }
    expect(hostCardView(entry({ connection: "failed", agentState: "unknown", error: "SSH failed" }), now).statusLabel).toBe("连接失败");
  });

  test("采集失败与过期撤下缓存仪表；磁盘单项失败保留 CPU/内存", () => {
    const failed = { ...entry(), error: "request failed" };
    expect(hostCardView(failed, now).metrics.every(metric => metric.value == null)).toBe(true);
    const stale = hostCardView(entry(), now + 15001);
    expect(stale.statusLabel).toBe("数据过期");
    expect(stale.metrics.every(metric => metric.value == null)).toBe(true);
    const partial = hostCardView(entry({ diskError: "disk failed" }), now);
    expect(partial.metrics.map(metric => metric.value)).toEqual([0, 25, undefined]);
    expect(partial.isAttention).toBe(true);
    const noSample = hostCardView(entry({ overview: null, overviewError: "尚无采样数据" }), now);
    expect(noSample.connection).toBe("online");
    expect(noSample.agentState).toBe("running");
    expect(noSample.metrics[0].value).toBeUndefined();
    expect(noSample.statusLabel).toBe("等待采样");
    const frozen = hostCardView(entry({ sampledAt: now / 1000 - 60 }), now);
    expect(frozen.statusLabel).toBe("数据过期");
    expect(frozen.metrics.map(metric => metric.value)).toEqual([undefined, undefined, 20]);
    expect(hostCardView({ ...entry(), detailsAt: now - 90001 }, now).metrics[2].value).toBeUndefined();
  });

  test("磁盘汇总正常时危险分区仍可见，计数去重并包含资源告警", () => {
    const gib = 1024 ** 3;
    const danger = entry({ disks: [
      { kind: "disk", total: 1000 * gib, used: 200 * gib, avail: 800 * gib },
      { kind: "mount", mount: "/data", total: 100 * gib, used: 98 * gib, avail: 2 * gib },
    ] as monitor.DiskInfo[] });
    const view = hostCardView(danger, now);
    expect(view.metrics[2].value).toBe(98);
    expect(view.metrics[2].detail).toContain("/data");
    expect(view.isAttention).toBe(true);
    expect(summarizeHostCards(["a", "a", "b", "c"], { a: entry(), b: danger }, now))
      .toEqual({ normal: 1, attention: 1, unknown: 1 });
  });
});

describe("首页共享调度", () => {
  test("重复项只读一次、最多五台并发，结果逐台更新且队尾不饥饿", async () => {
    const pending = new Map<string, (value: main.HostCardSnapshot) => void>();
    const calls: string[] = [];
    const poller = new HostCardPoller(name => {
      calls.push(name);
      return new Promise(resolve => pending.set(name, resolve));
    }, () => now);
    poller.setHosts(["a", "a", "b", "c", "d", "e", "f"]);
    poller.setActive(true);
    try {
      expect(calls).toEqual(["a", "b", "c", "d", "e"]);
      pending.get("b")!(snapshot({ name: "b" }));
      await flush();
      expect(calls.at(-1)).toBe("f");
      expect(poller.getSnapshot().entries.b.snapshot?.name).toBe("b");
      expect(poller.getSnapshot().entries.a).toBeUndefined();
    } finally { poller.setActive(false); }
  });

  test("五秒/三十秒节奏、失败后恢复、暂停不排新任务且恢复不重叠", async () => {
    let clock = now;
    let isFailing = false;
    const details: boolean[] = [];
    const poller = new HostCardPoller(async (_, includeDetails) => {
      details.push(includeDetails);
      if (isFailing) throw new Error("failed");
      return snapshot({ detailsIncluded: includeDetails, disks: includeDetails ? snapshot().disks : null, agentVersion: includeDetails ? "1.2.3" : "" });
    }, () => clock);
    poller.setHosts(["a"]);
    poller.setActive(true);
    try {
      await flush();
      clock += 4999; poller.tick(); await flush();
      expect(details).toEqual([true]);
      clock += 1; poller.tick(); await flush();
      expect(details).toEqual([true, false]);
      expect(poller.getSnapshot().entries.a.snapshot?.agentVersion).toBe("1.2.3");
      expect(poller.getSnapshot().entries.a.snapshot?.disks?.length).toBe(1);
      isFailing = true; clock += 5000; poller.tick(); await flush();
      expect(hostCardView(poller.getSnapshot().entries.a, clock).metrics[0].value).toBeUndefined();
      poller.setActive(false); clock += 20000; poller.tick();
      expect(details.length).toBe(3);
      isFailing = false; poller.setActive(true); await flush();
      expect(details.at(-1)).toBe(true);
      expect(poller.getSnapshot().entries.a.error).toBeUndefined();
      expect(hostCardView(poller.getSnapshot().entries.a, clock).metrics[0].value).toBe(0);
    } finally { poller.setActive(false); }
  });

  test("在途请求恢复时不重复，已删除主机的迟到结果不回填", async () => {
    let complete!: (value: main.HostCardSnapshot) => void;
    let count = 0;
    const poller = new HostCardPoller(() => {
      count++;
      return new Promise(resolve => { complete = resolve; });
    }, () => now);
    poller.setHosts(["a"]); poller.setActive(true);
    poller.setActive(false); poller.setActive(true);
    expect(count).toBe(1);
    poller.setHosts([]);
    complete(snapshot()); await flush();
    expect(poller.getSnapshot().entries.a).toBeUndefined();
    poller.setActive(false);
  });
});
