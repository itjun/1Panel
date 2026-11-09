import { expect, mock, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

mock.module("../src/react/components/local/use-local-metrics", () => ({ useLocalMetrics: () => ({ overview: { publicIP: "203.0.113.8" } }), refreshLocalMetrics: async () => {} }));
mock.module("../src/react/components/host-tool-tabs", () => ({ useIsHostWorkspace: () => false }));
mock.module("../src/react/state/session", () => ({ useSession: () => ({ setLocalSection() {} }) }));
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
