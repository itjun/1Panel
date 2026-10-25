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
  tempC: 69, modelName: "Mac16,13", ipAddress: "192.0.2.5", publicIP: "203.0.113.8",
  disks: [
    { kind: "disk", mount: "disk0", device: "disk0", filesystem: "disk0", name: "SSD", fsType: "apfs", parent: "disk0", total: 500 * gib, used: 200 * gib, avail: 300 * gib, percent: 40 },
    { kind: "mount", mount: "/", device: "/dev/disk3", filesystem: "/dev/disk3", name: "Macintosh HD", fsType: "apfs", parent: "disk0", total: 500 * gib, used: 200 * gib, avail: 300 * gib, percent: 40 },
  ],
};
mock.module("../src/react/components/local/use-local-metrics", () => ({
  useLocalMetrics: () => ({ overview: data, error: null, sampledAt: 1800000000000, cpuSeries: [], memSeries: [], loadSeries: [] }),
  refreshLocalMetrics: async () => {},
}));
mock.module("../src/react/components/host-tool-tabs", () => ({ useIsHostWorkspace: () => true }));
mock.module("../src/react/state/session", () => ({ useSession: () => ({ setLocalSection() {} }) }));
const { LocalOverviewPage } = await import("../src/react/components/local/overview-page");
const { PageRefreshProvider } = await import("../src/react/state/page-refresh");

test("本机概览保留资源悬浮明细和完整磁盘、网络数据", () => {
  const client = new QueryClient();
  client.setQueryData(["local-net"], {
    privateIPs: ["192.0.2.5"], defaultGateway: "192.0.2.1", primaryIface: "en0",
    interfaces: [{ name: "en0", kind: "wifi", state: "up", ipv4: "192.0.2.5/24", mac: "02:00:00:00:00:05", rxBytes: 4 * gib, txBytes: 2 * gib }],
  });
  try {
    const html = renderToStaticMarkup(createElement(QueryClientProvider, { client }, createElement(PageRefreshProvider, null, createElement(LocalOverviewPage))));
    const text = html.replace(/<[^>]+>/g, "");
    expect(html).toContain('aria-label="CPU明细"');
    for (const value of ["核心数", "性能核", "38.0%", "能效核", "22.0%", "5 分钟", "15 分钟", "2.10", "1.90", "可用", "92.9%", "物理磁盘", "挂载点", "/dev/disk3", "默认网关", "192.0.2.1", "主网卡", "MAC", "02:00:00:00:00:05", "接收", "发送"]) {
      expect(text).toContain(value);
    }
    expect(text).not.toContain("·");
  } finally {
    client.clear();
  }
});
