/** Dev-only fixture: actual settings/shell components, isolated in-memory native APIs. */
import React from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { api } from "@/api";
import "@/react/styles/globals.css";
import "@/react/styles/workbench.css";
import "@/react/styles/uiux.css";

const params = new URLSearchParams(location.search);
const os = params.get("os") || "mac";
Object.defineProperty(navigator, "platform", { configurable: true, value: os === "mac" ? "MacIntel" : os === "win" ? "Win32" : "Linux x86_64" });
Object.defineProperty(navigator, "userAgent", { configurable: true, value: os === "mac" ? "Macintosh" : os === "win" ? "Windows NT 10.0" : "Linux" });
localStorage.setItem("1pannel-react-nav", JSON.stringify({ workspace: "remote", settingsOpen: true, settingsSection: params.get("section") || "look" }));
let board = { enabled: true, port: 8888 };
let ask = true;
let operation = "尚无原生写入";
const record = (value: string) => { operation = value; window.dispatchEvent(new Event("settings-qa-operation")); };
Object.assign(api, {
  listHosts: async () => [], listGroups: async () => [], listHostIcons: async () => [],
  listAlertHistory: async () => [],
  getPanelConfigOverview: async () => ({}),
  getMyEgress: async () => ({ ip: "203.0.113.8", location: "本机出口示例" }),
  getPanelConfigStatus: async () => ({ needsReview: false }),
  getAskBeforeQuit: async () => ask,
  setAskBeforeQuit: async (value: boolean) => { ask = value; record(`退出前询问：${value}`); },
  getBoardHTTPConfig: async () => ({ ...board }),
  setBoardHTTPConfig: async (value: typeof board) => { board = { ...value }; record(`内网看板：${board.enabled} / ${board.port}`); },
  listBoardURLs: async () => board.enabled ? [`http://192.168.1.8:${board.port}`] : [],
  listTerminalApps: async () => [
    { id: "default", name: os === "mac" ? "Terminal" : os === "win" ? "Windows Terminal" : "GNOME Terminal", default: true, supportsWindow: true },
    { id: "other", name: os === "mac" ? "iTerm2" : os === "win" ? "PowerShell" : "Konsole", supportsWindow: false },
  ],
  getAppInfo: async () => ({ appName: "1Panel", description: "桌面运维工作台", version: "开发版", os: os === "mac" ? "darwin" : os === "win" ? "windows" : "linux", arch: "arm64", copyright: "1Panel", goVersion: "go1.25", commit: "本地验证", agentVer: "1.0" }),
  setThemeAppearance: async () => {},
  setNotifySubs: async () => {},
  listSystemFonts: async () => [{ family: "Fixture Sans", monospace: false }, { family: "Fixture Mono", monospace: true }],
  checkUpdate: async () => ({ enabled: true, autoCheck: true, status: "idle", lastChecked: new Date().toISOString() }),
  setUpdateAutoCheck: async (value: boolean) => record(`自动更新：${value}`),
  openExternalURL: async () => record("外部链接"),
});
const { updateSettings } = await import("@/react/state/settings");
if (params.has("theme")) updateSettings({ appearance: params.get("theme") as "light" | "dark" | "system" });
const { setUpdateState } = await import("@/react/state/app-update");
setUpdateState({ enabled: true, autoCheck: true, status: "idle" } as never);
const { SessionProvider, useSession } = await import("@/react/state/session");
const { SidebarProvider, useSidebar } = await import("@/react/state/sidebar");
const { PageRefreshProvider } = await import("@/react/state/page-refresh");
const { ShellToolbarProvider, useShellToolbarSlot } = await import("@/react/components/shell-toolbar");
const { ModuleRail } = await import("@/react/components/module-rail");
const { WorkspaceRail } = await import("@/react/components/workspace-rail");
const { WindowChrome, WindowControls } = await import("@/react/components/window-chrome");
const { SettingsPage } = await import("@/react/pages/settings-page");

function Fixture() {
  const { setSlot } = useShellToolbarSlot();
  const sidebar = useSidebar();
  const session = useSession();
  React.useLayoutEffect(() => { session.setSettingsSection((params.get("section") || "look") as "look"); }, []);
  const [last, setLast] = React.useState(operation);
  React.useEffect(() => {
    const changed = () => setLast(operation);
    window.addEventListener("settings-qa-operation", changed);
    return () => window.removeEventListener("settings-qa-operation", changed);
  }, []);
  return <div className="react-root relative flex h-full min-h-0" data-os={os} data-sidebar={sidebar.open ? "open" : "closed"}>
    <ModuleRail />
    <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
      <header className="shell-app-toolbar shell-toolbar relative flex shrink-0 items-center">
        <WindowChrome /><div ref={setSlot} className="shell-app-toolbar-slot flex h-full min-w-0 flex-1" />
        {os === "mac" ? null : <WindowControls />}
      </header>
      <div className="relative flex min-h-0 min-w-0 flex-1">
        {sidebar.open ? <aside style={{ width: sidebar.width, flexShrink: 0 }}><WorkspaceRail /></aside> : null}
        <main className="glass-chrome-main min-w-0 flex-1"><SettingsPage /></main>
      </div>
    </div>
    <output className="sr-only" aria-label="隔离操作结果">{last}</output>
    <output className="sr-only" aria-label="导航历史分区">{session.settingsSection}</output>
  </div>;
}
const root = createRoot(document.getElementById("app")!);
import.meta.hot?.dispose(() => root.unmount());
root.render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><SessionProvider><PageRefreshProvider><SidebarProvider><ShellToolbarProvider><Fixture /></ShellToolbarProvider></SidebarProvider></PageRefreshProvider></SessionProvider></QueryClientProvider>);
