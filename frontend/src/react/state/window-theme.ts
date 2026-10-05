import { useSyncExternalStore } from "react";
import { Events } from "@wailsio/runtime";
import { api } from "@/api";
import type { main } from "@/api";
import { applySystemAppearanceHint, appearanceToNativeMode, readSettings } from "@/react/state/settings";

export type WindowMaterial = "auto" | "classic" | "mica";

export function isDesktopWindow(): boolean {
  const host = window as Window & { _wails?: { environment?: { OS?: string } } };
  return !!host._wails?.environment?.OS && location.pathname === "/";
}

let current = {
  theme: { preference: "auto", effective: "classic", supported: false,
    reason: "正在准备窗口材质", revision: 0 } as main.WindowThemeState,
  pending: false,
  desktop: false,
};
const listeners = new Set<() => void>();
let generation = 0;
let requestQueue = Promise.resolve();

// Wails 在页面导航完成后才用 ExecJS 注入 window._wails.environment（runtime.Core），
// 前端模块脚本必然先于它执行；等注入完成事件再判定，超时则按浏览器预览处理。
const runtimeConfigReadyEvent = "wails:runtime-config-ready";

function whenDesktopKnown(timeoutMs: number): Promise<boolean> {
  if (isDesktopWindow()) return Promise.resolve(true);
  if (typeof window.addEventListener !== "function") return Promise.resolve(false);
  return new Promise((resolve) => {
    const finish = (desktop: boolean) => {
      clearTimeout(timer);
      window.removeEventListener(runtimeConfigReadyEvent, onReady);
      resolve(desktop);
    };
    const timer = setTimeout(() => finish(isDesktopWindow()), timeoutMs);
    const onReady = () => finish(isDesktopWindow());
    window.addEventListener(runtimeConfigReadyEvent, onReady);
  });
}

function publish() { listeners.forEach((listener) => listener()); }

function apply(state: main.WindowThemeState) {
  if (state.revision < current.theme.revision) return;
  current = { ...current, theme: state };
  const root = document.documentElement;
  root.dataset.windowMaterial = state.effective;
  root.style.background = state.effective === "mica" ? "transparent" : "var(--color-canvas)";
  publish();
}

async function painted() {
  await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
}

export function initializeWindowTheme(): () => void {
  const ownGeneration = ++generation;
  const active = () => ownGeneration === generation;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let stopThemeEvents: () => void = () => {};
  let stopAppearanceEvents: () => void = () => {};
  void (async () => {
    const desktop = await whenDesktopKnown(2000);
    if (!active()) return;
    current = { ...current, desktop };
    if (!desktop) {
      apply({ preference: "auto", effective: "classic", supported: false,
        reason: "浏览器预览使用经典外观", revision: 0 } as main.WindowThemeState);
      return;
    }
    const refresh = async (attempt = 0) => {
      try {
        // Colour mode is an independent saved preference; sync it before revealing the window.
        await api.setThemeAppearance(appearanceToNativeMode(readSettings().appearance));
        const state = await api.getWindowThemeState();
        if (!active()) return;
        apply(state);
        await painted();
        if (!active()) return;
        const ready = await api.windowThemeReady(state.revision);
        if (!ready && attempt < 5) retry = setTimeout(() => void refresh(attempt + 1), 250);
      } catch {
        // Backend timeout displays the classic skeleton. Retry without blocking React or startup.
        if (active() && attempt < 5) retry = setTimeout(() => void refresh(attempt + 1), 500);
      }
    };
    stopThemeEvents = Events.On("window-theme-changed", (event: { data?: main.WindowThemeState }) => {
      if (!active() || !event.data) return;
      apply(event.data);
      if (event.data.reason.includes("初始化超时")) {
        clearTimeout(retry);
        retry = setTimeout(() => void refresh(), 250);
      }
    });
    // Linux 的 WebKitGTK 不发 prefers-color-scheme 变更事件，跟随系统的实时切换靠它。
    stopAppearanceEvents = Events.On("system-appearance-changed", (event: { data?: boolean }) => {
      if (!active() || typeof event.data !== "boolean") return;
      applySystemAppearanceHint(event.data);
    });
    void refresh();
  })();
  return () => {
    generation++;
    clearTimeout(retry);
    stopThemeEvents();
    stopAppearanceEvents();
  };
}

export async function setWindowMaterial(preference: WindowMaterial): Promise<void> {
  if (!current.desktop) throw new Error("请在桌面应用中选择窗口材质");
  const request = requestQueue.then(async () => {
    current = { ...current, pending: true };
    publish();
    try { apply(await api.setWindowMaterial(preference)); }
    finally { current = { ...current, pending: false }; publish(); }
  });
  requestQueue = request.catch(() => {});
  return request;
}

export function useWindowTheme() {
  return useSyncExternalStore((listener) => {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  }, () => current);
}
