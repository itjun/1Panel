import { useSyncExternalStore } from "react";
import { Events } from "@wailsio/runtime";
import { api } from "@/api";
import type { main } from "@/api";
import { appearanceToNativeMode, readSettings } from "@/react/state/settings";

export type WindowMaterial = "auto" | "classic" | "acrylic";

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

function publish() { listeners.forEach((listener) => listener()); }

function apply(state: main.WindowThemeState) {
  if (state.revision < current.theme.revision) return;
  current = { ...current, theme: state };
  const root = document.documentElement;
  root.dataset.windowMaterial = state.effective;
  root.style.background = state.effective === "acrylic" ? "transparent" : "var(--color-canvas)";
  publish();
}

async function painted() {
  await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
}

export function initializeWindowTheme(): () => void {
  const ownGeneration = ++generation;
  const active = () => ownGeneration === generation;
  current = { ...current, desktop: isDesktopWindow() };
  if (!current.desktop) {
    apply({ preference: "auto", effective: "classic", supported: false,
      reason: "浏览器预览使用经典外观", revision: 0 } as main.WindowThemeState);
    return () => { generation++; };
  }
  let retry: ReturnType<typeof setTimeout> | undefined;
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
  const off = Events.On("window-theme-changed", (event: { data?: main.WindowThemeState }) => {
    if (!active() || !event.data) return;
    apply(event.data);
    if (event.data.reason.includes("初始化超时")) {
      clearTimeout(retry);
      retry = setTimeout(() => void refresh(), 250);
    }
  });
  void refresh();
  return () => { generation++; clearTimeout(retry); off(); };
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
