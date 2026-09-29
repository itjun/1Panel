/**
 * 侧栏展开状态与可调宽度（Firefox 式拖拽改宽）。
 */

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

const SIDEBAR_OPEN_KEY = "1pannel-sidebar-open";
const SIDEBAR_WIDTH_KEY = "1pannel-sidebar-width";

/** 默认宽度：三端统一 232px（DESIGN.md §4.1 / §9），= 左上 72px 预留 + 五个 32px 导航钮。 */
export function defaultSidebarWidth(): number {
  return 232;
}

export const SIDEBAR_WIDTH_MIN = 160;
export const SIDEBAR_WIDTH_MAX = 480;

function loadSidebarOpen(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_OPEN_KEY) !== "0";
  } catch {
    return true;
  }
}

function saveSidebarOpen(open: boolean) {
  try {
    localStorage.setItem(SIDEBAR_OPEN_KEY, open ? "1" : "0");
  } catch {
    /* ignore */
  }
}

function clampWidth(value: number) {
  return Math.min(SIDEBAR_WIDTH_MAX, Math.max(SIDEBAR_WIDTH_MIN, Math.round(value)));
}

function loadSidebarWidth(): number {
  const fallback = defaultSidebarWidth();
  try {
    const raw = localStorage.getItem(SIDEBAR_WIDTH_KEY);
    if (!raw) return fallback;
    const n = Number(raw);
    if (!Number.isFinite(n)) return fallback;
    return clampWidth(n);
  } catch {
    return fallback;
  }
}

function saveSidebarWidth(width: number) {
  try {
    localStorage.setItem(SIDEBAR_WIDTH_KEY, String(width));
  } catch {
    /* ignore */
  }
}

type SidebarValue = {
  open: boolean;
  toggle: () => void;
  width: number;
  setWidth: (width: number) => void;
  resetWidth: () => void;
  widthMin: number;
  widthMax: number;
  widthDefault: number;
};

const SidebarContext = createContext<SidebarValue | null>(null);

export function SidebarProvider({ children }: { children: ReactNode }) {
  const widthDefault = useMemo(() => defaultSidebarWidth(), []);
  const [open, setOpen] = useState(loadSidebarOpen);
  const [width, setWidthState] = useState(loadSidebarWidth);

  const toggle = useCallback(() => {
    setOpen((prev) => {
      const next = !prev;
      saveSidebarOpen(next);
      return next;
    });
  }, []);

  const setWidth = useCallback((next: number) => {
    const clamped = clampWidth(next);
    setWidthState(clamped);
    saveSidebarWidth(clamped);
  }, []);

  const resetWidth = useCallback(() => {
    setWidthState(widthDefault);
    saveSidebarWidth(widthDefault);
  }, [widthDefault]);

  const value = useMemo(
    () => ({
      open,
      toggle,
      width,
      setWidth,
      resetWidth,
      widthMin: SIDEBAR_WIDTH_MIN,
      widthMax: SIDEBAR_WIDTH_MAX,
      widthDefault,
    }),
    [open, toggle, width, setWidth, resetWidth, widthDefault],
  );
  return <SidebarContext.Provider value={value}>{children}</SidebarContext.Provider>;
}

export function useSidebar() {
  const value = useContext(SidebarContext);
  if (!value) throw new Error("useSidebar 必须在 SidebarProvider 内使用");
  return value;
}
