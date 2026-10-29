import { describe, expect, test } from "bun:test";
import type { agentcli } from "../src/api";
import { agentRepairFor, checkAgentFleet } from "../src/utils/agentFleetCheck";
import { AgentInstallController, type AgentRepairTarget } from "../src/utils/agentInstall";

const report = (binaryState: string, agentVersion = ""): agentcli.CheckReport => ({
  ok: false, summary: "", items: [], binaryState, agentVersion,
});

describe("Agent 批量检查与修复", () => {
  test("缺失或版本不一致时建议处理", () => {
    expect(agentRepairFor(report("missing"), "0.2.53")).toBe("install");
    expect(agentRepairFor(report("installed", "v0.2.9"), "0.2.53")).toBe("upgrade");
    for (const data of [report("unknown", "0.2.1"), report("installed", ""), report("installed", "0.2.53")]) {
      expect(agentRepairFor(data, "0.2.53")).toBe("none");
    }
    expect(agentRepairFor(report("installed", "0.2.1"), "")).toBe("none");
  });

  test("版本不一致或服务未运行时也能立即处理", () => {
    expect(agentRepairFor(report("installed", "0.3.0"), "0.2.53")).toBe("upgrade");
    expect(agentRepairFor({ ...report("installed"), items: [{ key: "service", name: "服务", ok: false, detail: "inactive" }] }, "0.2.53")).toBe("upgrade");
  });

  test("最多五台并发，取消后不启动后续检查或回填结果", async () => {
    const pending: Array<() => void> = [];
    const started: string[] = [];
    const results: string[] = [];
    let cancelled = false;
    const run = checkAgentFleet(["a", "b", "c", "d", "e", "f"], host => {
      started.push(host);
      return new Promise(resolve => pending.push(() => resolve(report("missing"))));
    }, host => results.push(host), () => cancelled);
    expect(started).toEqual(["a", "b", "c", "d", "e"]);
    cancelled = true;
    pending.forEach(resolve => resolve());
    await run;
    expect(started).toHaveLength(5);
    expect(results).toHaveLength(0);
  });

  test("批量修复重复提交只请求一次，重试保留修复类型", async () => {
    const calls: AgentRepairTarget[][] = [];
    let resolve!: (rows: { host: string; ok: boolean; version: string; error?: string }[]) => void;
    const controller = new AgentInstallController({
      install: async () => { throw new Error("不能走普通安装"); },
      repair: targets => { calls.push(targets); return new Promise(done => { resolve = done; }); },
      onProgress: () => () => {},
    });
    const pending = controller.startRepair([{ host: "a", action: "install" }, { host: "b", action: "upgrade" }]);
    await controller.startRepair([{ host: "a", action: "install" }]);
    expect(calls).toHaveLength(1);
    resolve([{ host: "a", ok: true, version: "0.2.53" }, { host: "b", ok: false, version: "", error: "失败" }]);
    await pending;
    controller.retryFailed();
    expect(calls[1]).toEqual([{ host: "b", action: "upgrade" }]);
    resolve([{ host: "b", ok: true, version: "0.2.53" }]);
    await Promise.resolve();
    expect(controller.getSnapshot().phase).toBe("done");
  });
});
