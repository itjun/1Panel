import { expect, mock, test } from "bun:test";

// Linux 修复的行为契约：setThemeAppearance 返回意味着后端已按桌面门户纠正 GTK
// 偏好，前端随后重读 prefers-color-scheme；跟随系统期间收到的 system-appearance
// 事件值直接落到 <html>，不再依赖不会发生的 matchMedia change 事件。

const classes = new Set<string>();
const styleVars = new Map<string, string>();
const styleShim = {
  setProperty: (name: string, value: string) => { styleVars.set(name, value); },
  removeProperty: (name: string) => { styleVars.delete(name); },
};
const root = {
  dataset: {} as Record<string, string>,
  style: styleShim,
  classList: {
    add: (...values: string[]) => values.forEach((v) => classes.add(v)),
    remove: (...values: string[]) => values.forEach((v) => classes.delete(v)),
    contains: (v: string) => classes.has(v),
  },
};
let matchDark = false;
// 模拟后端在 setThemeAppearance 里把 GTK 偏好纠正为浅色后返回。
let correctOnSync = false;
const nativeCalls: string[] = [];
const matchMedia = (query: string) => ({
  matches: matchDark && query.includes("dark"),
  addEventListener: () => {},
  removeEventListener: () => {},
});
Object.assign(globalThis, {
  window: { matchMedia },
  document: { documentElement: root, body: { style: styleShim } },
  location: { pathname: "/" },
  localStorage: { getItem: () => null, setItem: () => {} },
  requestAnimationFrame: (callback: () => void) => { queueMicrotask(callback); return 1; },
});
mock.module("react", () => ({ useSyncExternalStore: (_subscribe: unknown, read: () => unknown) => read() }));
mock.module("@/api", () => ({ api: {
  setThemeAppearance: async (mode: string) => {
    nativeCalls.push(mode);
    if (correctOnSync) matchDark = false;
  },
  setNotifySubs: async () => {},
} }));
const settings = await import("../src/react/state/settings");

test("re-reads prefers-color-scheme after the native sync corrects it", async () => {
  matchDark = true;
  correctOnSync = true;
  settings.updateSettings({ appearance: "system" });
  expect(nativeCalls.at(-1)).toBe("auto");
  await Bun.sleep(10);
  expect(root.classList.contains("light")).toBe(true);
  expect(root.classList.contains("dark")).toBe(false);
});

test("system-appearance hints repaint only while following the system", () => {
  correctOnSync = false;
  settings.updateSettings({ appearance: "system" });
  settings.applySystemAppearanceHint(true);
  expect(root.classList.contains("dark")).toBe(true);
  settings.applySystemAppearanceHint(false);
  expect(root.classList.contains("light")).toBe(true);

  settings.updateSettings({ appearance: "light" });
  settings.applySystemAppearanceHint(true);
  expect(root.classList.contains("light")).toBe(true);
  expect(root.classList.contains("dark")).toBe(false);
});
