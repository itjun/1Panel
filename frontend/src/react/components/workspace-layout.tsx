import type { ReactNode } from "react";
import { ModuleRail } from "./module-rail";
import { WorkspaceRail } from "./workspace-rail";
import { SidebarSplitter } from "./sidebar-splitter";
import { HostToolTabs } from "./host-tool-tabs";
import { useSettingsShortcut, useToolbarDoubleClickMaximize, WindowControls } from "./window-chrome";
import { detectAppOs } from "@/react/lib/platform";
import { useSession } from "@/react/state/session";
import { useSidebar } from "@/react/state/sidebar";

/** 三端共用纵向布局；只有远程主机工具标签占用 C 顶部一行。 */
export function WorkspaceLayout({ children, isEditing = false }: { children: ReactNode; isEditing?: boolean }) {
  const session = useSession();
  const sidebar = useSidebar();
  const appOs = detectAppOs();
  const module = session.settingsOpen ? "settings" : session.workspace;
  const isRemoteHostWorkspace = module === "remote" && !!session.activeHost;
  useToolbarDoubleClickMaximize(appOs === "linux");
  useSettingsShortcut();

  return <div className="react-root relative flex h-full min-h-0" data-os={appOs} data-module={module} data-edit={isEditing ? "open" : undefined}>
    <ModuleRail />
    <div className="shell-columns relative min-h-0 min-w-0 flex-1" style={{ gridTemplateColumns: `${sidebar.width}px minmax(0, 1fr)` }}>
      <div className="workspace-sidebar">
        <WorkspaceRail />
        <SidebarSplitter />
      </div>
      <section
        className="shell-content relative flex min-h-0 min-w-0 flex-col"
        data-workspace-toolbar={isRemoteHostWorkspace ? "true" : undefined}
      >
        {isRemoteHostWorkspace ? (
          <header className="shell-app-toolbar shell-toolbar glass-chrome drag-region flex min-w-0 items-center">
            <HostToolTabs />
          </header>
        ) : null}
        {appOs === "mac" ? null : (
          <div className="shell-window-controls shell-toolbar absolute top-0 right-0 z-30 flex items-center pr-1">
            <WindowControls />
          </div>
        )}
        <main className="glass-chrome-main relative flex min-h-0 min-w-0 flex-1">{children}</main>
      </section>
    </div>
  </div>;
}
