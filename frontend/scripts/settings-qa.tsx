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
let launchAtLogin = params.get("startup") !== "off";
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
  getLaunchAtLoginState: async () => ({ enabled: launchAtLogin, supported: true, reason: "" }),
  setLaunchAtLogin: async (value: boolean) => {
    if (params.has("startup-error")) throw new Error("系统拒绝更改开机启动");
    launchAtLogin = value;
    record(`开机启动：${value}`);
    return { enabled: launchAtLogin, supported: true, reason: "" };
  },
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
const { updateSettings, useSettings } = await import("@/react/state/settings");
const { COLOR_PALETTES, parseColorPalette } = await import("@/react/lib/color-palettes");
if (params.has("palette")) updateSettings({ colorPalette: parseColorPalette(params.get("palette")) });
if (params.has("theme")) updateSettings({ appearance: params.get("theme") as "light" | "dark" | "system" });
const { setUpdateState } = await import("@/react/state/app-update");
setUpdateState({ enabled: true, autoCheck: true, status: "idle" } as never);
const { SessionProvider, useSession } = await import("@/react/state/session");
const { SidebarProvider, useSidebar } = await import("@/react/state/sidebar");
const { PageRefreshProvider } = await import("@/react/state/page-refresh");
const { ModuleRail } = await import("@/react/components/module-rail");
const { WorkspaceRail } = await import("@/react/components/workspace-rail");
const { WindowChrome, WindowControls } = await import("@/react/components/window-chrome");
const { SettingsPage } = await import("@/react/pages/settings-page");
const { useThemeSignature } = await import("@/react/lib/use-theme-mode");
const { ChartHost, lineOption } = await import("@/react/components/monitor/charts");
const { ResourceRing } = await import("@/react/components/ui/resource-ring");
const { Meter } = await import("@/react/components/ui/meter");
await import("@/react/components/board/board.css");

function PaletteMonitorFixture() {
  const theme = useThemeSignature();
  const option = React.useMemo(() => lineOption(["12:00", "12:05", "12:10", "12:15", "12:20", "12:25"], [
    { name: "接收", data: [80, 160, 130, 210, 170, 220] },
    { name: "发送", data: [35, 70, 50, 95, 65, 110] },
  ]), [theme]);
  return <div style={{ padding: 24 }}>
    <h1 className="text-xl font-semibold">主机概览</h1>
    <p className="text-sm text-muted">示例数据</p>
    <div className="flex justify-between gap-4 py-6">
      {[{ label: "CPU", value: 32 }, { label: "内存", value: 68 }, { label: "磁盘", value: 87 }, { label: "负载", value: 24 }].map(({ label, value }) => <div key={label} className="text-center">
        <ResourceRing value={value} label={label} valueText={`${value}%`}><strong>{value}%</strong></ResourceRing><span>{label}</span>
      </div>)}
    </div>
    <h2 className="text-base font-semibold">网络流量</h2>
    <ChartHost option={option} height={240} />
    <output className="sr-only" aria-label="图表配色">{JSON.stringify(option.color)}</output>
    <div className="flex items-center gap-4 py-6"><span>磁盘使用</span><Meter value={87} segments={20} /></div>
    <div className="board-dialog p-4"><span>应用内看板深色面</span><Meter value={68} /></div>
  </div>;
}

function Fixture() {
  const sidebar = useSidebar();
  const [isMonitor, setIsMonitor] = React.useState(params.has("sample"));
  const settings = useSettings();
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
        <WindowChrome /><div className="flex h-full min-w-0 flex-1" />{isMonitor ? <select aria-label="监控示例配色" className="mr-4 bg-surface text-ink" value={settings.colorPalette} onChange={(event) => updateSettings({ colorPalette: parseColorPalette(event.target.value) })}>{COLOR_PALETTES.map((palette) => <option key={palette.id} value={palette.id}>{palette.name}</option>)}</select> : null}<button className="mr-4 text-sm text-accent" onClick={() => setIsMonitor(!isMonitor)}>{isMonitor ? "返回外观设置" : "查看监控示例"}</button>
        {os === "mac" ? null : <WindowControls />}
      </header>
      <div className="relative flex min-h-0 min-w-0 flex-1">
        {sidebar.open ? <aside style={{ width: sidebar.width, flexShrink: 0 }}><WorkspaceRail /></aside> : null}
        <main className="glass-chrome-main min-w-0 flex-1">{isMonitor ? <PaletteMonitorFixture /> : <SettingsPage />}</main>
      </div>
    </div>
    <output className="sr-only" aria-label="隔离操作结果">{last}</output>
    <output className="sr-only" aria-label="导航历史分区">{session.settingsSection}</output>
  </div>;
}
const root = createRoot(document.getElementById("app")!);
import.meta.hot?.dispose(() => root.unmount());
root.render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><SessionProvider><PageRefreshProvider><SidebarProvider><Fixture /></SidebarProvider></PageRefreshProvider></SessionProvider></QueryClientProvider>);
