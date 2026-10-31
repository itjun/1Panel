/** Dev-only: run the real App with isolated host data and no native/remote calls. */
import React from "react";
import { createRoot } from "react-dom/client";
import { api } from "@/api";
import "@/react/styles/globals.css";

const params = new URLSearchParams(location.search);
Object.defineProperty(navigator, "platform", { configurable: true, value: params.get("os") === "win" ? "Win32" : "MacIntel" });
const names = ["dev-build", "app-main", "app-raven", "gateway", "docs", "staging", ...(params.has("many") ? Array.from({ length: 24 }, (_, i) => `demo-host-${i + 1}`) : [])];
const systems = ["Ubuntu 22.04 LTS", "Debian 12", "Rocky Linux 9", "Alpine Linux", "CentOS Stream", "Fedora Linux"];
const hosts = names.map((name) => ({ name, hostName: "example.invalid", user: "demo", port: "22", identityFile: "", proxyJump: "", proxyCommand: "", identityAgent: "", forwardAgent: false, hostKeyAlgos: "" }));
const groups = [
  { id: "dev", name: "开发环境", order: 0, hosts: [names[0], names[3]] },
  { id: "apps", name: "业务服务", order: 1, hosts: [names[1], names[2]] },
];
const gb = 1024 ** 3;
let diskReads = 0;
let hostReads = 0;
// Every unconfigured API is also replaced, so this fixture cannot reach a host.
for (const key of Object.keys(api)) Object.assign(api, { [key]: async () => [] });
Object.assign(api, {
  listHosts: async () => { hostReads++; document.documentElement.dataset.hostReads = String(hostReads); return params.has("empty") ? [] : hosts; },
  listGroups: async () => params.has("empty") ? [] : groups,
  listHostIcons: async () => names.map((host, index) => ({ host, osRelease: systems[index % systems.length] })),
  collectDisks: async () => {
    diskReads++; document.documentElement.dataset.diskReads = String(diskReads);
    return [
      { kind: "disk", filesystem: "vda", total: 40 * gb, used: 10.4 * gb, avail: 29.6 * gb, percent: 26.1 },
      { kind: "mount", filesystem: "/dev/vda1", mount: "/", fsType: "ext4", total: 39.3 * gb, used: 10.4 * gb, avail: 28.9 * gb, percent: 28 },
    ];
  },
  collectLargestFiles: async () => ({ files: Array.from({ length: 10 }, (_, i) => ({ name: `example-${i + 1}.bin`, dir: "/usr/local/share", size: (150 - i * 10) * 1024 ** 2 })), elapsedMs: 9300 }),
  getPanelConfigStatus: async () => ({ needsReview: false }),
  getMyEgress: async () => ({ ip: "203.0.113.8", location: "示例" }),
  getLaunchAtLoginState: async () => ({ enabled: false, supported: true, reason: "" }),
  getAskBeforeQuit: async () => true,
  getBoardHTTPConfig: async () => ({ enabled: false, port: 8888 }),
  getAppInfo: async () => ({ appName: "1Panel", description: "桌面运维工作台", version: "本地验证", os: "darwin", arch: "arm64", copyright: "1Panel", goVersion: "go1.25", commit: "fixture", agentVer: "1.0" }),
  listSystemFonts: async () => [],
  checkUpdate: async () => ({ enabled: false, autoCheck: false, status: "idle" }),
  getApplicationData: async () => ({ preferences: {} }),
});
const { updateSettings } = await import("@/react/state/settings");
updateSettings({ startupPage: "resume", appearance: params.get("theme") === "dark" ? "dark" : "light", colorPalette: "apricot-sea", hostHomeRows: [["dev", "apps"]], hostHomeRacks: [{ id: "fixture", name: "", groups: ["dev", "apps"] }] });
const { writeMainScreen } = await import("@/utils/lastScreen");
writeMainScreen({ workspace: "remote", settingsOpen: false, activeHostSessionId: names[1], activeTerminalId: "", desks: [],
  hostSessions: params.has("empty") ? [] : names.slice(0, params.has("single") ? 1 : 6).map((name) => ({ id: name, host: name, role: "host", tool: "disk", title: name, titleCustom: false, terminals: [], activeTerminalId: "" })),
});
const { setUpdateState } = await import("@/react/state/app-update");
setUpdateState({ enabled: false, autoCheck: false, status: "idle" } as never);
const { App } = await import("@/react/App");
const root = createRoot(document.getElementById("app")!);
import.meta.hot?.dispose(() => root.unmount());
root.render(<App />);

// A visible fixture control keeps Ctrl held for inspecting the switcher screenshot.
const hold = document.createElement("button");
hold.textContent = "预览缩略图切换";
hold.style.cssText = "position:fixed;bottom:8px;right:8px;z-index:30;padding:6px;font-size:12px;background:var(--color-surface);color:var(--color-muted)";
hold.onclick = () => window.dispatchEvent(new KeyboardEvent("keydown", { code: "Tab", key: "Tab", ctrlKey: true, bubbles: true, cancelable: true }));
document.body.append(hold);
