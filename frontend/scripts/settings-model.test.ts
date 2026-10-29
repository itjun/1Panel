import { describe, expect, test } from "bun:test";
import { PLATFORM_SETTINGS, settingsReadingSection, settingsShortcuts, showWindowMaterial } from "../src/react/lib/settings-model";

describe("runtime-specific settings", () => {
  test("Mac bindings match the shell; Windows and Linux use Ctrl and Alt", () => {
    const mac = settingsShortcuts("mac");
    expect(mac[2].keys).toEqual(["⌘ [", "⌘ ←"]);
    expect(mac.every((row) => row.keys.every((key) => !/Ctrl|Alt/.test(key)))).toBe(true);
    for (const os of ["win", "linux"] as const) {
      const rows = settingsShortcuts(os);
      expect(rows[0].keys).toEqual(["Ctrl+B", "Ctrl+\\"]);
      expect(rows[2].keys).toEqual(["Alt+←"]);
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

describe("continuous settings reading position", () => {
  const sections = [
    { id: "look" as const, top: 80 }, { id: "session" as const, top: 500 },
    { id: "board" as const, top: 640 }, { id: "app" as const, top: 900 },
    { id: "shortcuts" as const, top: 1400 }, { id: "about" as const, top: 1640 },
  ];
  test("tracks the reading line within the container, including reverse scrolling", () => {
    expect(settingsReadingSection(sections, 0, 700, 2000, null)).toBe("look");
    expect(settingsReadingSection(sections, 550, 700, 2000, null)).toBe("board");
    expect(settingsReadingSection(sections, 400, 700, 2000, null)).toBe("look");
  });
  test("uses pointer position when reading a visible section", () => {
    expect(settingsReadingSection(sections, 400, 700, 2000, 300)).toBe("board");
    expect(settingsReadingSection(sections, 400, 700, 2000, 600)).toBe("app");
  });
  test("selects the final section at the scroll limit even when too short to reach the top", () => {
    expect(settingsReadingSection(sections, 1300, 700, 2000, null)).toBe("about");
  });
  test("keeps the hovered module selected at the scroll limit", () => {
    expect(settingsReadingSection(sections, 1300, 700, 2000, 80)).toBe("app");
    expect(settingsReadingSection(sections, 1300, 700, 2000, 200)).toBe("shortcuts");
    expect(settingsReadingSection(sections, 1300, 700, 2000, 500)).toBe("about");
  });
  test("an unscrollable document uses its reading line instead of incorrectly selecting the last section", () => {
    expect(settingsReadingSection(sections, 0, 2400, 2000, null)).toBe("look");
  });
});
