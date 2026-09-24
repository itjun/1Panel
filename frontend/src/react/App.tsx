import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Events } from "@wailsio/runtime";
import { useEffect, useState } from "react";
import { api } from "@/api";
import { startAppWatchAlertPoll, stopAppWatchAlertPoll } from "@/utils/appWatchAlerts";
import { startCertAlertPoll, stopCertAlertPoll } from "@/utils/certAlerts";
import { startHostResourceAlertPoll, stopHostResourceAlertPoll } from "@/utils/hostResourceAlerts";
import { WorkspaceRail } from "@/react/components/workspace-rail";
import { ConfigCenterPage } from "@/react/pages/config-center";
import { GroupPage } from "@/react/pages/group-page";
import { HostCreateForm, HostEditForm } from "@/react/pages/host-form";
import { HostHomePage } from "@/react/pages/host-home";
import { HostFilePage } from "@/react/pages/host-files";
import { HostToolPage } from "@/react/pages/host-ops";
import { InspectPage } from "@/react/pages/inspect";
import { LocalPage } from "@/react/pages/local";
import { NotifyPage } from "@/react/pages/notify";
import { SettingsPage } from "@/react/pages/settings-page";
import {
  HOST_TOOLS,
  SessionProvider,
  useSession,
} from "@/react/state/session";

const queryClient = new QueryClient();

const FOCUS_ALERT_STORAGE_KEY = "1pannel-focus-alert-id";
const FOCUS_ALERT_WINDOW_EVENT = "1pannel-focus-alert";

type CreatingState = { kind: "host" | "group"; groupId?: string };

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <SessionProvider>
        <Shell />
      </SessionProvider>
    </QueryClientProvider>
  );
}

function Shell() {
  const session = useSession();
  const [creating, setCreating] = useState<CreatingState | null>(null);
  const editing = session.hosts.find((host) => host.name === session.editingHost) || null;

  useEffect(() => {
    const offs = [
      Events.On("board-open-host", (ev: { data?: { name?: string } }) => {
        const name = (ev?.data?.name || "").trim();
        if (!name) return;
        session.openHost(name, "monitor");
        void api.focusMainWindow();
      }),
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

  return (
    <div className="react-root flex h-full min-h-0">
      <WorkspaceRail />
      <main className="flex min-h-0 min-w-0 flex-1 bg-canvas">
        <div className="relative min-h-0 min-w-0 flex-1">
          {session.settingsOpen ? (
            <SettingsPage />
          ) : (
            <WorkspaceBody
              creating={creating}
              onCreateHost={(groupId) => setCreating({ kind: "host", groupId })}
              onCreateGroup={() => setCreating({ kind: "group" })}
              onCloseCreate={() => setCreating(null)}
              onCreateDone={async () => {
                setCreating(null);
                await session.refresh();
              }}
            />
          )}
        </div>
        {!session.settingsOpen && editing ? (
          <aside className="flex h-full w-[380px] shrink-0 flex-col overflow-hidden border-l border-line bg-surface">
            <HostEditForm
              key={editing.name}
              host={editing}
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
  );
}

function WorkspaceBody({
  creating,
  onCreateHost,
  onCreateGroup,
  onCloseCreate,
  onCreateDone,
}: {
  creating: CreatingState | null;
  onCreateHost: (groupId?: string) => void;
  onCreateGroup: () => void;
  onCloseCreate: () => void;
  onCreateDone: () => Promise<void>;
}) {
  const session = useSession();
  if (session.workspace === "notify") return <NotifyPage />;
  if (session.workspace === "config") return <ConfigCenterPage />;
  if (session.workspace === "local") return <LocalPage />;
  if (session.workspace === "inspect") return <InspectPage />;
  if (session.activeHost) return <HostWorkspace />;
  if (session.homeView === "group") return <GroupPage />;
  return (
    <div className="flex h-full min-h-0 flex-col overflow-auto">
      {creating ? (
        <div className="px-4 pt-4 md:px-6">
          <HostCreateForm
            kind={creating.kind}
            defaultGroupId={creating.groupId}
            onClose={onCloseCreate}
            onDone={() => {
              void onCreateDone();
            }}
          />
        </div>
      ) : null}
      <HostHomePage onCreateHost={onCreateHost} onCreateGroup={onCreateGroup} />
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
  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="drag-region flex h-14 shrink-0 items-center border-b border-line px-3">
        <nav className="flex min-w-0 flex-1 gap-1 overflow-x-auto">
          {HOST_TOOLS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={
                "box-border inline-flex h-8 w-[calc(4em+12px)] min-w-[calc(4em+12px)] max-w-[calc(4em+12px)] shrink-0 grow-0 cursor-pointer appearance-none items-center justify-center overflow-hidden whitespace-nowrap rounded-control px-1.5 " +
                (item.id === tool
                  ? "bg-accent/10 font-semibold text-accent"
                  : "text-muted hover:bg-ink/5 hover:text-ink")
              }
              onClick={() => session.setTool(item.id)}
            >
              {item.label}
            </button>
          ))}
        </nav>
      </header>
      <div className="flex min-h-0 flex-1 flex-col">
        {fileTool ? (
          <HostFilePage host={host} tool={tool} />
        ) : (
          <HostToolPage host={host} tool={tool} />
        )}
      </div>
    </div>
  );
}
