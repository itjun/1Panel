import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AgentInstallController, type AgentInstallProgress } from "../src/utils/agentInstall";
import { AgentInstallProgress as Progress } from "../src/react/components/agent-install-progress";

function harness() {
  let listener: ((event: AgentInstallProgress) => void) | undefined;
  let resolve!: (results: { host: string; ok: boolean; version: string; error?: string }[]) => void;
  let reject!: (error: Error) => void;
  const calls: string[][] = [];
  let releases = 0;
  const controller = new AgentInstallController({
    onProgress: callback => {
      listener = callback;
      return () => { listener = undefined; releases++; };
    },
    install: hosts => {
      calls.push(hosts);
      return new Promise((ok, fail) => { resolve = ok; reject = fail; });
    },
  });
  return {
    controller, calls,
    emit: (event: AgentInstallProgress) => listener?.(event),
    resolve: (results: Parameters<typeof resolve>[0]) => resolve(results),
    reject: (error: Error) => reject(error),
    releases: () => releases,
  };
}

describe("统一 Agent 安装会话", () => {
  test("空目标不会触发后端的全主机安装，重复目标只提交一次", async () => {
    const h = harness();
    h.controller.open(["", "  "]);
    await h.controller.start();
    expect(h.calls).toHaveLength(0);
    h.controller.open(["alpha", "alpha", "beta"]);
    expect(h.calls).toHaveLength(0);
    const pending = h.controller.start();
    expect(h.calls).toEqual([["alpha", "beta"]]);
    h.resolve([]);
    await pending;
  });

  test("慢请求期间交替入口、关闭和连续确认不会改变目标或重复提交", async () => {
    const h = harness();
    h.controller.open(["alpha"]);
    const pending = h.controller.start();
    h.controller.open(["beta", "gamma"]);
    h.controller.close();
    await h.controller.start();
    expect(h.calls).toEqual([["alpha"]]);
    expect(h.controller.getSnapshot().phase).toBe("running");
    expect(h.controller.getSnapshot().rows.map(row => row.host)).toEqual(["alpha"]);
    h.resolve([{ host: "alpha", ok: true, version: "1.0.0" }]);
    await pending;
    expect(h.releases()).toBe(1);
    h.controller.close();
    expect(h.controller.getSnapshot().phase).toBe("idle");
  });

  test("上传 100% 和启动等待 100% 均不显示整项安装完成", async () => {
    const h = harness();
    h.controller.open(["alpha"]);
    const pending = h.controller.start();
    h.emit({ host: "alpha", step: "upload", percent: 100 });
    let row = h.controller.getSnapshot().rows[0];
    let html = renderToStaticMarkup(createElement(Progress, { row }));
    expect(html).toContain('aria-valuenow="1"');
    expect(html).toContain("上传 100%");
    h.emit({ host: "alpha", step: "start", percent: 100 });
    row = h.controller.getSnapshot().rows[0];
    html = renderToStaticMarkup(createElement(Progress, { row }));
    expect(html).toContain('aria-valuenow="3"');
    expect(html).not.toContain("100%");
    expect(row.state).toBe("running");
    h.resolve([{ host: "alpha", ok: true, version: "1.0.0" }]);
    await pending;
    html = renderToStaticMarkup(createElement(Progress, { row: h.controller.getSnapshot().rows[0] }));
    expect(html).toContain('aria-valuenow="5"');
  });

  test("忽略其他主机与迟到阶段，失败保留实际出错步骤", async () => {
    const h = harness();
    h.controller.open(["alpha"]);
    const pending = h.controller.start();
    h.emit({ host: "other", step: "done" });
    expect(h.controller.getSnapshot().rows[0].state).toBe("pending");
    h.emit({ host: "alpha", step: "verify", text: "验证版本" });
    h.emit({ host: "alpha", step: "upload", percent: 10 });
    h.emit({ host: "alpha", step: "error", text: "验证失败，已回滚" });
    h.emit({ host: "alpha", step: "done" });
    h.resolve([{ host: "alpha", ok: false, version: "", error: "验证失败，已回滚" }]);
    await pending;
    const row = h.controller.getSnapshot().rows[0];
    expect(row.step).toBe("verify");
    expect(row.state).toBe("error");
    expect(row.text).toBe("验证失败，已回滚");
    const html = renderToStaticMarkup(createElement(Progress, { row }));
    expect(html).toContain('aria-valuenow="4"');
    expect(html).toContain("border-danger");
  });

  test("批量部分失败不覆盖成功与跳过结果，重试仅提交失败主机", async () => {
    const h = harness();
    h.controller.open(["current", "failed"]);
    const pending = h.controller.start();
    h.emit({ host: "current", step: "done", text: "已是最新 v1.0.0，跳过安装" });
    h.resolve([
      { host: "current", ok: true, version: "1.0.0" },
      { host: "failed", ok: false, version: "", error: "权限不足" },
    ]);
    await pending;
    const rows = h.controller.getSnapshot().rows;
    expect(rows[0].text).toContain("跳过安装");
    expect(rows[1].text).toBe("权限不足");
    h.controller.open(rows.filter(row => row.state === "error").map(row => row.host));
    const retry = h.controller.start();
    expect(h.calls).toEqual([["current", "failed"], ["failed"]]);
    h.resolve([{ host: "failed", ok: true, version: "1.0.0" }]);
    await retry;
    expect(h.controller.getSnapshot().rows[0].state).toBe("done");
    expect(h.releases()).toBe(2);
  });

  test("请求失败保留已完成结果，释放监听并允许重新确认", async () => {
    const h = harness();
    h.controller.open(["finished", "pending"]);
    const pending = h.controller.start();
    h.emit({ host: "finished", step: "done", text: "安装完成" });
    h.reject(new Error("连接中断"));
    await pending;
    expect(h.controller.getSnapshot().rows.map(row => row.state)).toEqual(["done", "error"]);
    expect(h.releases()).toBe(1);
    h.controller.open(["pending"]);
    expect(h.controller.getSnapshot().phase).toBe("confirm");
  });

  test("丢失进度事件仍以最终结果收尾；缺失结果不能伪装成功", async () => {
    const h = harness();
    h.controller.open(["finished", "missing"]);
    const pending = h.controller.start();
    h.resolve([{ host: "finished", ok: true, version: "1.0.0" }]);
    await pending;
    expect(h.controller.getSnapshot().rows.map(row => row.state)).toEqual(["done", "error"]);
    expect(h.controller.getSnapshot().rows[1].text).toContain("检查 Agent 状态");
  });
});
