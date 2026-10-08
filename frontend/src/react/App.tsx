import { SidebarSplitter } from "@/react/components/sidebar-splitter";
import {
  ShellToolbarProvider,
  useShellToolbarSlot,
} from "@/react/components/shell-toolbar";
import { HostToolTabs, useIsHostWorkspace } from "@/react/components/host-tool-tabs";
import { useToolbarDoubleClickMaximize, WindowChrome, WindowControls } from "@/react/components/window-chrome";
import { ModuleRail } from "@/react/components/module-rail";
import { WorkspaceRail } from "@/react/components/workspace-rail";
import { DialogHost } from "@/react/components/ui/confirm-dialog";
import { UpdateDialog } from "@/react/components/update-dialog";
import { detectAppOs } from "@/react/lib/platform";
import { MOTION_MS, usePresence } from "@/react/lib/motion";
import { ConfigCenterPage } from "@/react/pages/config-center";
import { GroupPage } from "@/react/pages/group-page";
import { HostCreateForm, HostEditForm } from "@/react/pages/host-form";
import { HostFilePage } from "@/react/pages/host-files";
import { HostHomePage } from "@/react/pages/host-home";
import { HostToolPage } from "@/react/pages/host-ops";
import { InspectPage } from "@/react/pages/inspect";
import { LocalPage } from "@/react/pages/local";
import { NotifyPage } from "@/react/pages/notify";
import { SettingsPage } from "@/react/pages/settings-page";
import { SpeedtestPage } from "@/react/pages/speedtest";
import { PageRefreshProvider } from "@/react/state/page-refresh";
import { SessionProvider, useSession } from "@/react/state/session";
import { SidebarProvider, useSidebar } from "@/react/state/sidebar";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Events } from "@wailsio/runtime";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { api } from "@/api";
import { initializeWindowTheme } from "@/react/state/window-theme";
import { startAppWatchAlertPoll, stopAppWatchAlertPoll } from "@/utils/appWatchAlerts";
import { startCertAlertPoll, stopCertAlertPoll } from "@/utils/certAlerts";
import { startHostResourceAlertPoll, stopHostResourceAlertPoll } from "@/utils/hostResourceAlerts";

const queryClient = new QueryClient();

const FOCUS_ALERT_STORAGE_KEY = "1pannel-focus-alert-id";
const FOCUS_ALERT_WINDOW_EVENT = "1pannel-focus-alert";

type CreatingState = { kind: "host" | "group"; groupId?: string };

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <SessionProvider>
        <PageRefreshProvider>
          <SidebarProvider>
            <ShellToolbarProvider>
              <Shell />
            </ShellToolbarProvider>
          </SidebarProvider>
        </PageRefreshProvider>
      </SessionProvider>
    </QueryClientProvider>
  );
}

