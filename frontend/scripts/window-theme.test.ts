import { expect, mock, test } from "bun:test";

const root = { dataset: {} as Record<string, string>, style: { background: "" } };
const host = { _wails: { environment: { OS: "" } } };
Object.assign(globalThis, {
  window: host, document: { documentElement: root }, location: { pathname: "/" },
  requestAnimationFrame: (callback: () => void) => { queueMicrotask(callback); return 1; },
});

type State = { preference: string; effective: string; supported: boolean; reason: string; revision: number };
let state: State = { preference: "auto", effective: "classic", supported: false, reason: "", revision: 1 };
let saveFails = false;
let readyCalls = 0;
let getCalls = 0;
const listeners = new Map<string, (event: { data?: unknown }) => void>();
let appearanceHints: boolean[] = [];
const emitTheme = (data: State) => listeners.get("window-theme-changed")?.({ data });
const emitAppearance = (data: boolean) => listeners.get("system-appearance-changed")?.({ data });
mock.module("react", () => ({ useSyncExternalStore: (_subscribe: unknown, read: () => unknown) => read() }));
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
  setWindowMaterial: async (preference: string) => {
    if (saveFails) throw new Error("保存失败");
    state = { ...state, preference, revision: state.revision + 1 };
    return { ...state };
  },
  windowThemeReady: async () => { readyCalls++; return true; },
} }));
const theme = await import("../src/react/state/window-theme");

test("browser preview keeps a solid background and does not call native initialization", async () => {
  const stop = theme.initializeWindowTheme();
  await Bun.sleep(10);
  expect(getCalls).toBe(0);
  expect(root.dataset.windowMaterial).toBe("classic");
  expect(readyCalls).toBe(0);
  stop();
});

test("desktop paints effective material, acknowledges readiness and responds to accessibility events", async () => {
  host._wails.environment.OS = "darwin";
  state = { preference: "auto", effective: "acrylic", supported: true, reason: "", revision: 10 };
  const stop = theme.initializeWindowTheme();
  await Bun.sleep(10);
  expect(root.dataset.windowMaterial).toBe("acrylic");
  expect(root.style.background).toBe("transparent");
  expect(readyCalls).toBe(1);
  emitTheme({ ...state, effective: "classic", reason: "减少透明度", revision: 11 });
  expect(root.dataset.windowMaterial).toBe("classic");
  emitTheme({ ...state, revision: 10 }); // Delayed response must not undo a newer fallback.
  expect(root.dataset.windowMaterial).toBe("classic");
  emitTheme({ ...state, revision: 12 });
  expect(root.dataset.windowMaterial).toBe("acrylic");
  saveFails = true;
  await expect(theme.setWindowMaterial("classic")).rejects.toThrow("保存失败");
  expect(theme.useWindowTheme().theme.preference).toBe("auto");
  expect(theme.useWindowTheme().pending).toBe(false);
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

test("unsupported desktop remembers requested material while keeping its effective solid theme", async () => {
  host._wails.environment.OS = "windows";
  saveFails = false;
  state = { preference: "auto", effective: "classic", supported: false, reason: "尚未提供", revision: 20 };
  const stop = theme.initializeWindowTheme();
  await Bun.sleep(10);
  await theme.setWindowMaterial("acrylic");
  expect(theme.useWindowTheme().theme.preference).toBe("acrylic");
  expect(root.dataset.windowMaterial).toBe("classic");
  await theme.setWindowMaterial("mica");
  expect(theme.useWindowTheme().theme.preference).toBe("mica");
  expect(root.dataset.windowMaterial).toBe("classic");
  await theme.setWindowMaterial("auto");
  expect(theme.useWindowTheme().theme.preference).toBe("auto");
  stop();
});

test("Mica exposes the native opaque surface and follows effective fallback without discarding preference", async () => {
  host._wails.environment.OS = "windows";
  state = { preference: "mica", effective: "mica", supported: true, reason: "", revision: 30 };
  const stop = theme.initializeWindowTheme();
  await Bun.sleep(10);
  expect(root.dataset.windowMaterial).toBe("mica");
  expect(root.style.background).toBe("transparent");
  emitTheme({ ...state, effective: "classic", supported: false, reason: "节电模式", revision: 31 });
  expect(root.dataset.windowMaterial).toBe("classic");
  expect(root.style.background).toBe("var(--color-canvas)");
  expect(theme.useWindowTheme().theme.preference).toBe("mica");
  emitTheme({ ...state, revision: 32 });
  expect(root.dataset.windowMaterial).toBe("mica");
  stop();
});
