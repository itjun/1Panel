/** 日志原文 → 高亮 HTML（.ng-line 行号）。级别、时间、地址、引号、key= 上色。 */

const MAX_CHARS = 512 * 1024;

const TOKEN =
  /(\[[0-9]+(?:\.[0-9]+)?\])|(\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}\b)|(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)|(\b(?:EMERG|ALERT|CRIT|CRITICAL|FATAL|ERROR|ERR|WARN|WARNING|NOTICE|INFO|DEBUG)\b)|(\b(?:\d{1,3}\.){3}\d{1,3}\b)|("[^"\n]*"|'[^'\n]*')|(\b[\w.-]+=)/g;

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function span(cls: string, raw: string): string {
  return `<span class="${cls}">${escapeHtml(raw)}</span>`;
}

function levelClass(word: string): string {
  const upper = word.toUpperCase();
  if (
    upper === "EMERG" ||
    upper === "ALERT" ||
    upper === "CRIT" ||
    upper === "CRITICAL" ||
    upper === "FATAL" ||
    upper === "ERROR" ||
    upper === "ERR"
  ) {
    return "hljs-keyword";
  }
  if (upper === "WARN" || upper === "WARNING") return "log-warn";
  if (upper === "DEBUG") return "hljs-comment";
  return "hljs-type";
}

function highlightLine(raw: string): string {
  TOKEN.lastIndex = 0;
  let out = "";
  let cursor = 0;
  let match = TOKEN.exec(raw);
  while (match) {
    const start = match.index;
    if (start > cursor) out += escapeHtml(raw.slice(cursor, start));
    const piece = match[0];
    if (match[4]) out += span(levelClass(piece), piece);
    else if (match[6]) out += span("hljs-string", piece);
    else if (match[7]) out += span("hljs-attribute", piece);
    else if (match[5]) out += span("hljs-number", piece);
    else out += span("hljs-meta", piece);
    cursor = start + piece.length;
    match = TOKEN.exec(raw);
  }
  if (cursor < raw.length) out += escapeHtml(raw.slice(cursor));
  return out;
}

export function logHighlightHtml(text: string): string {
  if (!text) return "";
  const source = text.length > MAX_CHARS ? text.slice(text.length - MAX_CHARS) : text;
  return source
    .split("\n")
    .map((line) => `<span class="ng-line">${highlightLine(line)}</span>`)
    .join("");
}
