import { expect, mock, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const gib = 1024 ** 3;
const data = {
  hostname: "test-mac", productName: "macOS", productVer: "27.0.1", osRelease: "macOS",
  kernel: "27.0.0", arch: "arm64", uptime: 86401, cpuModel: "Apple M4", cpuCount: 10,
  perfCores: 4, effCores: 6, cpuPercent: 28.3, perfCpuPercent: 38, effCpuPercent: 22,
  load1: 2.16, load5: 2.1, load15: 1.9, memTotal: 24 * gib, memUsed: 10 * gib,
  memPercent: 1000 / 24, swapTotal: 14 * gib, swapUsed: 13 * gib, swapPercent: 1300 / 14,
  tempC: 69 as number | null | undefined, cpuTempC: undefined as number | null | undefined, gpuTempC: undefined as number | null | undefined,
  modelName: "Mac16,13", ipAddress: "192.0.2.5", publicIP: "203.0.113.8",
  disks: [
    { kind: "disk", mount: "disk0", device: "disk0", filesystem: "disk0", name: "SSD", model: "APPLE SSD AP0512Z", fsType: "apfs", parent: "disk0", total: 500 * gib, used: 200 * gib, avail: 300 * gib, percent: 40 },
    { kind: "mount", mount: "/", device: "/dev/disk3", filesystem: "/dev/disk3", name: "Macintosh HD", fsType: "apfs", parent: "disk0", total: 500 * gib, used: 200 * gib, avail: 300 * gib, percent: 40 },
  ],
};
mock.module("../src/react/components/local/use-local-metrics", () => ({
  useLocalMetrics: () => ({ overview: data, error: null, sampledAt: 1800000000000, cpuSeries: [], memSeries: [], loadSeries: [] }),
  refreshLocalMetrics: async () => {},
}));
mock.module("../src/react/components/host-tool-tabs", () => ({ useIsHostWorkspace: () => true }));
mock.module("../src/react/state/session", () => ({ useSession: () => ({ setLocalSection() {} }) }));
// 静态渲染展开浮层以核对明细数据；真实点击、外点、Esc 和焦点在浏览器验收。
mock.module("../src/react/components/ui/popup", () => ({ Popup: ({ children }: { children: import("react").ReactNode }) => children }));
const { LocalOverviewPage } = await import("../src/react/components/local/overview-page");
const { PageRefreshProvider } = await import("../src/react/state/page-refresh");

test("本机概览的圆环摘要和点击卡片保留磁盘、网络与资源明细", () => {
  const client = new QueryClient();
  client.setQueryData(["local-net"], {
    privateIPs: ["192.0.2.5"], defaultGateway: "192.0.2.1", primaryIface: "en0",
    interfaces: [{ name: "en0", kind: "wifi", state: "up", ipv4: "192.0.2.5/24", mac: "02:00:00:00:00:05", rxBytes: 4 * gib, txBytes: 2 * gib }],
  });
  try {
    const html = renderToStaticMarkup(createElement(QueryClientProvider, { client }, createElement(PageRefreshProvider, null, createElement(LocalOverviewPage))));
    const text = html.replace(/<[^>]+>/g, "");
    expect(html).toContain('aria-label="CPU 详情"');
    expect(html).toContain('aria-haspopup="dialog"');
    expect(text).toContain("APPLE SSD AP0512Z");
    expect(html).toContain('aria-label="复制硬盘信息（disk0）"');
    for (const value of ["核心", "性能核", "38.0%", "能效核", "22.0%", "1 / 5 / 15 分钟", "2.10", "1.90", "可用", "92.9%", "本机磁盘", "挂载点", "/dev/disk3", "默认网关", "192.0.2.1", "出口网卡", "MAC", "02:00:00:00:00:05", "接收", "发送"]) {
      expect(text).toContain(value);
    }
    expect(text).not.toContain("·");
  } finally {
    client.clear();
  }
});

test.each([
  { os: "macOS", tempC: 69, cpuTempC: 72, gpuTempC: 66, expected: 69 },
  { os: "Linux", tempC: undefined, cpuTempC: undefined, gpuTempC: 55, expected: 55 },
  { os: "Windows", tempC: undefined, cpuTempC: 62, gpuTempC: undefined, expected: 62 },
  { os: "Linux", tempC: 120, cpuTempC: undefined, gpuTempC: undefined, expected: 120 },
  ...[undefined, null, 0, -1, NaN, Infinity, 121].map(tempC => ({ os: "Windows", tempC, cpuTempC: undefined, gpuTempC: undefined, expected: undefined })),
])("本机温度根据有效读数显示，而非操作系统：%j", ({ os, tempC, cpuTempC, gpuTempC, expected }) => {
  const previous = { productName: data.productName, tempC: data.tempC, cpuTempC: data.cpuTempC, gpuTempC: data.gpuTempC };
  const client = new QueryClient();
  Object.assign(data, { productName: os, tempC, cpuTempC, gpuTempC });
  try {
    const html = renderToStaticMarkup(createElement(QueryClientProvider, { client }, createElement(PageRefreshProvider, null, createElement(LocalOverviewPage))));
    expect((html.match(/<article class="local-summary-resource">/g) || []).length).toBe(expected === undefined ? 3 : 4);
    if (expected === undefined) {
      expect(html).not.toContain('aria-label="温度详情"');
      expect(html).not.toContain("has-temperature");
    } else {
      expect(html).toContain('aria-label="温度详情"');
      expect(html).toContain(`aria-valuemax="120" aria-valuenow="${expected}" aria-valuetext="${expected} °C"`);
      expect(html).toContain("has-temperature");
    }
  } finally {
    Object.assign(data, previous);
    client.clear();
  }
});
