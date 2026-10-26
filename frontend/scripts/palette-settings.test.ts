import { expect, mock, test } from "bun:test";
import { COLOR_PALETTES, paletteTokens } from "../src/react/lib/color-palettes";

const classes = new Set<string>();
const variables = new Map<string, string>();
const values = new Map<string, string>([["ipannel.settings.v1", JSON.stringify({ appearance: "dark", fontSize: 16 })]]);
let isSystemDark = false;
const root = {
  dataset: {} as Record<string, string>,
  style: { setProperty: (name: string, value: string) => variables.set(name, value), removeProperty: (name: string) => variables.delete(name) },
  classList: { add: (...names: string[]) => names.forEach((name) => classes.add(name)), remove: (...names: string[]) => names.forEach((name) => classes.delete(name)), contains: (name: string) => classes.has(name) },
};
Object.assign(globalThis, {
  document: { documentElement: root, body: { style: root.style } },
  window: { matchMedia: () => ({ matches: isSystemDark, addEventListener: () => {}, removeEventListener: () => {} }) },
  location: { pathname: "/" },
  localStorage: { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) },
  getComputedStyle: () => ({ getPropertyValue: (key: string) => variables.get(key) ?? "" }),
});
mock.module("react", () => ({ useSyncExternalStore: (_subscribe: unknown, read: () => unknown) => read() }));
mock.module("@/api", () => ({ api: { setThemeAppearance: async () => {}, setNotifySubs: async () => {} } }));
const settings = await import("../src/react/state/settings");
const { readThemeSignature } = await import("../src/react/lib/use-theme-mode");
const { readThemeColor, applySavedFont } = await import("../src/react/lib/utils");

test("legacy settings retain appearance and typography with the classic palette", () => {
  expect(settings.readSettings().colorPalette).toBe("classic");
  expect(settings.readSettings().appearance).toBe("dark");
  expect(settings.readSettings().fontSize).toBe(16);
});

test("switching only palette updates shell, chart colors, theme signature and persistence", () => {
  settings.updateSettings({ appearance: "light" });
  const signatures = new Set<string>();
  for (const palette of COLOR_PALETTES) {
    settings.updateSettings({ colorPalette: palette.id });
    expect(readThemeColor("--color-rail", "")).toBe(palette.light["--color-rail"]);
    expect(readThemeColor("--color-io-read", "")).toBe(palette.light["--color-io-read"]);
    expect(variables.get("--board-color-surface")).toBe(palette.dark["--color-surface"]);
    expect(readThemeColor("--color-surface", "", "dark")).toBe(palette.dark["--color-surface"]);
    expect(JSON.parse(values.get("ipannel.settings.v1")!).colorPalette).toBe(palette.id);
    signatures.add(readThemeSignature());
  }
  expect(signatures.size).toBe(COLOR_PALETTES.length);
  expect(settings.readSettings().appearance).toBe("light");
});

test("system changes repaint the selected palette and reset restores defaults", () => {
  settings.updateSettings({ appearance: "system", colorPalette: "strawberry" });
  settings.applySystemAppearanceHint(true);
  expect(readThemeSignature()).toBe("dark:strawberry");
  expect(variables.get("--color-canvas")).toBe(paletteTokens("strawberry", "dark")["--color-canvas"]);
  settings.applySystemAppearanceHint(false);
  expect(readThemeSignature()).toBe("light:strawberry");
  isSystemDark = true;
  settings.resetSettings();
  expect(settings.readSettings().colorPalette).toBe("classic");
  expect(readThemeSignature()).toBe("dark:classic");
});

test("startup restores palette while HTTP boards keep the classic dark theme", () => {
  values.set("ipannel.settings.v1", JSON.stringify({ appearance: "light", colorPalette: "latte" }));
  applySavedFont();
  expect(readThemeSignature()).toBe("light:almond");
  applySavedFont(true);
  expect(readThemeSignature()).toBe("dark:classic");
  expect(variables.has("--board-color-surface")).toBe(false);
  expect(variables.has("--color-line")).toBe(false);
  // 模拟 board.css 的最终样式：图表应读取看板的既有颜色，不再取应用派生色。
  classes.add("board-http");
  variables.set("--color-line", "#2c3445");
  expect(readThemeColor("--color-line", "", "dark")).toBe("#2c3445");
  classes.delete("board-http");
  values.set("ipannel.settings.v1", JSON.stringify({ appearance: "light", colorPalette: "not-a-palette" }));
  applySavedFont();
  expect(readThemeSignature()).toBe("light:classic");
});
