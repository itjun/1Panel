import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { monitor } from "../src/api";
import { OverviewResources, type OverviewMetric } from "../src/react/components/overview/device-overview";
import { ResourceRing } from "../src/react/components/ui/resource-ring";
import { overviewTrendSeries } from "../src/react/components/overview/overview-trend-model";
import { HostWorkbenchSummary } from "../src/react/components/workbench/host-summary";

function metrics(cpu = 28.3, memory = 42.1): OverviewMetric[] {
  return [
    { id: "cpu", label: "CPU", text: `${cpu.toFixed(1)}%`, percent: cpu },
    { id: "memory", label: "内存", text: `${memory.toFixed(1)}%`, percent: memory },
    { id: "disk", label: "磁盘", text: "38.2%", percent: 38.2 },
    { id: "load", label: "负载", text: "2.16", detail: "1 分钟", percent: 21.6 },
  ];
}

function visibleText(html: string): string {
  return html.replace(/<[^>]+>/g, "");
}

function displayedValues(html: string): string[] {
  return [...html.matchAll(/<strong(?:\s[^>]*)?>(.*?)<\/strong>/g)]
    .map((match) => visibleText(match[1]));
}

describe("概览资源展示", () => {
  test("四项读数固定并排，以连续圆环显示资源状态", () => {
    const html = renderToStaticMarkup(createElement(OverviewResources, { metrics: metrics() }));

    expect(html).toContain('aria-label="资源状态"');
    expect(visibleText(html)).not.toContain("资源状态");
    expect(displayedValues(html)).toEqual(["2.16", "28.3%", "42.1%", "38.2%"]);
    expect((html.match(/role="meter"/g) || []).length).toBe(4);
    expect(html).not.toContain("<rect");
    expect((html.match(/<circle /g) || []).length).toBe(8);
    expect(visibleText(html)).toContain("运行正常");
  });

  test("告警与数值波动不交换负载、CPU、内存、磁盘的位置", () => {
    const before = renderToStaticMarkup(createElement(OverviewResources, { metrics: metrics(86.1, 86) }));
    const after = renderToStaticMarkup(createElement(OverviewResources, { metrics: metrics(85.9, 86) }));

    expect(visibleText(before)).toContain("CPU、内存偏高");
    expect(visibleText(after)).toContain("CPU、内存偏高");
    expect(displayedValues(before)).toEqual(["2.16", "86.1%", "86.0%", "38.2%"]);
    expect(displayedValues(after)).toEqual(["2.16", "85.9%", "86.0%", "38.2%"]);
  });

  test("采集失败保留缓存读数与位置，同时撤下有效数值仪表", () => {
    const cached = metrics(90, 42.1).map(metric => ({ ...metric, tooltip: `${metric.label}原有明细` }));
    const html = renderToStaticMarkup(createElement(OverviewResources, {
      metrics: cached,
      isUnavailable: true,
    }));

    expect(html).toContain('aria-label="资源状态"');
    expect(visibleText(html)).toContain("上次读数");
    expect(displayedValues(html)).toEqual(["2.16", "90.0%", "42.1%", "38.2%"]);
    expect(html).not.toContain('role="meter"');
    expect(html).not.toContain("aria-valuenow");
    expect(html).toContain('data-tip="上次读数\nCPU原有明细"');
  });

  test("首次采集失败不暗示存在历史读数", () => {
    const unknown = metrics().map((metric) => ({ ...metric, text: "—", percent: undefined }));
    const html = renderToStaticMarkup(createElement(OverviewResources, {
      metrics: unknown,
      isUnavailable: true,
    }));

    expect(visibleText(html)).toContain("采集异常");
    expect(visibleText(html)).not.toContain("上次读数");
    expect(displayedValues(html)).toEqual(["—", "—", "—", "—"]);
    expect(html).not.toContain('role="meter"');
    expect(html).not.toContain("data-tip=");
  });
});

