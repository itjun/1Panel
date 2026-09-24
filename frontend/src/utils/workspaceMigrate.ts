import {
  BENCH_TITLE,
  hostsInTree,
  isDefaultBenchTitle,
  type SavedWorkspace,
} from "@/utils/workspaceLayout";

/** 持久化工具名。sftp 是双栏文件页；file-manager 是已删除的单栏文件管理器，读入后归到 sftp。 */
export type PersistTool =
  | "terminal"
  | "info"
  | "file-manager"
  | "sftp"
  | "monitor"
  | "certs"
  | "nginx"
  | "processes"
  | "network"
  | "hosts"
  | "apt"
  | "apps"
  | "services"
  | "cron"
  | "logs"
  | "packages";

export type WorkspaceRole = "host" | "bench";

export interface LegacySession {
  id: string;
  host: string;
  kind: "terminal" | "info" | "sftp" | "monitor";
  title: string;
  titleCustom: boolean;
}

export interface DeskRef {
  id: string;
  title: string;
}

/** 版本 2 的一级标签：主机工作区或跨主机终端工作台。 */
export interface MigratedWorkspace {
  id: string;
  host: string;
  role: WorkspaceRole;
  tool: PersistTool;
  title: string;
  titleCustom: boolean;
  terminals: DeskRef[];
  activeTerminalId: string;
}

const TOOLS: PersistTool[] = [
  "terminal",
  "info",
  "file-manager",
  "sftp",
  "monitor",
  "certs",
  "nginx",
  "processes",
  "network",
  "hosts",
  "apt",
  "apps",
  "services",
  "cron",
  "logs",
  "packages",
];

export function isPersistTool(v: unknown): v is PersistTool {
  return TOOLS.includes(v as PersistTool);
}

function benchDisplayTitle(raw: string): string {
  const title = raw.trim() || BENCH_TITLE;
  if (isDefaultBenchTitle(title)) return BENCH_TITLE;
  return title;
}

/** 终端列表里跨主机分屏的分组名。旧数据里的「工作台」迁过来后用这个名字。 */
export const SPLIT_TITLE = "分屏";

export interface PersistedDesk {
  id: string;
  host: string;
  title: string;
  titleCustom: boolean;
  crossHost: boolean;
}

/** 多台主机，或标题已是工作台：独立工作台，不并进某台主机。 */
export function isBenchLayout(item: { title: string; tree: SavedWorkspace["tree"] }): boolean {
  if (isDefaultBenchTitle(item.title)) return true;
  return new Set(hostsInTree(item.tree)).size > 1;
}

function benchFromLegacy(
  s: LegacySession,
  layout: SavedWorkspace | undefined
): MigratedWorkspace {
  const title = benchDisplayTitle(layout?.title || s.title || BENCH_TITLE);
  return {
    id: s.id,
    host: s.host,
    role: "bench",
    tool: "terminal",
    title,
    titleCustom: s.titleCustom || !!layout?.titleCustom,
    terminals: [{ id: s.id, title }],
    activeTerminalId: s.id,
  };
}

function benchFromLayout(item: SavedWorkspace): MigratedWorkspace {
  const title = benchDisplayTitle(item.title || BENCH_TITLE);
  return {
    id: item.id,
    host: item.host,
    role: "bench",
    tool: "terminal",
    title,
    titleCustom: !!item.titleCustom,
    terminals: [{ id: item.id, title }],
    activeTerminalId: item.id,
  };
}

/**
 * 把 v1 的「一工具一标签」收成主机工作区。
 * 跨主机分屏（树里多台主机，或标题 Workspace）原样留成工作台，id 不变，布局键才能对上。
 */
