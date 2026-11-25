import { expect, mock, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

mock.module("@/api", () => ({ api: {} }));
mock.module("@wailsio/runtime", () => ({ Events: {} }));
mock.module("@/react/state/settings", () => ({
  readSettings: () => ({ hostHomeRacks: [] }),
}));

const { SessionProvider, useSession } = await import("@/react/state/session");

function restoredSession(nav?: object, screen?: object) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const records = new Map<string, string>();
  if (nav) records.set("1pannel-react-nav", JSON.stringify(nav));
  if (screen) records.set("1pannel-main-screen", JSON.stringify(screen));
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: { getItem: (key: string) => records.get(key) ?? null },
  });

  let session!: ReturnType<typeof useSession>;
  function RestoredWorkspace() {
    session = useSession();
    return null;
  }

  try {
    renderToStaticMarkup(createElement(SessionProvider, { children: createElement(RestoredWorkspace) }));
    return session;
  } finally {
    if (previous) Object.defineProperty(globalThis, "localStorage", previous);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
}

test("旧版保存在巡检页的会话恢复到主机工作区", () => {
  const session = restoredSession({ workspace: "inspect", inspectSection: "menuCheck", pinned: ["demo-host"] });
  expect(session).toMatchObject({ workspace: "remote", pinned: ["demo-host"] });
  expect(session).not.toHaveProperty("inspectSection");
});

test("首次启动显示主机首页", () => {
  expect(restoredSession()).toMatchObject({ workspace: "remote", homeView: "home", activeHost: "", settingsOpen: false });
});

test.each([
  { workspace: "local", localSection: "network" },
  { workspace: "notify", notifySection: "setup" },
  { workspace: "speedtest", speedtestSection: "history" },
  { workspace: "config", configSection: "ssh" },
  { workspace: "config", settingsOpen: true, settingsSection: "board" },
  { workspace: "remote", homeView: "group", activeGroupId: "dev", activeHost: "" },
])("重启恢复上次离开的页面 %j", (nav) => {
  expect(restoredSession(nav)).toMatchObject(nav);
});

test("旧版停在已移除的会话设置时恢复到外观", () => {
  expect(restoredSession({ settingsOpen: true, settingsSection: "session" })).toMatchObject({
    settingsOpen: true, settingsSection: "look",
  });
});

test("旧版主机快照可以恢复，已有完整导航时以最后离开的页面为准", () => {
  const screen = {
    version: 3, activeHostSessionId: "host:web",
    sessions: [{ id: "host:web", host: "web", role: "host", tool: "sftp" }],
  };
  const openedHosts = [{ name: "web", tool: "files" }];
  expect(restoredSession(undefined, screen)).toMatchObject({ activeHost: "web", activeTool: "files", openedHosts });
  const nav = { activeHost: "", homeView: "group", activeGroupId: "dev", openedHosts };
  expect(restoredSession(nav, screen)).toMatchObject(nav);
  const hostNav = { activeHost: "web", activeTool: "disk", openedHosts: [{ name: "web", tool: "disk" }] };
  expect(restoredSession(hostNav)).toMatchObject(hostNav);
});
