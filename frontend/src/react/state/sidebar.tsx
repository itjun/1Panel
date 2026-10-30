/** B 区始终显示；各模块分别保存拖拽宽度，双击分隔线恢复该模块默认值。 */
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { WORKSPACE_DESIGNS, type WorkspaceModule } from "@/react/lib/workspace-design";
import { useSession } from "@/react/state/session";

const SIDEBAR_WIDTHS_KEY = "1pannel-sidebar-widths";
export const SIDEBAR_WIDTH_MIN = 160;
export const SIDEBAR_WIDTH_MAX = 400;

function clampWidth(value: number) {
  return Math.min(SIDEBAR_WIDTH_MAX, Math.max(SIDEBAR_WIDTH_MIN, Math.round(value)));
}

function loadWidths(): Partial<Record<WorkspaceModule, number>> {
  try {
    const saved = JSON.parse(localStorage.getItem(SIDEBAR_WIDTHS_KEY) || "{}");
    const widths: Partial<Record<WorkspaceModule, number>> = {};
    if (saved && typeof saved === "object") {
      for (const module of Object.keys(WORKSPACE_DESIGNS) as WorkspaceModule[]) {
        if (typeof saved[module] === "number" && Number.isFinite(saved[module])) widths[module] = clampWidth(saved[module]);
      }
    }
    // 旧版只有一个宽度，迁移到主机模块；旧的收起状态不再读取。
    const legacy = localStorage.getItem("1pannel-sidebar-width");
    if (widths.remote === undefined && legacy && Number.isFinite(Number(legacy))) widths.remote = clampWidth(Number(legacy));
    return widths;
  } catch {
    return {};
  }
}

type SidebarValue = {
  width: number;
  setWidth: (width: number) => void;
  resetWidth: () => void;
  widthMin: number;
  widthMax: number;
  widthDefault: number;
};
const SidebarContext = createContext<SidebarValue | null>(null);

export function SidebarProvider({ children }: { children: ReactNode }) {
  const session = useSession();
  const module = session.settingsOpen ? "settings" : session.workspace;
  const widthDefault = WORKSPACE_DESIGNS[module].sidebarWidth;
  const [widths, setWidths] = useState(loadWidths);
  const width = widths[module] ?? widthDefault;
  const setWidth = useCallback((next: number) => {
    if (!Number.isFinite(next)) return;
    setWidths((previous) => {
      const updated = { ...previous, [module]: clampWidth(next) };
      try { localStorage.setItem(SIDEBAR_WIDTHS_KEY, JSON.stringify(updated)); } catch { /* 当前窗口仍可调整宽度。 */ }
      return updated;
    });
  }, [module]);
  const resetWidth = useCallback(() => setWidth(widthDefault), [setWidth, widthDefault]);
  const value = useMemo(() => ({ width, setWidth, resetWidth, widthMin: SIDEBAR_WIDTH_MIN, widthMax: SIDEBAR_WIDTH_MAX, widthDefault }), [width, setWidth, resetWidth, widthDefault]);
  return <SidebarContext.Provider value={value}>{children}</SidebarContext.Provider>;
}

export function useSidebar() {
  const value = useContext(SidebarContext);
  if (!value) throw new Error("useSidebar 必须在 SidebarProvider 内使用");
  return value;
}
