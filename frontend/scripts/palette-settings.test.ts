import { expect, mock, test } from "bun:test";
import { paletteTokens } from "../src/react/lib/color-palettes";

const classes = new Set<string>();
const variables = new Map<string, string>();
const values = new Map<string, string>([["ipannel.settings.v1", JSON.stringify({ appearance: "dark", fontSize: 16, colorPalette: "rose-mint", startupPage: "home", terminalApp: "1agent" })]]);
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
  expect(settings.readSettings()).not.toHaveProperty("colorPalette");
  expect(settings.readSettings()).not.toHaveProperty("startupPage");
  expect(settings.readSettings().appearance).toBe("dark");
  expect(settings.readSettings().fontSize).toBe(16);
});

test("旧版选中的 1Agent 在读取和保存时迁移为 Natty", () => {
  expect(settings.readSettings().terminalApp).toBe("natty");
  settings.updateSettings({ terminalOpenMode: "tab" });
  expect(JSON.parse(values.get("ipannel.settings.v1")!).terminalApp).toBe("natty");
});

test("保存更新时丢弃旧配色，同时使用默认色绘制图表和应用内看板", () => {
  settings.updateSettings({ appearance: "light" });
  expect(JSON.parse(values.get("ipannel.settings.v1")!)).not.toHaveProperty("colorPalette");
  expect(JSON.parse(values.get("ipannel.settings.v1")!)).not.toHaveProperty("startupPage");
  expect(readThemeColor("--color-io-read", "")).toBe(paletteTokens("light")["--color-io-read"]);
  expect(variables.get("--color-surface")).toBe(paletteTokens("light")["--color-surface"]);
});

test("system changes repaint the selected palette and reset restores defaults", () => {
  settings.updateSettings({ appearance: "system" });
  settings.applySystemAppearanceHint(true);
  expect(readThemeSignature()).toBe("dark");
  expect(variables.get("--color-canvas")).toBe(paletteTokens("dark")["--color-canvas"]);
  settings.applySystemAppearanceHint(false);
  expect(readThemeSignature()).toBe("light");
  isSystemDark = true;
  settings.resetSettings();
  expect(settings.readSettings()).not.toHaveProperty("colorPalette");
  expect(readThemeSignature()).toBe("dark");
});

test("startup ignores retired palette values while HTTP boards use TDesign dark roles", () => {
  values.set("ipannel.settings.v1", JSON.stringify({ appearance: "light", colorPalette: "latte" }));
  applySavedFont();
  expect(readThemeSignature()).toBe("light");
  applySavedFont(true);
  expect(readThemeSignature()).toBe("dark");
  expect(variables.has("--board-color-surface")).toBe(false);
  expect(variables.get("--color-line")).toBe(paletteTokens("dark")["--color-line"]);
  // HTTP 图表读取看板根元素的实际深色。
  classes.add("board-http");
  expect(readThemeColor("--color-line", "", "dark")).toBe("#393939");
  classes.delete("board-http");
  values.set("ipannel.settings.v1", JSON.stringify({ appearance: "light", colorPalette: "not-a-palette" }));
  applySavedFont();
  expect(readThemeSignature()).toBe("light");
});

test("damaged appearance settings still paint the independent board dark", () => {
  const previous = values.get("ipannel.settings.v1")!;
  try {
    for (const value of ["{", "null"]) {
      values.set("ipannel.settings.v1", value);
      variables.clear();
      applySavedFont(true);
      expect(readThemeSignature()).toBe("dark");
      expect(variables.get("--color-io-read")).toBe(paletteTokens("dark")["--color-io-read"]);
    }
  } finally {
    values.set("ipannel.settings.v1", previous);
    applySavedFont();
  }
});
