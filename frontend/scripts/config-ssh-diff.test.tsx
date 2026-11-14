import { expect, mock, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";

mock.module("../src/react/state/session", () => ({ useSession: () => ({ configSection: "ssh" }) }));
mock.module("../src/react/components/host-tool-tabs", () => ({ useIsHostWorkspace: () => false }));
const { ConfigDataPage } = await import("../src/react/pages/config-data");
const { PageRefreshProvider } = await import("../src/react/state/page-refresh");

const before = "Host demo\n  HostName 192.0.2.10\n  User root\n";
const after = "Host demo\n  HostName 192.0.2.20\n  User root\n";

function renderSSH(changedFiles: object[], files: object[]) {
  const client = new QueryClient();
  client.setQueryData(["config-overview"], {
    sshConfigPath: "/home/demo/.ssh/config", drift: changedFiles.length > 0,
    diff: { changedFiles, hasChanges: changedFiles.length > 0 },
  });
  client.setQueryData(["config-files"], files);
  try {
    return renderToStaticMarkup(
      <QueryClientProvider client={client}><PageRefreshProvider><ConfigDataPage /></PageRefreshProvider></QueryClientProvider>,
    );
  } finally {
    client.clear();
  }
}

test("SSH 页面直接标记差异文件，并展示应用记录和本机文件的具体差异", () => {
  const html = renderSSH([
    { path: "config.d/demo.conf", kind: "changed", panelContent: before, externalContent: after },
  ], [
    { path: "config", absolutePath: "/home/demo/.ssh/config", content: "Include config.d/*\n" },
    { path: "config.d/demo.conf", content: after, generated: true, externalChanged: true },
  ]);
  expect(html).toContain("1 个文件有差异");
  expect(html).toContain('data-diff-kind="changed"');
  expect(html).toContain("应用记录");
  expect(html).toContain("本机文件");
  expect(html).toContain("192.0.2.10");
  expect(html).toContain("192.0.2.20");
});

test("已经删除的 SSH 文件仍出现在列表，并能看到删除内容", () => {
  const html = renderSSH([
    { path: "config.d/deleted.conf", kind: "removed", panelContent: before },
  ], [{ path: "config", content: "Include config.d/*\n" }]);
  expect(html).toContain("config.d/deleted.conf");
  expect(html).toContain("已删除");
  expect(html).toContain("192.0.2.10");
});

test("新增与清空文件也能看到行级差异", () => {
  const added = renderSSH([{ path: "config", kind: "added", externalContent: after }], [{ path: "config", content: after }]);
  expect(added).toContain('data-diff-kind="added"');
  expect(added).toContain('data-line-kind="added"');
  expect(added).toContain("192.0.2.20");
  const emptied = renderSSH([{ path: "config", kind: "changed", panelContent: before, externalContent: "" }], [{ path: "config", content: "" }]);
  expect(emptied).toContain('data-line-kind="removed"');
  expect(emptied).toContain("192.0.2.10");
});

test("无差异时保留普通文件阅读，不显示差异标记", () => {
  const html = renderSSH([], [{ path: "config", content: before }]);
  expect(html).not.toContain("个文件有差异");
  expect(html).not.toContain("data-diff-kind");
  expect(html).not.toContain('aria-label="SSH 配置视图"');
});
