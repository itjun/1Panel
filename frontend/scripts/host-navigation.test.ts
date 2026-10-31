import { describe, expect, test } from "bun:test";
import { openHostNav } from "../src/react/state/host-navigation";
import { readMainScreen, writeMainScreen } from "../src/utils/lastScreen";

type Nav = Parameters<typeof openHostNav>[0];

function navigation(): Nav {
  return {
    workspace: "remote", settingsOpen: false,
    activeHost: "a", activeTool: "apps",
    openedHosts: [{ name: "a", tool: "apps" }, { name: "b", tool: "files" }],
  };
}

describe("主机页面导航", () => {
  test("重开应用后，停在磁盘页的主机仍保留在已打开列表", () => {
    const previous = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    const values = new Map<string, string>();
    Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    } });
    try {
      writeMainScreen({ workspace: "remote", settingsOpen: false, activeHostSessionId: "a", activeTerminalId: "", desks: [],
        hostSessions: [{ id: "a", host: "a", role: "host", tool: "disk", title: "a", titleCustom: false, terminals: [], activeTerminalId: "" }],
      });
      expect(readMainScreen()?.hostSessions).toHaveLength(1);
      expect(readMainScreen()?.hostSessions[0].tool).toBe("disk");
      expect(readMainScreen()?.activeHostSessionId).toBe("a");
    } finally {
      if (previous) Object.defineProperty(globalThis, "localStorage", previous);
      else Reflect.deleteProperty(globalThis, "localStorage");
    }
  });
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
