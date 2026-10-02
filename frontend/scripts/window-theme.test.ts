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
let listener: ((event: { data: State }) => void) | undefined;
mock.module("react", () => ({ useSyncExternalStore: (_subscribe: unknown, read: () => unknown) => read() }));
mock.module("@wailsio/runtime", () => ({ Events: { On: (_name: string, callback: typeof listener) => {
  listener = callback; return () => { listener = undefined; };
} } }));
mock.module("@/react/state/settings", () => ({
  readSettings: () => ({ appearance: "dark" }), appearanceToNativeMode: (value: string) => value,
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
  listener?.({ data: { ...state, effective: "classic", reason: "减少透明度", revision: 11 } });
  expect(root.dataset.windowMaterial).toBe("classic");
  listener?.({ data: { ...state, revision: 10 } }); // Delayed response must not undo a newer fallback.
  expect(root.dataset.windowMaterial).toBe("classic");
  listener?.({ data: { ...state, revision: 12 } });
  expect(root.dataset.windowMaterial).toBe("acrylic");
  saveFails = true;
  await expect(theme.setWindowMaterial("classic")).rejects.toThrow("保存失败");
  expect(theme.useWindowTheme().theme.preference).toBe("auto");
  expect(theme.useWindowTheme().pending).toBe(false);
  stop();
  expect(listener).toBeUndefined();
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
  await theme.setWindowMaterial("auto");
  expect(theme.useWindowTheme().theme.preference).toBe("auto");
  stop();
});
