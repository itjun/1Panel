import { expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
mock.module("../src/react/components/host-tool-tabs", () => ({ useIsHostWorkspace: () => true }));
mock.module("../src/react/state/session", () => ({ useSession: () => ({}) }));
const { HostConnectionFailure } = await import("../src/react/components/host-connection-failure");

test("SSH 超时显示目标、VPN 排查提示及检查入口", () => {
  const html = renderToStaticMarkup(<HostConnectionFailure error="SSH 连接超时（root@192.0.2.10:22）：context deadline exceeded"
    target="root@192.0.2.10:22" onCheck={() => {}} onRetry={() => {}} isRetrying={false} />);
  expect(html).toContain("SSH 连接超时");
  expect(html).toContain("192.0.2.10:22");
  expect(html).toContain("VPN");
  expect(html).toContain("检查 Agent");
  expect(html).toContain("重试连接");
  expect(html).toContain("技术详情");
});

test("裸超时不误判为未安装 Agent，也不承诺 SSH 已连通", () => {
  const html = renderToStaticMarkup(<HostConnectionFailure error="context deadline exceeded" target="root@192.0.2.10:22"
    onCheck={() => {}} onRetry={() => {}} isRetrying />);
  expect(html).toContain("连接或采集超时");
  expect(html).not.toContain("Agent 未安装");
  expect(html).not.toContain("SSH 已连通");
  expect(html).toContain("重试中");
  expect(html).toContain("disabled");
});

test.each([
  ["ssh: handshake failed: unable to authenticate", "SSH 认证失败", "密钥"],
  ["agent 不可达（未安装或未运行）: connect failed", "Agent 端口不可达", "服务"],
  ["无 root 权限", "无法读取 Agent 凭据", "sudo"],
  ["agent 响应异常: HTTP 401", "Agent 认证失败", "凭据"],
  ["读取 Agent 凭据失败（root@192.0.2.10:22）：agent 未安装", "Agent 未安装", "安装状态"],
])("按实际错误提供排查方向：%s", (error, title, hint) => {
  const html = renderToStaticMarkup(<HostConnectionFailure error={error} target="root@192.0.2.10:22"
    onCheck={() => {}} onRetry={() => {}} isRetrying={false} />);
  expect(html).toContain(title);
  expect(html).toContain(hint);
});
