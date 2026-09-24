/** 终端分屏布局持久化（兼容旧数据读取；内置终端已移除，不再写入新布局）。 */

export type PaneDir = "row" | "col";

export interface PaneLeaf {
  kind: "leaf";
  id: string;
  host: string;
}

export interface PaneSplit {
  kind: "split";
  id: string;
  dir: PaneDir;
  ratio: number;
  a: PaneNode;
  b: PaneNode;
}

export type PaneNode = PaneLeaf | PaneSplit;

const KEY_BASE = "1pannel-workspace-layouts";
const KEY = (() => {
  if (typeof location === "undefined") return KEY_BASE;
  const params = new URLSearchParams(location.search);
  const scope = params.get("windowId") || "main";
  return `${KEY_BASE}:${scope}`;
})();

export interface SavedWorkspace {
  id: string;
  title: string;
  titleCustom: boolean;
  host: string;
  tree: PaneNode;
  focusedId: string;
}

interface SavedFile {
  version: number;
  activeId: string;
  items: SavedWorkspace[];
}

function emptyFile(): SavedFile {
  return { version: 2, activeId: "", items: [] };
}

function readFile(): SavedFile {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return emptyFile();
    const parsed = JSON.parse(raw) as SavedFile;
    if (!parsed || !Array.isArray(parsed.items)) return emptyFile();
    return {
      version: parsed.version === 2 ? 2 : 1,
      activeId: parsed.activeId || "",
      items: parsed.items.filter((it) => it && isPaneNode(it.tree) && it.id && it.host),
    };
  } catch {
    return emptyFile();
  }
}

export function isPaneNode(v: unknown): v is PaneNode {
  if (!v || typeof v !== "object") return false;
  const n = v as PaneNode;
  if (n.kind === "leaf") {
    return typeof n.id === "string" && typeof n.host === "string";
  }
  if (n.kind !== "split") return false;
  if (n.dir !== "row" && n.dir !== "col") return false;
  if (typeof n.ratio !== "number") return false;
  return isPaneNode(n.a) && isPaneNode(n.b);
}

export function hostsInTree(node: PaneNode): string[] {
  if (node.kind === "leaf") return [node.host];
  return [...hostsInTree(node.a), ...hostsInTree(node.b)];
}

/** 跨主机终端工作台的默认标签。旧数据里的 Workspace 仍算同一类。 */
export const BENCH_TITLE = "工作台";

export function isDefaultBenchTitle(title: string): boolean {
  const t = (title || "").trim();
  return t === "Workspace" || t === BENCH_TITLE;
}

export function loadSavedWorkspaces(): SavedFile {
  return readFile();
}
