import { describe, expect, test } from "bun:test";
import { filterHostChoices, hostShortcut, stepHostChoice, type HostChoice } from "../src/react/lib/host-shortcuts";

const event = (patch: Partial<Parameters<typeof hostShortcut>[0]> = {}) => ({
  code: "KeyO", ctrlKey: false, metaKey: true, altKey: false, shiftKey: false, isComposing: false, ...patch,
});

describe("应用全局快捷键", () => {
  test("Mac 使用 Command，其他桌面使用 Control，排除额外修饰键和输入法组合", () => {
    expect(hostShortcut(event(), "mac")).toBe("open");
    expect(hostShortcut(event({ code: "KeyR" }), "mac")).toBe("reload");
    for (const os of ["win", "linux"] as const) {
      expect(hostShortcut(event({ metaKey: false, ctrlKey: true }), os)).toBe("open");
      expect(hostShortcut(event({ metaKey: false, ctrlKey: true, code: "KeyR" }), os)).toBe("reload");
      expect(hostShortcut(event(), os)).toBeNull();
    }
    for (const patch of [{ shiftKey: true }, { altKey: true }, { ctrlKey: true }, { isComposing: true }, { metaKey: false }]) {
      expect(hostShortcut(event(patch), "mac")).toBeNull();
    }
  });

  test("各平台统一用 Ctrl+Tab 正向、加 Shift 反向，不抢普通 Tab", () => {
    for (const os of ["mac", "win", "linux"] as const) {
      const tab = event({ code: "Tab", metaKey: false, ctrlKey: true });
      expect(hostShortcut(tab, os)).toBe("next");
      expect(hostShortcut({ ...tab, shiftKey: true }, os)).toBe("previous");
      expect(hostShortcut({ ...tab, ctrlKey: false }, os)).toBeNull();
      expect(hostShortcut({ ...tab, metaKey: true }, os)).toBeNull();
    }
  });
});

const items: HostChoice[] = [
  { name: "dev-build", group: "开发环境", tool: "overview", isOpened: true },
  { name: "app-main", group: "业务服务", tool: "files", isOpened: true },
  { name: "gateway", group: "业务服务", tool: "disk", isOpened: false },
];

test("快开按名称和分组匹配，多词忽略大小写且保留原顺序", () => {
  expect(filterHostChoices(items, "")).toEqual(items);
  expect(filterHostChoices(items, " APP  业务 ")).toEqual([items[1]]);
  expect(filterHostChoices(items, "业务服务")).toEqual([items[1], items[2]]);
  expect(filterHostChoices(items, "不存在")).toEqual([]);
});

test("主机切换按列表顺序循环，处理反向、未选中、单主机与空列表", () => {
  expect(stepHostChoice(items, "app-main", 1)).toBe("gateway");
  expect(stepHostChoice(items, "gateway", 1)).toBe("dev-build");
  expect(stepHostChoice(items, "dev-build", -1)).toBe("gateway");
  expect(stepHostChoice(items, "", 1)).toBe("dev-build");
  expect(stepHostChoice(items, "", -1)).toBe("gateway");
  expect(stepHostChoice([items[0]], "dev-build", 1)).toBe("dev-build");
  expect(stepHostChoice([], "dev-build", 1)).toBe("");
});
