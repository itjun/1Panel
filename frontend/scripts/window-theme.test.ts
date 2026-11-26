import { expect, mock, test } from "bun:test";

const root = { dataset: {} as Record<string, string>, style: { background: "" } };
// Wails 的 environment 由导航完成后注入；host 需是 EventTarget 以模拟等待注入事件。
const host = Object.assign(new EventTarget(), { _wails: { environment: { OS: "" } } });
Object.assign(globalThis, {
  window: host, document: { documentElement: root }, location: { pathname: "/" },
  requestAnimationFrame: (callback: () => void) => { queueMicrotask(callback); return 1; },
});

type State = { effective: string; supported: boolean; reason: string; revision: number };
let state: State = { effective: "classic", supported: false, reason: "", revision: 1 };
let readyCalls = 0;
let getCalls = 0;
const listeners = new Map<string, (event: { data?: unknown }) => void>();
let appearanceHints: boolean[] = [];
const emitTheme = (data: State) => listeners.get("window-theme-changed")?.({ data });
const emitAppearance = (data: boolean) => listeners.get("system-appearance-changed")?.({ data });
mock.module("@wailsio/runtime", () => ({ Events: { On: (name: string, callback: (event: { data?: unknown }) => void) => {
  listeners.set(name, callback); return () => { listeners.delete(name); };
} } }));
mock.module("@/react/state/settings", () => ({
  readSettings: () => ({ appearance: "dark" }), appearanceToNativeMode: (value: string) => value,
  applySystemAppearanceHint: (dark: boolean) => { appearanceHints.push(dark); },
}));
mock.module("@/api", () => ({ api: {
  setThemeAppearance: async () => {},
  getWindowThemeState: async () => { getCalls++; return { ...state }; },
  windowThemeReady: async () => { readyCalls++; return true; },
} }));
const theme = await import("../src/react/state/window-theme");

test("browser preview keeps a solid background and does not call native initialization", async () => {
  const stop = theme.initializeWindowTheme();
  // environment 未注入但注入完成事件已到达（或超时）：仍按浏览器预览处理。
  host.dispatchEvent(new Event("wails:runtime-config-ready"));
  await Bun.sleep(10);
  expect(getCalls).toBe(0);
  expect(root.dataset.windowMaterial).toBe("classic");
  expect(readyCalls).toBe(0);
  stop();
});

test("desktop paints effective material, acknowledges readiness and responds to accessibility events", async () => {
  host._wails.environment.OS = "windows";
  state = { effective: "mica", supported: true, reason: "", revision: 10 };
  const stop = theme.initializeWindowTheme();
  await Bun.sleep(10);
  expect(root.dataset.windowMaterial).toBe("mica");
  expect(root.style.background).toBe("transparent");
  expect(readyCalls).toBe(1);
  emitTheme({ ...state, effective: "classic", reason: "减少透明度", revision: 11 });
  expect(root.dataset.windowMaterial).toBe("classic");
  emitTheme({ ...state, revision: 10 }); // Delayed response must not undo a newer fallback.
  expect(root.dataset.windowMaterial).toBe("classic");
  emitTheme({ ...state, revision: 12 });
  expect(root.dataset.windowMaterial).toBe("mica");
  stop();
  expect(listeners.size).toBe(0);
});

test("desktop relays Linux system-appearance events to the appearance hint", async () => {
  host._wails.environment.OS = "linux";
  appearanceHints = [];
  const stop = theme.initializeWindowTheme();
  await Bun.sleep(10);
  emitAppearance(true);
  emitAppearance(false);
  expect(appearanceHints).toEqual([true, false]);
  stop();
  appearanceHints = [];
  emitAppearance(true);
  expect(appearanceHints).toEqual([]);
});

test("Mica exposes the native opaque surface and follows effective fallback", async () => {
  host._wails.environment.OS = "windows";
  state = { effective: "mica", supported: true, reason: "", revision: 30 };
  const stop = theme.initializeWindowTheme();
  await Bun.sleep(10);
  expect(root.dataset.windowMaterial).toBe("mica");
  expect(root.style.background).toBe("transparent");
  emitTheme({ ...state, effective: "classic", supported: false, reason: "节电模式", revision: 31 });
  expect(root.dataset.windowMaterial).toBe("classic");
  expect(root.style.background).toBe("var(--color-canvas)");
  emitTheme({ ...state, revision: 32 });
  expect(root.dataset.windowMaterial).toBe("mica");
  stop();
});

test("translucent material keeps the window transparent until a solid fallback", async () => {
  host._wails.environment.OS = "windows";
  state = { effective: "translucent", supported: true, reason: "", revision: 50 };
  const stop = theme.initializeWindowTheme();
  await Bun.sleep(10);
  expect(root.dataset.windowMaterial).toBe("translucent");
  expect(root.style.background).toBe("transparent");
  emitTheme({ ...state, effective: "classic", supported: false, reason: "系统已关闭透明效果，正在使用经典外观", revision: 51 });
  expect(root.dataset.windowMaterial).toBe("classic");
  expect(root.style.background).toBe("var(--color-canvas)");
  stop();
});


test("Mac materials expose native backdrop and return to solid on fallback", async () => {
  host._wails.environment.OS = "darwin";
  state = { effective: "sidebar", supported: true, reason: "", revision: 40 };
  const stop = theme.initializeWindowTheme();
  await Bun.sleep(10);
  expect(root.style.background).toBe("transparent");
  emitTheme({ ...state, effective: "sidebar", revision: 41 });
  expect(root.dataset.windowMaterial).toBe("sidebar");
  expect(root.style.background).toBe("transparent");
  emitTheme({ ...state, effective: "classic", supported: false, reason: "降低透明度", revision: 42 });
  expect(root.style.background).toBe("var(--color-canvas)");
  stop();
});
