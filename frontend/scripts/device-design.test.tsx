import { expect, mock, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

mock.module("../src/react/components/local/use-local-metrics", () => ({ useLocalMetrics: () => ({ overview: { publicIP: "203.0.113.8" } }), refreshLocalMetrics: async () => {} }));
mock.module("../src/react/components/host-tool-tabs", () => ({ useIsHostWorkspace: () => false }));
mock.module("../src/react/state/session", () => ({ useSession: () => ({ setLocalSection() {} }) }));
const { TransferPath } = await import("../src/react/components/speedtest/transfer-path");
const { appBundlePath } = await import("../src/react/components/local/app-icon");
const { LocalNetworkPage } = await import("../src/react/components/local/network-page");
const { PageRefreshProvider } = await import("../src/react/state/page-refresh");

test("进程 Helper 使用所属应用图标，非应用路径不请求图标", () => {
  expect(appBundlePath("/Applications/WeChat.app/Contents/MacOS/WeChat")).toBe("/Applications/WeChat.app");
  expect(appBundlePath("/Applications/Code.app/Contents/Frameworks/Helper.app/Contents/MacOS/Helper")).toBe("/Applications/Code.app");
  expect(appBundlePath("/opt/homebrew/bin/node")).toBe("");
  expect(appBundlePath("/tmp/not.appdata/run")).toBe("");
});

test("网络列表默认显示未连接接口并保留全部内网地址", () => {
  const client = new QueryClient();
  client.setQueryData(["local-net"], { privateIPs: ["192.0.2.1", "192.0.2.2", "192.0.2.3"], primaryIface: "en0", interfaces: [
    { name: "en0", kind: "wifi", state: "up", ipv4: "192.0.2.1" },
    { name: "en8", kind: "ethernet", state: "down", ipv4: "" },
  ] });
  const html = renderToStaticMarkup(createElement(QueryClientProvider, { client }, createElement(PageRefreshProvider, null, createElement(LocalNetworkPage))));
  expect(html).toContain("en8");
  expect(html).toContain("未连接");
  expect(html).toContain("192.0.2.1, 192.0.2.2, 192.0.2.3");
  expect(html).not.toContain("展开");
  client.clear();
});

for (const direction of ["forward", "reverse", "bidir"]) {
  test(`测速 ${direction} 只显示实际方向，运行标记随阶段停止`, () => {
    const render = (phase: string) => renderToStaticMarkup(createElement(TransferPath, { a: "@local", b: "host-b", direction, phase, duration: 10, elapsed: 6, status: phase === "running" ? "测速中" : "已停止" }));
    const active = render("running");
    expect(active.includes("A → B")).toBe(direction !== "reverse");
    expect(active.includes("B → A")).toBe(direction !== "forward");
    expect(active).toContain("transfer-path-packet");
    expect(active).toContain('value="60"');
    expect(render("stopped")).not.toContain("transfer-path-packet");
    expect(render("failed")).not.toContain("transfer-path-packet");
    expect(render("prepare")).not.toContain("transfer-path-packet");
  });
}

test("恢复中的任务缺少方向时不猜测箭头", () => {
  const html = renderToStaticMarkup(createElement(TransferPath, { a: "", b: "", direction: "", phase: "running", duration: 10 }));
  expect(html).toContain("正在恢复测速信息");
  expect(html).not.toContain("A → B");
  expect(html).not.toContain("B → A");
});
