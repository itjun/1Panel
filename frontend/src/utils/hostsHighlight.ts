/** HTML 转义：纯文本内容只需这三个字符 */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function span(cls: string, s: string): string {
  return `<span class="${cls}">${escapeHtml(s)}</span>`;
}

/** 单行：注释 / IP / 主机名，行内 # 注释。hosts 按行解析，不跨行。 */
function highlightHostsLine(raw: string): string {
  const lead = raw.match(/^\s*/)?.[0] ?? "";
  const rest = raw.slice(lead.length);
  if (!rest) return escapeHtml(raw);
  if (rest.startsWith("#")) {
    return escapeHtml(lead) + span("hljs-comment", rest);
  }

  let body = rest;
  let comment = "";
  const hashIdx = rest.search(/(?<=^|\s)#/);
  if (hashIdx >= 0) {
    body = rest.slice(0, hashIdx);
    comment = rest.slice(hashIdx);
  }

  const m = body.match(/^(\S+)([\s\S]*)$/);
  if (!m) return escapeHtml(raw);

  const ipHtml = span("hljs-number", m[1]);
  const namesHtml = m[2].replace(/(\s+)|(\S+)/g, (chunk, ws: string | undefined) =>
    ws ? escapeHtml(chunk) : span("hljs-string", chunk)
  );
  const commentHtml = comment ? span("hljs-comment", comment) : "";
  return escapeHtml(lead) + ipHtml + namesHtml + commentHtml;
}

/**
 * /etc/hosts 原文 → 高亮 HTML（每行包 .ng-line 供行号）。
 * 注释 hljs-comment、IP hljs-number、主机名 hljs-string，复用 CodePane Monokai。
 */
export function hostsHighlightHtml(text: string): string {
  if (!text) return "";
  return text
    .split("\n")
    .map((line) => `<span class="ng-line">${highlightHostsLine(line)}</span>`)
    .join("");
}
