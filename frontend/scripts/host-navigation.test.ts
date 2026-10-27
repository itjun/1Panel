import { describe, expect, test } from "bun:test";
import { openHostNav } from "../src/react/state/host-navigation";

type Nav = Parameters<typeof openHostNav>[0];

function navigation(): Nav {
  return {
    workspace: "remote", settingsOpen: false,
    activeHost: "a", activeTool: "apps",
    openedHosts: [{ name: "a", tool: "apps" }, { name: "b", tool: "files" }],
  };
}

describe("主机页面导航", () => {
  test("切换主机恢复各自的页面，新主机从概览开始", () => {
    const b = openHostNav(navigation(), "b");
    expect(b.activeTool).toBe("files");
    expect(openHostNav(b, "a").activeTool).toBe("apps");
    const c = openHostNav(b, "c");
    expect(c.activeTool).toBe("overview");
    expect(c.openedHosts).toEqual([
      { name: "a", tool: "apps" }, { name: "b", tool: "files" }, { name: "c", tool: "overview" },
    ]);
  });

  test("指定页面的入口覆盖目标主机的页面，不改变其他主机", () => {
    const next = openHostNav(navigation(), "b", "monitor");
    expect(next.activeTool).toBe("monitor");
    expect(next.openedHosts).toEqual([{ name: "a", tool: "apps" }, { name: "b", tool: "monitor" }]);
    expect(openHostNav(next, "a").activeTool).toBe("apps");
    expect(openHostNav(openHostNav(next, "a"), "b").activeTool).toBe("monitor");
  });
});
