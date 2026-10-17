/*
  更新说明按 Markdown 排版。内容来自签名过的 latest.json，仍然只生成文本节点：
  尖括号原样显示，链接只接受 http/https。星号才表示强调，避免把标识符里的下划线当成斜体。
*/

export type InlineNode =
  | { kind: "text"; text: string }
  | { kind: "code"; text: string }
  | { kind: "strong"; children: InlineNode[] }
  | { kind: "em"; children: InlineNode[] }
  | { kind: "link"; href: string; children: InlineNode[] };

export type ReleaseBlock =
  | { kind: "heading"; level: number; inlines: InlineNode[] }
  | { kind: "paragraph"; inlines: InlineNode[] }
  | { kind: "list"; ordered: boolean; items: InlineNode[][] }
  | { kind: "code"; text: string }
  | { kind: "quote"; inlines: InlineNode[] };

const HEADING = /^(#{1,6})[ \t]+(\S.*)$/;
const BULLET = /^[-*+][ \t]+(.*)$/;
const ORDERED = /^(\d+)\.[ \t]+(.*)$/;
const QUOTE = /^>[ \t]?(.*)$/;

export function parseReleaseNotes(source: string): ReleaseBlock[] {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReleaseBlock[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index++;
      continue;
    }
    if (line.trimStart().startsWith("```")) {
      const body: string[] = [];
      index++;
      while (index < lines.length && !lines[index].trimStart().startsWith("```")) {
        body.push(lines[index]);
        index++;
      }
      if (index < lines.length) index++;
      blocks.push({ kind: "code", text: body.join("\n") });
      continue;
    }
    const heading = line.match(HEADING);
    if (heading) {
      blocks.push({
        kind: "heading",
        level: heading[1].length,
        inlines: parseInline(heading[2].trim()),
      });
      index++;
      continue;
    }
    const bullet = line.match(BULLET);
    if (bullet) {
      const items: InlineNode[][] = [];
      while (index < lines.length) {
        const item = lines[index].match(BULLET);
        if (!item) break;
        items.push(parseInline(item[1].trim()));
        index++;
      }
      blocks.push({ kind: "list", ordered: false, items });
      continue;
    }
    const ordered = line.match(ORDERED);
    if (ordered) {
      const items: InlineNode[][] = [];
      while (index < lines.length) {
        const item = lines[index].match(ORDERED);
        if (!item) break;
        items.push(parseInline(item[2].trim()));
        index++;
      }
      blocks.push({ kind: "list", ordered: true, items });
      continue;
    }
    const quote = line.match(QUOTE);
    if (quote) {
      const parts: string[] = [];
      while (index < lines.length) {
        const row = lines[index].match(QUOTE);
        if (!row) break;
        parts.push(row[1]);
        index++;
      }
      blocks.push({ kind: "quote", inlines: parseInline(parts.join(" ").trim()) });
      continue;
    }
    blocks.push({ kind: "paragraph", inlines: parseInline(line.trim()) });
    index++;
  }
  return blocks;
}

export function parseInline(input: string): InlineNode[] {
  const nodes: InlineNode[] = [];
  let buffer = "";
  let index = 0;
  while (index < input.length) {
    const code = readCode(input, index);
    if (code) {
      buffer = pushText(nodes, buffer);
      nodes.push({ kind: "code", text: code.text });
      index = code.next;
      continue;
    }
    const strong = readWrapped(input, index, "**");
    if (strong) {
      buffer = pushText(nodes, buffer);
      nodes.push({ kind: "strong", children: parseInline(strong.body) });
      index = strong.next;
      continue;
    }
    const em = readEm(input, index);
    if (em) {
      buffer = pushText(nodes, buffer);
      nodes.push({ kind: "em", children: parseInline(em.body) });
      index = em.next;
      continue;
    }
    const link = readLink(input, index);
    if (link) {
      buffer = pushText(nodes, buffer);
      nodes.push({ kind: "link", href: link.href, children: parseInline(link.label) });
      index = link.next;
      continue;
    }
    const angle = readAngleLink(input, index);
    if (angle) {
      buffer = pushText(nodes, buffer);
      nodes.push({ kind: "link", href: angle.href, children: [{ kind: "text", text: angle.href }] });
      index = angle.next;
      continue;
    }
    const url = readAutolink(input, index);
    if (url) {
      buffer = pushText(nodes, buffer);
      nodes.push({ kind: "link", href: url.href, children: [{ kind: "text", text: url.href }] });
      index = url.next;
      continue;
    }
    buffer += input[index];
    index++;
  }
  pushText(nodes, buffer);
  return nodes;
}

function pushText(nodes: InlineNode[], buffer: string): string {
  if (buffer) nodes.push({ kind: "text", text: buffer });
  return "";
}

function readCode(input: string, start: number): { text: string; next: number } | null {
  if (input[start] !== "`") return null;
  const close = input.indexOf("`", start + 1);
  if (close <= start + 1) return null;
  return { text: input.slice(start + 1, close), next: close + 1 };
}

function readWrapped(input: string, start: number, marker: string): { body: string; next: number } | null {
  if (!input.startsWith(marker, start)) return null;
  const bodyStart = start + marker.length;
  const close = input.indexOf(marker, bodyStart);
  if (close <= bodyStart) return null;
  return { body: input.slice(bodyStart, close), next: close + marker.length };
}

/** 斜体的结束星号要跳过成对的 **，否则 *a **b** c* 会在加粗处被截断。 */
function readEm(input: string, start: number): { body: string; next: number } | null {
  if (input[start] !== "*" || input[start + 1] === "*" || input[start + 1] === " ") return null;
  let index = start + 1;
  while (index < input.length) {
    if (input.startsWith("**", index)) {
      index += 2;
      continue;
    }
    if (input[index] === "*" && input[index - 1] !== " ") {
      return { body: input.slice(start + 1, index), next: index + 1 };
    }
    index++;
  }
  return null;
}

function readLink(input: string, start: number): { label: string; href: string; next: number } | null {
  if (input[start] !== "[") return null;
  const labelEnd = input.indexOf("]", start + 1);
  if (labelEnd < 0 || input[labelEnd + 1] !== "(") return null;
  const hrefEnd = input.indexOf(")", labelEnd + 2);
  if (hrefEnd < 0) return null;
  const label = input.slice(start + 1, labelEnd);
  const href = input.slice(labelEnd + 2, hrefEnd).trim();
  if (!label || !isSafeHref(href)) return null;
  return { label, href, next: hrefEnd + 1 };
}

function readAngleLink(input: string, start: number): { href: string; next: number } | null {
  if (input[start] !== "<") return null;
  const end = input.indexOf(">", start + 1);
  if (end < 0) return null;
  const href = input.slice(start + 1, end).trim();
  if (!isSafeHref(href)) return null;
  return { href, next: end + 1 };
}

function readAutolink(input: string, start: number): { href: string; next: number } | null {
  const prev = start > 0 ? input[start - 1] : "";
  if (prev && /[A-Za-z0-9]/.test(prev)) return null;
  if (!input.startsWith("https://", start) && !input.startsWith("http://", start)) return null;
  let end = start;
  while (end < input.length && !/\s/.test(input[end]) && input[end] !== "<" && input[end] !== ">") end++;
  let href = input.slice(start, end);
  while (href && /[.,;:!?。，、)\]>]$/.test(href)) {
    href = href.slice(0, -1);
    end--;
  }
  if (!isSafeHref(href)) return null;
  return { href, next: end };
}

function isSafeHref(href: string): boolean {
  try {
    const url = new URL(href);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}
