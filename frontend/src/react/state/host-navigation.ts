import type { OpenedHost, Tool, Workspace } from "@/react/state/session";

export function openHostNav<T extends {
  workspace: Workspace;
  settingsOpen: boolean;
  activeHost: string;
  activeTool: Tool;
  openedHosts: OpenedHost[];
}>(prev: T, hostName: string, tool?: Tool): T {
  const existing = prev.openedHosts.find((item) => item.name === hostName);
  const nextTool = tool || existing?.tool || "overview";
  const openedHosts = existing
    ? prev.openedHosts.map((item) => item.name === hostName ? { name: hostName, tool: nextTool } : item)
    : [...prev.openedHosts, { name: hostName, tool: nextTool }];
  return { ...prev, workspace: "remote", settingsOpen: false, activeHost: hostName, activeTool: nextTool, openedHosts };
}
