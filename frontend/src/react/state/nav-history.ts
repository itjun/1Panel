/**
 * 应用内页面历史。只记当前看得见的页面，不落盘。
 */

import type {
  ConfigSection,
  HomeView,
  InspectSection,
  LocalSection,
  NotifySection,
  SettingsSection,
  SpeedtestSection,
  Tool,
  Workspace,
} from "@/react/state/session";

export const NAV_HISTORY_LIMIT = 50;

export type ViewSnap = {
  workspace: Workspace;
  settingsOpen: boolean;
  localSection: LocalSection;
  notifySection: NotifySection;
  configSection: ConfigSection;
  inspectSection: InspectSection;
  speedtestSection: SpeedtestSection;
  settingsSection: SettingsSection;
  homeView: HomeView;
  activeGroupId: string;
  activeHost: string;
  activeTool: Tool;
};

export function viewSnap(nav: ViewSnap): ViewSnap {
  return {
    workspace: nav.workspace,
    settingsOpen: nav.settingsOpen,
    localSection: nav.localSection,
    notifySection: nav.notifySection,
    configSection: nav.configSection,
    inspectSection: nav.inspectSection,
    speedtestSection: nav.speedtestSection,
    settingsSection: nav.settingsSection,
    homeView: nav.homeView,
    activeGroupId: nav.activeGroupId,
    activeHost: nav.activeHost,
    activeTool: nav.activeTool,
  };
}

/** 和主窗口的页面优先级一致：设置 > 工作区 > 主机 > 分组 > 首页。 */
export function viewKey(snap: ViewSnap): string {
  if (snap.settingsOpen) return `settings:${snap.settingsSection || "look"}`;
  if (snap.workspace === "local") return `local:${snap.localSection}`;
  if (snap.workspace === "notify") return `notify:${snap.notifySection}`;
  if (snap.workspace === "config") return `config:${snap.configSection}`;
  if (snap.workspace === "inspect") return `inspect:${snap.inspectSection}`;
  if (snap.workspace === "speedtest") return `speedtest:${snap.speedtestSection}`;
  if (snap.activeHost) return `host:${snap.activeHost}:${snap.activeTool}`;
  if (snap.homeView === "group") return `group:${snap.activeGroupId}`;
  return "home";
}

/** 当前页没变时返回 null，避免置顶、排序这类操作入栈。前进记录会被截掉。 */
export function pushView(
  stack: ViewSnap[],
  index: number,
  snap: ViewSnap,
): { stack: ViewSnap[]; index: number } | null {
  const current = stack[index];
  if (current && viewKey(current) === viewKey(snap)) return null;
  const next = stack.slice(0, index + 1);
  next.push(viewSnap(snap));
  if (next.length > NAV_HISTORY_LIMIT) {
    next.splice(0, next.length - NAV_HISTORY_LIMIT);
  }
  return { stack: next, index: next.length - 1 };
}
