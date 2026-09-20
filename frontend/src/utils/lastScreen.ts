import {
  isPersistTool,
  liftTerminalDesks,
  migrateWorkspaces,
  type DeskRef,
  type LegacySession,
  type MigratedWorkspace,
  type PersistedDesk,
  type PersistTool,
  type WorkspaceRole,
} from "@/utils/workspaceMigrate";

const KEY = "1pannel-last-screen";

export type LastScreenKind = "terminal" | "info" | "sftp" | "monitor";

export type ScreenWorkspace = "remote" | "notify" | "terminal";

/** 启动与离开时共用的画面。主机标签和终端会话已经拆开。 */
export interface NormalizedScreen {
  workspace: ScreenWorkspace;
  settingsOpen: boolean;
  activeHostSessionId: string;
  activeTerminalId: string;
  hostSessions: MigratedWorkspace[];
  desks: PersistedDesk[];
}

const LEGACY_KINDS: LastScreenKind[] = ["terminal", "info", "sftp", "monitor"];

function isLegacyKind(v: unknown): v is LastScreenKind {
  return LEGACY_KINDS.includes(v as LastScreenKind);
}

function readDesk(v: unknown): DeskRef | null {
  if (!v || typeof v !== "object") return null;
  const d = v as Partial<DeskRef>;
  const id = typeof d.id === "string" ? d.id.trim() : "";
  if (!id) return null;
  const title = typeof d.title === "string" ? d.title.trim() : "";
  return { id, title: title || "终端" };
}

function readLegacy(v: unknown): LegacySession | null {
  if (!v || typeof v !== "object") return null;
  const s = v as Partial<LegacySession>;
  const id = typeof s.id === "string" ? s.id.trim() : "";
  const host = typeof s.host === "string" ? s.host.trim() : "";
  if (!id || !host || !isLegacyKind(s.kind)) return null;
  const title = typeof s.title === "string" ? s.title.trim() : "";
  return {
    id,
    host,
    kind: s.kind,
    title: title || host,
    titleCustom: s.titleCustom === true,
  };
}

function readV2Session(v: unknown): MigratedWorkspace | null {
  if (!v || typeof v !== "object") return null;
  const s = v as Partial<MigratedWorkspace>;
  const id = typeof s.id === "string" ? s.id.trim() : "";
  const host = typeof s.host === "string" ? s.host.trim() : "";
  if (!id || !host) return null;
  if (s.role !== "host" && s.role !== "bench") return null;
  if (!isPersistTool(s.tool)) return null;
  const title = typeof s.title === "string" ? s.title.trim() : "";
  const terminals: DeskRef[] = [];
  const seen = new Set<string>();
  if (Array.isArray(s.terminals)) {
    for (const item of s.terminals) {
      const d = readDesk(item);
      if (!d || seen.has(d.id)) continue;
      seen.add(d.id);
      terminals.push(d);
    }
  }
  let activeTerminalId =
    typeof s.activeTerminalId === "string" ? s.activeTerminalId : "";
  if (activeTerminalId && !seen.has(activeTerminalId)) activeTerminalId = "";
  if (!activeTerminalId && terminals.length > 0) {
    activeTerminalId = terminals[terminals.length - 1].id;
  }
  const role: WorkspaceRole = s.role;
  const tool: PersistTool = s.role === "bench" ? "terminal" : s.tool;
  return {
    id,
    host,
    role,
    tool,
    title: title || (role === "bench" ? "工作台" : host),
    titleCustom: s.titleCustom === true,
    terminals,
    activeTerminalId,
  };
}

function readPersistedDesk(v: unknown): PersistedDesk | null {
  if (!v || typeof v !== "object") return null;
  const d = v as Partial<PersistedDesk>;
  const id = typeof d.id === "string" ? d.id.trim() : "";
  const host = typeof d.host === "string" ? d.host.trim() : "";
  if (!id || !host) return null;
  const title = typeof d.title === "string" ? d.title.trim() : "";
  return {
    id,
    host,
    title: title || (d.crossHost ? "分屏" : "终端"),
    titleCustom: d.titleCustom === true,
    crossHost: d.crossHost === true,
  };
}

