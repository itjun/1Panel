import { useLayoutEffect, useMemo, type CSSProperties, type ReactNode } from "react";
import { ModuleRail } from "./module-rail";
import { WorkspaceRail } from "./workspace-rail";
import { SidebarSplitter } from "./sidebar-splitter";
import { HostToolTabs } from "./host-tool-tabs";
import { useSettingsShortcut, useToolbarDoubleClickMaximize, WindowControls } from "./window-chrome";
import { detectAppOs } from "@/react/lib/platform";
import { workspaceRegionTokens } from "@/react/lib/workspace-design";
import { paletteTokens } from "@/react/lib/color-palettes";
import { useThemeMode } from "@/react/lib/use-theme-mode";
import { useSession } from "@/react/state/session";
import { useSettings } from "@/react/state/settings";
import { useSidebar } from "@/react/state/sidebar";

/** 三个纵向区域各自排版，主机工具条只在 C 区内部按需出现。 */
export function WorkspaceLayout({ children, isEditing = false }: { children: ReactNode; isEditing?: boolean }) {
  const session = useSession();
  const sidebar = useSidebar();
  const settings = useSettings();
  const mode = useThemeMode();
  const appOs = detectAppOs();
  const module = session.settingsOpen ? "settings" : session.workspace;
  const railTokens = useMemo(() => paletteTokens(settings.colorPalette, mode), [settings.colorPalette, mode]);
  const regions = useMemo(() => workspaceRegionTokens(module, settings.colorPalette, mode), [module, settings.colorPalette, mode]);
  useLayoutEffect(() => {
    // 弹窗、菜单与提示挂在 body 下，跟随当前 C 区；A/B 各自显式保留区域主题。
    const style = document.body.style;
    const previous = Object.keys(regions.content).map((key) => [key, style.getPropertyValue(key), style.getPropertyPriority(key)]);
    Object.entries(regions.content).forEach(([key, value]) => style.setProperty(key, value));
    return () => {
      previous.forEach(([key, value, priority]) => {
        if (value) style.setProperty(key, value, priority);
        else style.removeProperty(key);
      });
    };
  }, [regions.content]);
  const isRemoteHostWorkspace = module === "remote" && !!session.activeHost;
  useToolbarDoubleClickMaximize(appOs === "linux");
  useSettingsShortcut();

  return <div className="react-root relative flex h-full min-h-0" data-os={appOs} data-module={module} data-edit={isEditing ? "open" : undefined}>
    <div className="contents" style={railTokens as CSSProperties}><ModuleRail /></div>
    <div className="shell-columns relative min-h-0 min-w-0 flex-1" style={{ gridTemplateColumns: `${sidebar.width}px minmax(0, 1fr)` }}>
      <div className="workspace-sidebar" style={regions.sidebar as CSSProperties}>
        <WorkspaceRail />
        <SidebarSplitter />
      </div>
      <section className="shell-content relative flex min-h-0 min-w-0 flex-col" data-workspace-toolbar={isRemoteHostWorkspace ? "true" : undefined} style={regions.content as CSSProperties}>
        {isRemoteHostWorkspace ? (
          <header className="shell-app-toolbar shell-toolbar drag-region relative flex min-w-0 items-center">
            <HostToolTabs />
          </header>
        ) : null}
        {appOs === "mac" ? null : <div className="shell-window-controls shell-toolbar absolute top-0 right-0 z-30 flex items-center pr-1"><WindowControls /></div>}
        <main className="glass-chrome-main relative flex min-h-0 min-w-0 flex-1">{children}</main>
      </section>
    </div>
  </div>;
}
