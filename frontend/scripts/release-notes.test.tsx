import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ReleaseNotes } from "../src/react/components/release-notes";
import { parseReleaseNotes } from "../src/utils/releaseNotes";

const NOTES = `# 1.3.0

## 新功能

- 新增文件列表类型图标，同一类型的文件排在一起
- 新增进程日志级别筛选，可多选；异常堆栈仍留在对应记录下面
- 托盘菜单可以检查更新，也可以重新启动；没有新版本或检查失败时会说明原因

## 改进

- 窗口放得下时，看板直接显示每台主机近一小时的 CPU 和内存曲线；放不下时仍用总览表或多列机柜

## 其他

- 新增 \`scripts/publish.sh\`，可按最近提交直接发布到 GitHub
`;

test("v1.3.0 notes become headings, lists and inline code", () => {
  const html = renderToStaticMarkup(<ReleaseNotes text={NOTES} />);
  expect(html).toContain("<h1");
  expect(html).toContain(">1.3.0<");
  expect(html).toContain("<h2");
  expect(html).toContain(">新功能<");
  expect(html).toContain(">改进<");
  expect(html).toContain("<li");
  expect(html).toContain("<code");
  expect(html).toContain("scripts/publish.sh");
  expect(html).not.toContain("# 1.3.0");
  expect(html).not.toContain("## 新功能");
  expect(html).not.toContain("- 新增文件");
});

test("plain lines stay readable and windows newlines do not split tokens", () => {
  const blocks = parseReleaseNotes("v1.1.0 更新说明\r\n- 新增应用内自动更新");
  expect(blocks.map((block) => block.kind)).toEqual(["paragraph", "list"]);
});

test("bold, emphasis and changelog links render, unsafe targets stay text", () => {
  const html = renderToStaticMarkup(
    <ReleaseNotes
      text={'看 **加粗** 和 *斜体*，以及 <https://github.com/itjun/1Panel>\n\n<script>alert(1)</script>\n\n[点我](javascript:alert(1))'}
    />,
  );
  expect(html).toContain("<strong>");
  expect(html).toContain("<em>");
  expect(html).toContain('href="https://github.com/itjun/1Panel"');
  expect(html).toContain("&lt;script&gt;");
  expect(html).not.toContain("<script>");
  expect(html).not.toContain('href="javascript:');
  expect(html).toContain("javascript:alert(1)");
});

test("a fenced block is not scanned as markdown", () => {
  const blocks = parseReleaseNotes("```\n## 不是标题\n- 不是列表\n```");
  expect(blocks).toEqual([{ kind: "code", text: "## 不是标题\n- 不是列表" }]);
});

test("empty notes use the fallback sentence", () => {
  const html = renderToStaticMarkup(<ReleaseNotes text={"  \n"} />);
  expect(html).toContain("本次更新未附说明。");
});
