import type { Workspace } from "@/react/state/session";

export type WorkspaceModule = Workspace | "settings";

/** 各模块的侧栏标题与默认宽度。 */
export const WORKSPACE_DESIGNS = {
  remote: { title: "主机", sidebarWidth: 200 },
  local: { title: "本机", sidebarWidth: 184 },
  config: { title: "配置", sidebarWidth: 200 },
  notify: { title: "通知中心", sidebarWidth: 200 },
  speedtest: { title: "测速", sidebarWidth: 184 },
  settings: { title: "设置", sidebarWidth: 184 },
} satisfies Record<WorkspaceModule, { title: string; sidebarWidth: number }>;
