/** apt sources.list / DEB822 原文 → 高亮 HTML（.ng-line 行号）。 */

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function span(cls: string, s: string): string {
  return `<span class="${cls}">${escapeHtml(s)}</span>`;
}

function highlightLine(raw: string): string {
  const lead = raw.match(/^\s*/)?.[0] ?? "";
  const rest = raw.slice(lead.length);
  if (!rest) return escapeHtml(raw);
  if (rest.startsWith("#")) {
    return escapeHtml(lead) + span("hljs-comment", rest);
  }
  if (/^(deb-src|deb)\b/.test(rest)) {
    return (
      escapeHtml(lead) +
      rest.replace(/^(deb-src|deb)|(\[[^\]]*\])|(https?:\/\/\S+)|(\S+)/g, (all, kw, opt, url, word) => {
        if (kw) return span("hljs-keyword", kw);
        if (opt) return span("hljs-params", opt);
        if (url) return span("hljs-string", url);
        if (word) return span("hljs-number", word);
        return escapeHtml(all);
      })
    );
  }
  const field = rest.match(/^([A-Za-z-]+)(:)(\s*)(.*)$/);
  if (field) {
    const val = field[4];
    const valHtml = /https?:\/\//.test(val)
      ? val.replace(/(https?:\/\/\S+)/g, (u) => span("hljs-string", u))
      : span("hljs-number", val);
    return (
      escapeHtml(lead) +
      span("hljs-keyword", field[1]) +
      escapeHtml(field[2] + field[3]) +
      valHtml
    );
  }
  return escapeHtml(raw);
}

export function aptHighlightHtml(text: string): string {
  if (!text) return "";
  return text
    .split("\n")
    .map((line) => `<span class="ng-line">${highlightLine(line)}</span>`)
    .join("");
}
