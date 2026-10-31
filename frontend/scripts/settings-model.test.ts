import { describe, expect, test } from "bun:test";
import { PLATFORM_SETTINGS, settingsShortcuts, showWindowMaterial } from "../src/react/lib/settings-model";

describe("runtime-specific settings", () => {
  test("列出全局快捷键，不保留侧栏开关和全局历史导航", () => {
    const mac = settingsShortcuts("mac");
    expect(mac).toEqual([
      { label: "打开设置", keys: ["⌘ ,"] },
      { label: "重新载入当前页面", keys: ["⌘ R"] },
      { label: "打开远程主机", keys: ["⌘ O"] },
      { label: "切换已打开主机", keys: ["Ctrl+Tab", "Ctrl+Shift+Tab"] },
    ]);
    for (const os of ["win", "linux"] as const) {
      const rows = settingsShortcuts(os);
      expect(rows).toEqual([
        { label: "打开设置", keys: ["Ctrl+,"] },
        { label: "重新载入当前页面", keys: ["Ctrl+R"] },
        { label: "打开远程主机", keys: ["Ctrl+O"] },
        { label: "切换已打开主机", keys: ["Ctrl+Tab", "Ctrl+Shift+Tab"] },
      ]);
      expect(rows.every((row) => row.keys.every((key) => !key.includes("⌘")))).toBe(true);
      expect(PLATFORM_SETTINGS[os].sans).not.toContain("苹方");
    }
  });
  test("material controls follow desktop platform capabilities", () => {
    expect(showWindowMaterial("win", true, true)).toBe(true);
    expect(showWindowMaterial("win", false, true)).toBe(false);
    expect(showWindowMaterial("win", true, false)).toBe(false);
    expect(showWindowMaterial("mac", true, true)).toBe(true);
    expect(showWindowMaterial("mac", true, false)).toBe(true);
    expect(showWindowMaterial("mac", false, true)).toBe(false);
    expect(showWindowMaterial("linux", true, true)).toBe(false);
  });
});
