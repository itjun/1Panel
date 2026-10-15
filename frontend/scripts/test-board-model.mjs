import assert from "node:assert/strict";
import {
  boardHealthOf,
  buildBoardAppSubItems,
  summarizeBoardCards,
} from "../src/utils/boardModel.ts";

const now = Date.now();

function overview(overrides = {}) {
  return {
    cpuPercent: 12,
    memPercent: 42,
    memUsed: 4 * 1024 * 1024 * 1024,
    memTotal: 16 * 1024 * 1024 * 1024,
    load1: 0.4,
    cpuCount: 8,
    ...overrides,
  };
}

const ordered = buildBoardAppSubItems(
  ["sapi-agent", "oss", "im"],
  { "sapi-agent": 1, oss: 2, im: 3 },
  true,
);
assert.deepEqual(
  ordered?.map((item) => item.name),
  ["im", "oss", "sapi-agent"],
  "订阅服务应该使用看板统一顺序",
);
assert.equal(ordered?.every((item) => item.status === "healthy"), true);

const unknown = buildBoardAppSubItems(["oss"], {}, false);
assert.equal(unknown?.[0].status, "unknown", "首轮探活不能把缺失计数当成 0");
assert.equal(unknown?.[0].count, 0);

const critical = buildBoardAppSubItems(["oss"], { oss: 0 }, true);
assert.equal(critical?.[0].status, "critical", "已确认的零实例必须是严重状态");
assert.equal(buildBoardAppSubItems(null, {}, true), null);

const cards = {
  healthy: {
    loading: false,
    overview: overview(),
    appSubItems: [{ name: "oss", count: 2, status: "healthy" }],
    updatedAt: now,
  },
  attention: {
    loading: false,
    overview: overview(),
    appSubItems: [{ name: "oss", count: 0, status: "unknown" }],
    updatedAt: now,
  },
  critical: {
    loading: false,
    overview: overview({ cpuPercent: 95 }),
    appSubItems: [{ name: "oss", count: 0, status: "critical" }],
    updatedAt: now,
  },
  unknown: { loading: true },
};

assert.equal(boardHealthOf(cards.healthy, now), "healthy");
assert.equal(boardHealthOf(cards.attention, now), "attention");
assert.equal(boardHealthOf(cards.critical, now), "critical");
assert.equal(boardHealthOf(cards.unknown, now), "unknown");

const summary = summarizeBoardCards(cards, now);
assert.deepEqual(
  {
    total: summary.totalHosts,
    healthy: summary.healthyHosts,
    attention: summary.attentionHosts,
    critical: summary.criticalHosts,
    appHealthy: summary.appHealthy,
    appCritical: summary.appCritical,
    appUnknown: summary.appUnknown,
  },
  {
    total: 4,
    healthy: 1,
    attention: 1,
    critical: 1,
    appHealthy: 1,
    appCritical: 1,
    appUnknown: 1,
  },
);

console.log("board-model: ok");