export function migrateWorkspaces(
  legacy: LegacySession[],
  layouts: SavedWorkspace[],
  activeId: string
): { sessions: MigratedWorkspace[]; activeSessionId: string } {
  const layoutById = new Map(layouts.map((it) => [it.id, it]));
  const benchIds = new Set<string>();
  for (const it of layouts) {
    if (isBenchLayout(it)) benchIds.add(it.id);
  }
  for (const s of legacy) {
    if (s.kind === "terminal" && (isDefaultBenchTitle(s.title) || benchIds.has(s.id))) {
      benchIds.add(s.id);
    }
  }

  const sessions: MigratedWorkspace[] = [];
  const hostAt = new Map<string, number>();
  const seenBench = new Set<string>();

  function ensureHost(host: string): MigratedWorkspace {
    const at = hostAt.get(host);
    if (at != null) return sessions[at];
    const sess: MigratedWorkspace = {
      id: `host:${host}`,
      host,
      role: "host",
      tool: "terminal",
      title: host,
      titleCustom: false,
      terminals: [],
      activeTerminalId: "",
    };
    hostAt.set(host, sessions.length);
    sessions.push(sess);
    return sess;
  }

  for (const s of legacy) {
    if (benchIds.has(s.id)) {
      if (seenBench.has(s.id)) continue;
      seenBench.add(s.id);
      sessions.push(benchFromLegacy(s, layoutById.get(s.id)));
      continue;
    }
    const host = ensureHost(s.host);
    if (s.kind !== "terminal") continue;
    if (host.terminals.some((t) => t.id === s.id)) continue;
    host.terminals.push({
      id: s.id,
      title: s.title || `${s.host} 终端`,
    });
  }

  if (legacy.length === 0) {
    for (const it of layouts) {
      if (seenBench.has(it.id)) continue;
      if (benchIds.has(it.id)) {
        seenBench.add(it.id);
        sessions.push(benchFromLayout(it));
        continue;
      }
      if (!it.host) continue;
      const host = ensureHost(it.host);
      if (host.terminals.some((t) => t.id === it.id)) continue;
      host.terminals.push({
        id: it.id,
        title: it.title || `${it.host} 终端`,
      });
    }
  }

  const byHost = new Map<string, LegacySession[]>();
  for (const s of legacy) {
    if (benchIds.has(s.id)) continue;
    const list = byHost.get(s.host) || [];
    list.push(s);
    byHost.set(s.host, list);
  }
  for (const [host, list] of byHost) {
    const sess = ensureHost(host);
    const activeOne = list.find((s) => s.id === activeId);
    const pick = activeOne || list[list.length - 1];
    if (pick) sess.tool = pick.kind;
    const activeDesk = sess.terminals.find((t) => t.id === activeId);
    if (activeDesk) sess.activeTerminalId = activeDesk.id;
    else if (!sess.activeTerminalId && sess.terminals.length > 0) {
      sess.activeTerminalId = sess.terminals[sess.terminals.length - 1].id;
    }
  }

  for (const sess of sessions) {
    if (sess.role !== "host") continue;
    if (sess.activeTerminalId) continue;
    if (sess.terminals.length === 0) continue;
    sess.activeTerminalId = sess.terminals[sess.terminals.length - 1].id;
  }

  let activeSessionId = "";
  const legacyActive = legacy.find((s) => s.id === activeId);
  if (legacyActive) {
    activeSessionId = benchIds.has(legacyActive.id)
      ? legacyActive.id
      : `host:${legacyActive.host}`;
  } else {
    const owner = sessions.find(
      (s) => s.id === activeId || s.terminals.some((t) => t.id === activeId)
    );
    activeSessionId = owner?.id || "";
  }

  return { sessions, activeSessionId };
}

function deskTitle(raw: string, crossHost: boolean): string {
  const title = raw.trim();
  if (crossHost) {
    if (!title || isDefaultBenchTitle(title)) return SPLIT_TITLE;
    return title;
  }
  return title || "终端";
}

/**
 * 把主机工作区里的终端、以及独立工作台，抬成终端模块的会话。
 * 主机标签只留下管理页面；服务仍可从旧持久化数据恢复。desk id 保持不变。
 */
export function liftTerminalDesks(
  sessions: MigratedWorkspace[],
  activeSessionId: string
): {
  hostSessions: MigratedWorkspace[];
  desks: PersistedDesk[];
  activeHostSessionId: string;
  activeDeskId: string;
  openedOnTerminal: boolean;
} {
  const desks: PersistedDesk[] = [];
  const hostSessions: MigratedWorkspace[] = [];
  const seen = new Set<string>();

  function pushDesk(desk: PersistedDesk) {
    if (!desk.id || seen.has(desk.id)) return;
    seen.add(desk.id);
    desks.push(desk);
  }

  for (const s of sessions) {
    if (s.role === "bench") {
      const id = s.terminals[0]?.id || s.id;
      const custom = !!s.titleCustom && !isDefaultBenchTitle(s.title);
      pushDesk({
        id,
        host: s.host,
        title: custom ? s.title : SPLIT_TITLE,
        titleCustom: custom,
        crossHost: true,
      });
      continue;
    }
    for (const t of s.terminals) {
      pushDesk({
        id: t.id,
        host: s.host,
        title: deskTitle(t.title, false),
        titleCustom: false,
        crossHost: false,
      });
    }
    if (s.tool === "terminal") continue;
    hostSessions.push({
      ...s,
      terminals: [],
      activeTerminalId: "",
    });
  }

  let activeHostSessionId = "";
  let activeDeskId = "";
  let openedOnTerminal = false;
  const active = sessions.find(
    (s) => s.id === activeSessionId || s.terminals.some((t) => t.id === activeSessionId)
  );
  if (active?.role === "bench") {
    openedOnTerminal = true;
    activeDeskId = active.terminals[0]?.id || active.id;
  } else if (active && (active.tool === "terminal" || active.terminals.some((t) => t.id === activeSessionId))) {
    openedOnTerminal = true;
    const hit = active.terminals.find((t) => t.id === activeSessionId);
    activeDeskId = hit?.id || active.activeTerminalId || active.terminals[active.terminals.length - 1]?.id || "";
  } else if (active) {
    activeHostSessionId = active.id;
    activeDeskId = active.activeTerminalId || "";
  }

  return {
    hostSessions,
    desks,
    activeHostSessionId,
    activeDeskId,
    openedOnTerminal,
  };
}
