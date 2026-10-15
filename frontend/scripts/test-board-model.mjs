import assert from "node:assert/strict";
import {
  boardHealthOf,
  buildBoardAppSubItems,
  summarizeBoardCards,
} from "../src/utils/boardModel.ts";

const now = Date.now();

function instance(service, pid, overrides = {}) {
  return { service, pid, processUp: true, healthUp: true, status: "UP", ingressOn: false, ingressUp: false, ...overrides };
}

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
  [instance("sapi-agent", 1), instance("oss", 2), instance("oss", 3), instance("im", 4)],
  true,
);
assert.deepEqual(
  ordered?.map((item) => item.name),
  ["im", "oss", "sapi-agent"],
  "订阅服务应该使用看板统一顺序",
);
assert.equal(ordered?.every((item) => item.status === "healthy"), true);

const unknown = buildBoardAppSubItems(["oss"], [], false);
assert.equal(unknown?.[0].status, "unknown", "首轮探活不能把缺失计数当成 0");
assert.equal(unknown?.[0].count, 0);

const critical = buildBoardAppSubItems(["oss"], [], true);
assert.equal(critical?.[0].status, "critical", "已确认的零实例必须是严重状态");
assert.equal(buildBoardAppSubItems(null, [], true), null);

// Agent 对没有进程的服务仍返回一条 DOWN 占位，不能计成 1 或判为健康。
const offlineRow = instance("oss", 0, { processUp: false, healthUp: false, status: "DOWN" });
assert.deepEqual(buildBoardAppSubItems(["oss"], [offlineRow], true), [
  { name: "oss", count: 0, status: "critical" },
]);
const liveRows = [instance("oss", 101), instance("oss", 102)];
assert.deepEqual(buildBoardAppSubItems(["oss"], [...liveRows, liveRows[0], offlineRow], true), [
  { name: "oss", count: 2, status: "healthy" },
], "只按实际进程计数，同一 PID 不重复，离线占位不计数");
assert.deepEqual(buildBoardAppSubItems(["oss"], [
  instance("oss", 0), instance("oss", -1), instance("oss", 1.5),
  instance("oss", 101, { processUp: false }), instance("oss", 102, { status: "DOWN" }),
], true), [{ name: "oss", count: 0, status: "critical" }]);
assert.deepEqual(buildBoardAppSubItems(["oss"], [
  liveRows[0], instance("oss", 102, { healthUp: false, status: "UNHEALTHY" }),
], true), [{ name: "oss", count: 2, status: "critical" }], "运行但探活异常的进程仍计数，状态不能显示正常");
assert.equal(buildBoardAppSubItems(["oss"], [instance("oss", 101, { ingressOn: true })], true)[0].status, "critical");
assert.deepEqual(buildBoardAppSubItems(["oss"], liveRows, false), [
  { name: "oss", count: 2, status: "unknown" },
], "请求失败时缓存只能作为未知数据，不能继续判正常");

const offlineCard = {
  loading: false, overview: overview(), updatedAt: now,
  appSubItems: buildBoardAppSubItems(["oss"], [offlineRow], true),
};
assert.equal(boardHealthOf(offlineCard, now), "critical", "资源正常也不能掩盖应用离线");
const offlineSummary = summarizeBoardCards({ host: offlineCard }, now);
assert.equal(offlineSummary.appHealthy, 0);
assert.equal(offlineSummary.appCritical, 1);
assert.equal(offlineSummary.criticalHosts, 1);

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
