import { expect, mock, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { AppOs } from "../src/react/lib/platform";
import type { Workspace } from "../src/react/state/session";

let appOs: AppOs = "mac";
const session = { workspace: "remote" as Workspace, settingsOpen: false, activeHost: "" };

// 只隔离导航内容和原生操作，实际渲染共享窗口布局。
mock.module("../src/react/components/module-rail", () => ({ ModuleRail: () => null }));
mock.module("../src/react/components/workspace-rail", () => ({ WorkspaceRail: () => null }));
mock.module("../src/react/components/sidebar-splitter", () => ({ SidebarSplitter: () => null }));
mock.module("../src/react/components/host-tool-tabs", () => ({
  HostToolTabs: () => createElement("nav", { "aria-label": "主机工具" }),
}));
mock.module("../src/react/components/window-chrome", () => ({
  useSettingsShortcut: () => {},
  useToolbarDoubleClickMaximize: () => {},
  WindowControls: () => createElement("button", { "aria-label": "窗口关闭" }),
}));
mock.module("../src/react/lib/platform", () => ({ detectAppOs: () => appOs }));
mock.module("../src/react/lib/use-theme-mode", () => ({ useThemeMode: () => "light" }));
mock.module("../src/react/state/session", () => ({ useSession: () => session }));
mock.module("../src/react/state/settings", () => ({ useSettings: () => ({ colorPalette: "classic" }) }));
mock.module("../src/react/state/sidebar", () => ({ useSidebar: () => ({ width: 200 }) }));

const { WorkspaceLayout } = await import("../src/react/components/workspace-layout");

const cases: { name: string; workspace: Workspace; settingsOpen: boolean; activeHost: string; isHostToolbar: boolean }[] = [
  { name: "首页和分组", workspace: "remote", settingsOpen: false, activeHost: "", isHostToolbar: false },
  ...(["local", "config", "notify", "speedtest", "inspect"] as const).map((workspace) => ({
    name: workspace, workspace, settingsOpen: false, activeHost: "remembered-host", isHostToolbar: false,
  })),
  { name: "从主机打开设置", workspace: "remote", settingsOpen: true, activeHost: "remembered-host", isHostToolbar: false },
  { name: "远程主机工具", workspace: "remote", settingsOpen: false, activeHost: "demo-host", isHostToolbar: true },
];

for (const os of ["mac", "win", "linux"] as const) {
  for (const entry of cases) {
    test(`${os} ${entry.name}：只有主机工具占用顶部标签行`, () => {
      appOs = os;
      Object.assign(session, entry);
      const html = renderToStaticMarkup(createElement(WorkspaceLayout, {
        children: createElement("div", null, "页面内容"),
      }));
      const headers = html.match(/<header\b/g) || [];
      expect(headers).toHaveLength(entry.isHostToolbar ? 1 : 0);
      expect(html.includes('aria-label="主机工具"')).toBe(entry.isHostToolbar);
      expect(html.match(/aria-label="窗口关闭"/g) || []).toHaveLength(os === "mac" ? 0 : 1);
      expect(html).toContain("页面内容");
    });
  }
}
