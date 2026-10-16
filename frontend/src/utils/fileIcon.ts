import catalog from "../assets/file-icons/catalog.json";

export type FileIconName = keyof typeof catalog.icons;
export type FileIconKind = FileIconName | "folder";
const names = new Map<string, string>(Object.entries(catalog.names));
const extensions = new Map<string, string>(Object.entries(catalog.extensions));
const patterns: { prefix?: string; suffix?: string; icon: string }[] = catalog.patterns;

/** Filename-only lookup keeps local and remote files consistent, without disk/network I/O. */
export function fileIconKind(name: string, isDir = false): FileIconKind {
  if (isDir) return "folder";
  const lower = name.toLowerCase();
  const exact = names.get(lower);
  if (exact) return exact as FileIconName;
  for (const pattern of patterns) {
    if ((!pattern.prefix || lower.startsWith(pattern.prefix)) &&
        (!pattern.suffix || lower.endsWith(pattern.suffix))) {
      return pattern.icon as FileIconName;
    }
  }
  // Try the longest extension first: .d.ts before .ts, .tar.zst before .zst.
  // A leading dot alone is a hidden filename, not an extension (e.g. .pdf).
  for (let dot = lower.indexOf(".", 1); dot !== -1; dot = lower.indexOf(".", dot + 1)) {
    const icon = extensions.get(lower.slice(dot + 1));
    if (icon) return icon as FileIconName;
  }
  return "file";
}

export const fileIconAssets: Record<FileIconName, { file: string; light?: string }> = catalog.icons;
