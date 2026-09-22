/** 终端页应用快捷键。Ctrl+字母一律留给 PTY（Ctrl+D 退出、Ctrl+W 删词、Ctrl+C 中断）。 */

/** 新建终端是唯一允许在 Windows/Linux 使用不带 Shift 的 Ctrl 快捷键。 */
export function isTermNewShortcut(
  e: { metaKey: boolean; ctrlKey: boolean; shiftKey?: boolean; code?: string },
  mac: boolean,
): boolean {
  if (e.shiftKey || e.code !== "KeyT") return false;
  return mac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
}

export function isTermAppShortcut(
  e: { metaKey: boolean; ctrlKey: boolean; shiftKey?: boolean },
  mac: boolean
): boolean {
  if (mac) return e.metaKey && !e.ctrlKey;
  return e.ctrlKey && !e.metaKey && !!e.shiftKey;
}

export const TERM_EOF = "\x04";

/** 最后一格关窗格或正常退出时，关掉整场会话标签。Ctrl+D 一律先送给 PTY。 */
export function shouldCloseDeskOnLastPane(paneCount: number): boolean {
  return paneCount <= 1;
}

/** Ctrl+D → \x04。焦点不在 xterm 时，把这一下补进 PTY。 */
export function ctrlLetter(e: { ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean; key: string }): string {
  if (!e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return "";
  if (e.key.length !== 1) return "";
  const code = e.key.toUpperCase().charCodeAt(0);
  if (code < 64 || code > 95) return "";
  return String.fromCharCode(code - 64);
}