test("远程磁盘汇总较低时，危险分区仍告警并标明挂载点", () => {
  const gib = 1024 ** 3;
  const data: monitor.Overview = {
    cpuPercent: 20, memPercent: 30, memTotal: 8 * gib, memUsed: 2.4 * gib,
    swapPercent: 0, swapTotal: 0, swapUsed: 0, load1: 0.4, load5: 0.3, load15: 0.2,
    uptime: 86400, kernel: "6.8.0", osRelease: "Linux", cpuCount: 4, cpuModel: "Test CPU",
    hostname: "test-host", arch: "x86_64", ipAddress: "192.0.2.10",
    netRxBytes: 0, netTxBytes: 0, diskReadBytes: 0, diskWriteBytes: 0, diskIOCount: 0,
  };
  const disks: monitor.DiskInfo[] = [
    { kind: "disk", filesystem: "vda", mount: "vda", fsType: "", total: 1000 * gib, used: 200 * gib, avail: 800 * gib, percent: 20 },
    { kind: "mount", filesystem: "/dev/vda1", mount: "/", fsType: "ext4", total: 100 * gib, used: 98 * gib, avail: 2 * gib, percent: 98 },
  ];
  const html = renderToStaticMarkup(createElement(HostWorkbenchSummary, {
    data, disks, isUnavailable: false, isDiskUnavailable: false,
  }));

  expect(visibleText(html)).toContain("磁盘偏高");
  expect(displayedValues(html)[3]).toBe("98.0%");
  expect(visibleText(html)).toContain("/ 98 GB / 100 GB");
  expect(displayedValues(html)).toHaveLength(4);
  expect(html).toContain('aria-label="CPU明细"');
  expect(html).toContain('tabindex="0"');
  for (const value of ["型号：Test CPU", "核心数：4 核", "5 分钟：0.30", "15 分钟：0.20", "系统容量：8 GB", "Swap：未启用", "挂载点：/", "设备：/dev/vda1", "可用：2 GB"]) {
    expect(html).toContain(value);
  }
});

test("圆环的零、满格、超量与未知值不会误报占比", () => {
  for (const value of [0, 0.1, 50, 100, 150, undefined, NaN]) {
    const html = renderToStaticMarkup(createElement(ResourceRing, { value, label: "CPU", valueText: String(value), children: "CPU" }));
    const isKnown = typeof value === "number" && Number.isFinite(value);
    const percent = isKnown ? Math.min(100, value) : 0;
    expect(html).not.toContain("<rect");
    expect((html.match(/<circle /g) || []).length).toBe(percent > 0 ? 2 : 1);
    if (percent > 0) expect(html).toContain(`stroke-dasharray="${percent} 100"`);
    if (!isKnown) expect(html).not.toContain("aria-valuenow");
  }
});

test("单项采集失败只撤下该项仪表，不把缓存当成健康读数", () => {
  const items = metrics().map(metric => ({ ...metric, tooltip: `${metric.label}原有明细`, isUnavailable: metric.id === "disk" }));
  const html = renderToStaticMarkup(createElement(OverviewResources, { metrics: items }));
  expect((html.match(/role="meter"/g) || []).length).toBe(3);
  expect(visibleText(html)).toContain("部分采集异常");
  expect(displayedValues(html)).toEqual(["2.16", "28.3%", "42.1%", "38.2%"]);
  expect(html).toContain('data-tip="上次读数\n磁盘原有明细"');
  expect(html).toContain('data-tip="CPU原有明细"');
});

test("趋势按真实时间排序、去重，长缺测区间不补零", () => {
  const base = 1800000000;
  const result = overviewTrendSeries([20, 5, 0, 15, 10, 300].map(offset => ({
    ts: base + offset, cpuPercent: offset === 300 ? 90 : 10, memUsed: 50, load1: 0.2,
  })), 100);
  expect(result.cpu[0]).toEqual([base * 1000, 10]);
  expect(result.cpu.at(-1)).toEqual([(base + 300) * 1000, 90]);
  expect(result.cpu.filter(point => point[1] === null)).toHaveLength(1);
  expect(result.memory[0][1]).toBe(50);
  const duplicate = overviewTrendSeries([{ ts: base, cpuPercent: 10 }, { ts: base, cpuPercent: 20 }]);
  expect(duplicate.cpu).toEqual([[base * 1000, 20]]);
});

test("趋势缺少内存总量或遇到非法采样时不伪造数值", () => {
  const result = overviewTrendSeries([{ ts: 1800000000, cpuPercent: NaN, memUsed: 10, load1: -1 }, { ts: NaN }]);
  expect(result.cpu).toEqual([[1800000000000, null]]);
  expect(result.memory).toEqual([[1800000000000, null]]);
  expect(result.load).toEqual([[1800000000000, null]]);
  expect(overviewTrendSeries([])).toEqual({ cpu: [], memory: [], load: [] });
});