function Shell() {
  useEffect(() => initializeWindowTheme(), []);
  const session = useSession();
  const sidebar = useSidebar();
  const appOs = detectAppOs();
  const isMac = appOs === "mac";
  const { setSlot } = useShellToolbarSlot();
  const hostWorkspace = useIsHostWorkspace();
  useToolbarDoubleClickMaximize(appOs === "linux");
  const [creating, setCreating] = useState<CreatingState | null>(null);
  const editing = session.hosts.find((host) => host.name === session.editingHost) || null;
  const createOpen = !session.settingsOpen && !!creating;
  const editOpen = !session.settingsOpen && !!editing && !creating;
  const lastCreateRef = useRef(creating);
  if (creating) lastCreateRef.current = creating;
  const lastEditRef = useRef(editing);
  if (editing) lastEditRef.current = editing;
  const createPresence = usePresence(createOpen, MOTION_MS.slow);
  const editPresence = usePresence(editOpen, MOTION_MS.slow);
  const createState = creating ?? lastCreateRef.current;
  const editHost = editing ?? lastEditRef.current;

  function openCreateHost(groupId?: string) {
    session.setEditingHost("");
    setCreating({ kind: "host", groupId });
  }

  function openCreateGroup() {
    session.setEditingHost("");
    setCreating({ kind: "group" });
  }

  function closeCreate() {
    setCreating(null);
  }

  async function finishCreate() {
    setCreating(null);
    await session.refresh();
  }

  // 编辑打开时关掉创建抽屉，保持互斥
  useEffect(() => {
    if (session.editingHost && creating) {
      setCreating(null);
    }
  }, [session.editingHost, creating]);

  useEffect(() => {
    const offs = [
      // 系统通知点进来：切到通知工作区，并把定位 id 交给 NotifyPage
      Events.On(
        "alert-open-host",
        (ev: { data?: { host?: string; eventId?: string } }) => {
          const data = ev?.data || {};
          const eventId = (data.eventId || "").trim();
          session.setWorkspace("notify");
          if (eventId) {
            try {
              sessionStorage.setItem(FOCUS_ALERT_STORAGE_KEY, eventId);
            } catch {
              /* ignore */
            }
          }
          window.dispatchEvent(
            new CustomEvent(FOCUS_ALERT_WINDOW_EVENT, {
              detail: { host: data.host, eventId: data.eventId },
            }),
          );
          void api.focusMainWindow();
        },
      ),
    ];
    return () => offs.forEach((off) => off());
  }, [session]);

  useEffect(() => {
    startHostResourceAlertPoll();
    startAppWatchAlertPoll();
    startCertAlertPoll();
    return () => {
      stopHostResourceAlertPoll();
      stopAppWatchAlertPoll();
      stopCertAlertPoll();
    };
  }, []);

  const dockMounted = createPresence.mounted || editPresence.mounted;

  return (
    <div
      className="react-root relative flex h-full min-h-0"
      data-sidebar={sidebar.open ? "open" : "closed"}
      data-os={appOs}
      data-edit={dockMounted ? "open" : undefined}
    >
      {/* 三段式（DESIGN.md §4.1）：72px 一级图标栏通顶，Mac 红绿灯 / Win·Linux 应用图标落在它顶部 */}
      <ModuleRail />
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
      {/* 顶栏从图标栏右缘开始，导航钮贴着图标栏，标题/操作挂到右侧槽 */}
      <header className="shell-app-toolbar shell-toolbar drag-region relative z-30 flex shrink-0 items-center">
        <div className="pointer-events-auto relative flex h-full shrink-0 items-center">
          <WindowChrome />
        </div>
        {hostWorkspace ? <HostToolTabs /> : null}
        <div
          ref={setSlot}
          className="shell-app-toolbar-slot pointer-events-auto flex h-full min-w-0 flex-1 items-center"
        />
        {isMac ? null : (
          <div className="pointer-events-auto absolute top-0 right-0 flex h-full items-center pr-1">
            <WindowControls />
          </div>
        )}
      </header>

      <div className="relative flex min-h-0 min-w-0 flex-1">
        {sidebar.open ? (
          <>
            <WorkspaceRail />
            <SidebarSplitter />
          </>
        ) : null}
        <main className="glass-chrome-main relative flex min-h-0 min-w-0 flex-1">
          <div className="relative min-h-0 min-w-0 flex-1">
            {session.settingsOpen ? (
              <div key="settings" className="motion-fade-in h-full min-h-0">
                <SettingsPage />
              </div>
            ) : (
              <WorkspaceBody onCreateHost={openCreateHost} onCreateGroup={openCreateGroup} />
            )}
          </div>
          {createPresence.mounted && createState ? (
            <aside
              className="edit-dock motion-drawer-panel flex flex-col"
              data-open={createPresence.visible ? "true" : "false"}
            >
              <HostCreateForm
                key={`${createState.kind}:${createState.groupId || ""}`}
                kind={createState.kind}
                defaultGroupId={createState.groupId}
                onClose={closeCreate}
                onDone={() => {
                  void finishCreate();
                }}
              />
            </aside>
          ) : null}
          {editPresence.mounted && editHost ? (
            <aside
              className="edit-dock motion-drawer-panel flex flex-col"
              data-open={editPresence.visible ? "true" : "false"}
            >
              <HostEditForm
                key={editHost.name}
                host={editHost}
                onClose={() => session.setEditingHost("")}
                onDone={async () => {
                  session.setEditingHost("");
                  await session.refresh();
                }}
              />
            </aside>
          ) : null}
        </main>
      </div>
      </div>
      <DialogHost />
      <UpdateDialog />
    </div>
  );
}

function workspaceKey(session: ReturnType<typeof useSession>): string {
  if (session.workspace === "notify") return "notify";
  if (session.workspace === "config") return "config";
  if (session.workspace === "local") return "local";
  if (session.workspace === "inspect") return "inspect";
  if (session.workspace === "speedtest") return "speedtest";
  if (session.activeHost) return `host:${session.activeHost}`;
  if (session.homeView === "group") return `group:${session.activeGroupId || ""}`;
  return "home";
}

function WorkspaceBody({
  onCreateHost,
  onCreateGroup,
}: {
  onCreateHost: (groupId?: string) => void;
  onCreateGroup: () => void;
}) {
  const session = useSession();
  const key = workspaceKey(session);
  let body: ReactNode;
  if (session.workspace === "notify") body = <NotifyPage />;
  else if (session.workspace === "config") body = <ConfigCenterPage />;
  else if (session.workspace === "local") body = <LocalPage />;
  else if (session.workspace === "inspect") body = <InspectPage />;
  else if (session.workspace === "speedtest") body = <SpeedtestPage />;
  else if (session.activeHost) body = <HostWorkspace />;
  else if (session.homeView === "group")
    body = <GroupPage onCreateHost={onCreateHost} />;
  else {
    body = (
      <div className="flex h-full min-h-0 flex-col overflow-auto">
        <HostHomePage onCreateHost={onCreateHost} onCreateGroup={onCreateGroup} />
      </div>
    );
  }
  return (
    <div key={key} className="motion-fade-in h-full min-h-0">
      {body}
    </div>
  );
}

function HostWorkspace() {
  const session = useSession();
  const host = session.activeHost;
  const tool = session.activeTool;
  const fileTool =
    tool === "files" ||
    tool === "nginx" ||
    tool === "apt" ||
    tool === "hosts";
  // 终端 / 代码编辑器 / 图表页只淡入，避免整页 X 轴平移拖垮 canvas
  const heavyPane =
    fileTool ||
    tool === "overview" ||
    tool === "monitor" ||
    tool === "apps";
  const paneClass = heavyPane ? "motion-fade-in" : "motion-axis-x-in";
  return (
    <div className="workspace-host flex h-full min-h-0 flex-col">
      <div key={`${host}:${tool}`} className={`flex min-h-0 flex-1 flex-col ${paneClass}`}>
        {fileTool ? (
          <HostFilePage host={host} tool={tool} />
        ) : (
          <HostToolPage host={host} tool={tool} />
        )}
      </div>
    </div>
  );
}
