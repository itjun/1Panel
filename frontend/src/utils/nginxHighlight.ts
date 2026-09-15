import hljs from "highlight.js/lib/core";
import nginx from "highlight.js/lib/languages/nginx";

// 按需注册：只带 nginx 一门语言，禁止全量 import "highlight.js"（会打包全部 190 种语言）
hljs.registerLanguage("nginx", nginx);

/** 超过该字符数跳过高亮直接纯文本：同步高亮超大文件会卡主线程 */
const HIGHLIGHT_MAX_CHARS = 512 * 1024;

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * 跨行高亮 span 拆行修补：hljs 输出的 <span> 可能跨越 \n（nginx 语法罕见但存在），
 * 直接按行切开会让 HTML 标签失衡。这里逐行统计开/闭标签维护未闭合栈，
 * 行首重开、行尾补闭，保证每行自身标签平衡，可安全包进 .ng-line。
 * 各行以块级 .ng-line 直接相连（不加 \n）：pre-wrap 下块级元素之间的换行符
 * 文本节点会渲染出空行，导致行距翻倍；块级元素复制时浏览器自动补换行。
 */
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

/**
 * nginx 配置文本 → 高亮 HTML（每行包 .ng-line 供 CSS counter 行号使用）。
 * 结果只含 hljs 官方输出的 span 与 .ng-line 包装，可安全 v-html。
 * 超大文件降级为转义后的纯文本。
 */
export function nginxHighlightHtml(text: string): string {
  if (!text) return "";
  if (text.length > HIGHLIGHT_MAX_CHARS) return escapeHtml(text);
  const html = hljs.highlight(text, {
    language: "nginx",
    ignoreIllegals: true,
  }).value;
  return wrapLines(html);
}