function workspaceOf(v: unknown): "remote" | "notify" {
  return v === "notify" ? "notify" : "remote";
}

function moduleOf(v: unknown): ScreenWorkspace {
  if (v === "notify") return "notify";
  if (v === "terminal") return "terminal";
  return "remote";
}

function fromLifted(
  sessions: MigratedWorkspace[],
  activeSessionId: string,
  workspace: "remote" | "notify",
  settingsOpen: boolean
): NormalizedScreen {
  const lifted = liftTerminalDesks(sessions, activeSessionId);
  let next: ScreenWorkspace = "remote";
  if (workspace === "notify") next = "notify";
  else if (lifted.openedOnTerminal) next = "terminal";
  return {
    workspace: next,
    settingsOpen,
    activeHostSessionId: lifted.activeHostSessionId,
    activeTerminalId: lifted.activeDeskId,
    hostSessions: lifted.hostSessions,
    desks: lifted.desks,
  };
}

export function readLastScreen(): NormalizedScreen | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as {
      version?: unknown;
      workspace?: unknown;
      settingsOpen?: unknown;
      activeSessionId?: unknown;
      activeHostSessionId?: unknown;
      activeTerminalId?: unknown;
      sessions?: unknown;
      desks?: unknown;
    };
    if (!parsed || typeof parsed !== "object") return null;
    const settingsOpen = parsed.settingsOpen === true;
    const list = Array.isArray(parsed.sessions) ? parsed.sessions : [];

    if (parsed.version === 3) {
      const hostSessions: MigratedWorkspace[] = [];
      const seenHost = new Set<string>();
      for (const item of list) {
        const s = readV2Session(item);
        if (!s || s.role !== "host" || seenHost.has(s.id)) continue;
        if (s.tool === "terminal") continue;
        seenHost.add(s.id);
        hostSessions.push({ ...s, terminals: [], activeTerminalId: "" });
      }
      const desks: PersistedDesk[] = [];
      const seenDesk = new Set<string>();
      const deskList = Array.isArray(parsed.desks) ? parsed.desks : [];
      for (const item of deskList) {
        const d = readPersistedDesk(item);
        if (!d || seenDesk.has(d.id)) continue;
        seenDesk.add(d.id);
        desks.push(d);
      }
      const activeHostSessionId =
        typeof parsed.activeHostSessionId === "string" ? parsed.activeHostSessionId : "";
      const activeTerminalId =
        typeof parsed.activeTerminalId === "string" ? parsed.activeTerminalId : "";
      return {
        workspace: moduleOf(parsed.workspace),
        settingsOpen,
        activeHostSessionId,
        activeTerminalId,
        hostSessions,
        desks,
      };
    }

    const activeSessionId =
      typeof parsed.activeSessionId === "string" ? parsed.activeSessionId : "";
    if (parsed.version === 2) {
      const sessions: MigratedWorkspace[] = [];
      const seen = new Set<string>();
      for (const item of list) {
        const s = readV2Session(item);
        if (!s || seen.has(s.id)) continue;
        seen.add(s.id);
        sessions.push(s);
      }
      return fromLifted(sessions, activeSessionId, workspaceOf(parsed.workspace), settingsOpen);
    }

    const sessions: LegacySession[] = [];
    const seen = new Set<string>();
    for (const item of list) {
      const s = readLegacy(item);
      if (!s || seen.has(s.id)) continue;
      seen.add(s.id);
      sessions.push(s);
    }
    const migrated = migrateWorkspaces(sessions, [], activeSessionId);
    return fromLifted(
      migrated.sessions,
      migrated.activeSessionId,
      workspaceOf(parsed.workspace),
      settingsOpen
    );
  } catch {
    return null;
  }
}

export function writeLastScreen(screen: NormalizedScreen) {
  try {
    localStorage.setItem(
      KEY,
      JSON.stringify({
        version: 3,
        workspace: screen.workspace,
        settingsOpen: screen.settingsOpen,
        activeHostSessionId: screen.activeHostSessionId,
        activeTerminalId: screen.activeTerminalId,
        sessions: screen.hostSessions,
        desks: screen.desks,
      })
    );
  } catch {
    /* ignore */
  }
}
