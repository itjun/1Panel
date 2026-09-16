import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import c from "highlight.js/lib/languages/c";
import cpp from "highlight.js/lib/languages/cpp";
import css from "highlight.js/lib/languages/css";
import diff from "highlight.js/lib/languages/diff";
import dockerfile from "highlight.js/lib/languages/dockerfile";
import go from "highlight.js/lib/languages/go";
import ini from "highlight.js/lib/languages/ini";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import lua from "highlight.js/lib/languages/lua";
import makefile from "highlight.js/lib/languages/makefile";
import markdown from "highlight.js/lib/languages/markdown";
import nginx from "highlight.js/lib/languages/nginx";
import php from "highlight.js/lib/languages/php";
import properties from "highlight.js/lib/languages/properties";
import protobuf from "highlight.js/lib/languages/protobuf";
import python from "highlight.js/lib/languages/python";
import ruby from "highlight.js/lib/languages/ruby";
import rust from "highlight.js/lib/languages/rust";
import sql from "highlight.js/lib/languages/sql";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";
import { hostsHighlightHtml } from "@/utils/hostsHighlight";
import { plainCodeHtml } from "@/utils/plainCode";

// 按需注册常用语言，禁止全量 import "highlight.js"
const langs: Record<string, typeof python> = {
  bash,
  c,
  cpp,
  css,
  diff,
  dockerfile,
  go,
  ini,
  java,
  javascript,
  json,
  lua,
  makefile,
  markdown,
  nginx,
  php,
  properties,
  protobuf,
  python,
  ruby,
  rust,
  sql,
  typescript,
  xml,
  yaml,
};
for (const [name, def] of Object.entries(langs)) {
  hljs.registerLanguage(name, def);
}

const HIGHLIGHT_MAX_CHARS = 512 * 1024;

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function wrapLines(html: string): string {
  const tagRe = /<span class="([^"]+)">|<\/span>/g;
  const open: string[] = [];
  return html
    .split("\n")
    .map((line) => {
      const reopen = open.map((cls) => `<span class="${cls}">`).join("");
      let m: RegExpExecArray | null;
      tagRe.lastIndex = 0;
      while ((m = tagRe.exec(line))) {
        if (m[1]) open.push(m[1]);
        else open.pop();
      }
      const close = "</span>".repeat(open.length);
      return `<span class="ng-line">${reopen}${line}${close}</span>`;
    })
    .join("");
}

const BY_EXT: Record<string, string> = {
  py: "python",
  pyw: "python",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  ts: "typescript",
  mts: "typescript",
  cts: "typescript",
  json: "json",
  jsonc: "json",
  yml: "yaml",
  yaml: "yaml",
  xml: "xml",
  html: "xml",
  htm: "xml",
  vue: "xml",
  svg: "xml",
  css: "css",
  scss: "css",
  less: "css",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  ksh: "bash",
  sql: "sql",
  go: "go",
  java: "java",
  rs: "rust",
  rb: "ruby",
  php: "php",
  lua: "lua",
  md: "markdown",
  markdown: "markdown",
  ini: "ini",
  cfg: "ini",
  conf: "ini",
  cnf: "ini",
  toml: "ini",
  env: "ini",
  properties: "properties",
  diff: "diff",
  patch: "diff",
  proto: "protobuf",
  c: "c",
  h: "c",
  cpp: "cpp",
  cc: "cpp",
  cxx: "cpp",
  hpp: "cpp",
  service: "ini",
  socket: "ini",
  timer: "ini",
  dockerfile: "dockerfile",
};

const BY_NAME: Record<string, string> = {
  dockerfile: "dockerfile",
  makefile: "makefile",
  gnumakefile: "makefile",
  hosts: "hosts",
  ".bashrc": "bash",
  ".zshrc": "bash",
  ".profile": "bash",
  ".gitignore": "ini",
};

function langFromPath(path: string): string | "hosts" | null {
  const base = path.split("/").pop() || path;
  const lower = base.toLowerCase();
  if (BY_NAME[lower]) return BY_NAME[lower];
  const dot = lower.lastIndexOf(".");
  if (dot >= 0) {
    const ext = lower.slice(dot + 1);
    if (BY_EXT[ext]) return BY_EXT[ext];
  }
  return null;
}

function langFromShebang(text: string): string | null {
  const first = text.split("\n", 1)[0] || "";
  if (!first.startsWith("#!")) return null;
  const s = first.toLowerCase();
  if (s.includes("python")) return "python";
  if (s.includes("node")) return "javascript";
  if (s.includes("bash") || s.includes("/sh") || s.includes("zsh")) return "bash";
  if (s.includes("ruby")) return "ruby";
  if (s.includes("perl")) return "bash";
  if (s.includes("lua")) return "lua";
  return null;
}

/**
 * 按文件名 / shebang 高亮，每行包 .ng-line。
 * hosts 走专用解析；无法识别或超大文件降级纯文本。
 */
export function highlightFileHtml(text: string, path: string): string {
  if (!text) return "";
  if (text.length > HIGHLIGHT_MAX_CHARS) return plainCodeHtml(text);

  const lang = langFromPath(path) || langFromShebang(text);
  if (lang === "hosts") return hostsHighlightHtml(text);
  if (!lang || !langs[lang]) return plainCodeHtml(text);

  const html = hljs.highlight(text, {
    language: lang,
    ignoreIllegals: true,
  }).value;
  return wrapLines(html);
}
