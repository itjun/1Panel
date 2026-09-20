import type { PaneNode } from "@/views/termPanes";

const KEY = "1pannel-workspace-layouts";

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

function writeFile(file: { activeId: string; items: SavedWorkspace[] }) {
  localStorage.setItem(
    KEY,
    JSON.stringify({ version: 2, activeId: file.activeId, items: file.items })
  );
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

/** 多台主机并在一起才算工作区。改过名的工作区，就算后来只剩一台，标签还在就继续保留。 */
export function shouldKeepWorkspace(
  title: string,
  titleCustom: boolean,
  tree: PaneNode,
  alreadySaved: boolean
): boolean {
  if (isDefaultBenchTitle(title)) return true;
  const names = new Set(hostsInTree(tree));
  if (names.size > 1) return true;
  return alreadySaved && titleCustom;
}

export function loadSavedWorkspaces(): SavedFile {
  return readFile();
}

export function upsertSavedWorkspace(item: SavedWorkspace) {
  const file = readFile();
  const next = file.items.filter((it) => it.id !== item.id);
  next.push(item);
  writeFile({ activeId: item.id, items: next });
}

export function removeSavedWorkspace(id: string) {
  const file = readFile();
  if (!file.items.some((it) => it.id === id)) return;
  const items = file.items.filter((it) => it.id !== id);
  const activeId = file.activeId === id ? items[items.length - 1]?.id || "" : file.activeId;
  writeFile({ activeId, items });
}

export function touchSavedWorkspaceActive(id: string) {
  const file = readFile();
  if (!file.items.some((it) => it.id === id)) return;
  if (file.activeId === id) return;
  writeFile({ ...file, activeId: id });
}

export function patchSavedWorkspaceTitle(id: string, title: string, titleCustom: boolean) {
  const file = readFile();
  const item = file.items.find((it) => it.id === id);
  if (!item) return;
  item.title = title;
  item.titleCustom = titleCustom;
  writeFile(file);
}
