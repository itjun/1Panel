import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AgentCheckReport } from "../src/react/components/agent-check-report";

test("检查结果逐项展示状态和原因，版本异常不会变成 object 字符串", () => {
  const items = [
    { key: "service", name: "服务", ok: true, detail: "systemd active" },
    { key: "comm", name: "通信", ok: true, detail: "隧道正常，已运行 12 小时" },
    { key: "version", name: "版本", ok: false, detail: "远端 v0.2.29，面板内置 v0.2.53" },
    { key: "collect", name: "采集", ok: true, detail: "已写入 120 条" },
    { key: "disk", name: "磁盘", ok: true, detail: "水位正常" },
    { key: "memory", name: "内存", ok: true, detail: "RSS 8192 KB" },
  ];
  const html = renderToStaticMarkup(createElement(AgentCheckReport, {
    report: { ok: false, summary: "1 项异常", items },
  }));
  expect(html).toContain("1 项异常");
  expect(html).not.toContain("[object Object]");
  const rows = html.match(/<li\b[^>]*>[\s\S]*?<\/li>/g) ?? [];
  expect(rows).toHaveLength(6);
  items.forEach((item, index) => {
    expect(rows[index]).toContain(item.name);
    expect(rows[index]).toContain(item.detail);
    expect(rows[index]).toContain(item.ok ? "正常" : "异常");
  });
});

test("正常报告保留摘要，缺失明细时明确提示", () => {
  const html = renderToStaticMarkup(createElement(AgentCheckReport, {
    report: { ok: true, summary: "Agent 工作正常", items: [] },
  }));
  expect(html).toContain("Agent 工作正常");
  expect(html).toContain("未返回检查明细");
  expect(html).not.toContain("<li");
});

test("远端错误中的标记作为普通文本展示", () => {
  const html = renderToStaticMarkup(createElement(AgentCheckReport, {
    report: { ok: false, summary: "1 项异常", items: [
      { key: "comm", name: "通信", ok: false, detail: "连接失败\n<script>alert(1)</script>" },
    ] },
  }));
  expect(html).toContain("连接失败\n&lt;script&gt;");
  expect(html).not.toContain("<script>");
});
