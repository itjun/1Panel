/** HTML 转义：纯文本内容只需这三个字符 */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * 纯文本（hosts 等无语法高亮配置）→ 行号 HTML：
 * 每行转义后包 .ng-line（供 CSS counter 显示行号），
 * # 开头的注释行整行再包 .raw-comment 弱化显示。
 * 各行 join("") 直接连（不加 \n）：pre 下块级元素之间的换行符
 * 文本节点会渲染成空行、行距翻倍（项目已踩坑）。
 */
export function plainCodeHtml(text: string): string {
  if (!text) return "";
  return text
    .split("\n")
    .map((line) => {
      const escaped = escapeHtml(line);
      const body = escaped.trimStart().startsWith("#")
        ? `<span class="raw-comment">${escaped}</span>`
        : escaped;
      return `<span class="ng-line">${body}</span>`;
    })
    .join("");
}
