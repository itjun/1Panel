/**
 * 终端会话（desk）分屏布局的暂存与恢复。
 * 场景：切走 desk 会卸载 TerminalView；重挂载必须能按原树接回，
 * 否则分屏退回单窗格、deskHosts 被覆盖成单主机，进而连环新建重复会话。
 */
import { buildSync } from "esbuild";
import { createRequire } from "module";
import { mkdirSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import assert from "assert";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const tmpDir = join(root, "node_modules/.cache/ipannel-tests");
mkdirSync(tmpDir, { recursive: true });

// ---- 浏览器全局桩：localStorage / navigator / window.setTimeout ----
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
globalThis.navigator = { platform: "MacIntel" };
const classList = {
  add() {},
  remove() {},
  contains: () => false,
};
globalThis.document = {
  documentElement: {
    classList,
    setAttribute() {},
    style: { setProperty() {}, removeProperty() {} },
  },
  body: { classList, style: { setProperty() {}, removeProperty() {} } },
  createElement: () => ({ classList, style: {}, setAttribute() {}, appendChild() {} }),
  addEventListener() {},
  removeEventListener() {},
};
const timers = [];
globalThis.window = {
  setTimeout: (fn) => {
    timers.push(fn);
    return timers.length;
  },
  clearTimeout: () => {},
  addEventListener: () => {},
  removeEventListener: () => {},
};
function runPendingTimers() {
  const list = timers.splice(0);
  for (const fn of list) fn();
}

// ---- 模块桩：@/api 与 element-plus 不进 node ----
const apiStub = join(tmpDir, "stub-api.mjs");
writeFileSync(
  apiStub,
  "export const api = new Proxy({}, { get: () => async () => ({}) });\n"
);
const epStub = join(tmpDir, "stub-element-plus.mjs");
writeFileSync(
  epStub,
  [
    "export const ElMessage = { success(){}, error(){}, info(){}, warning(){} };",
    "export const ElMessageBox = { confirm: async () => {}, prompt: async () => ({ value: '' }) };",
    "export const ElNotification = () => {};",
    "",
  ].join("\n")
);

const outfile = join(tmpDir, "appStore.cjs");
buildSync({
  entryPoints: [join(root, "src/stores/app.ts")],
  bundle: true,
  format: "cjs",
  platform: "node",
  outfile,
  logLevel: "silent",
  external: ["pinia", "vue"],
  alias: {
    "@": join(root, "src"),
    "@/api": apiStub,
    "element-plus": epStub,
  },
});

const require = createRequire(import.meta.url);
const { createPinia, setActivePinia } = require("pinia");
const { useAppStore } = require(outfile);

setActivePinia(createPinia());
const app = useAppStore();
app.hosts = [
  { name: "main", hostName: "10.0.0.1", user: "root" },
  { name: "web", hostName: "10.0.0.2", user: "root" },
];

// 建三个终端会话，模拟用户在终端模块里的常规操作
app.connectTerminal("main");
app.connectTerminal("web");
assert.strictEqual(app.terminalDesks.length, 2);
const deskMain = app.terminalDesks[0].id;
const deskWeb = app.terminalDesks[1].id;

// main 上开一个两窗格分屏（main + web）
const splitTree = {
  kind: "split",
  id: "split-1",
  dir: "row",
  ratio: 0.5,
  a: { kind: "leaf", id: "pane-main", host: "main" },
  b: { kind: "leaf", id: "pane-web", host: "web" },
};

// 1) 卸载前立即落盘：重挂载时 consumeWorkspaceLayout 能接回原树
app.persistWorkspaceLayoutNow(deskMain, splitTree, "pane-web");
const restored = app.consumeWorkspaceLayout(deskMain);
assert.ok(restored, "布局应当被暂存供重挂载恢复");
assert.deepStrictEqual(restored.tree, splitTree);
assert.strictEqual(restored.focusedId, "pane-web");
assert.strictEqual(
  app.consumeWorkspaceLayout(deskMain),
  null,
  "暂存只能被消费一次"
);

// 2) 防抖写入同样要暂存（TerminalView 里的 watch 走这条路径）
app.persistWorkspaceLayout(deskMain, splitTree, "pane-main");
runPendingTimers();
const debounced = app.consumeWorkspaceLayout(deskMain);
assert.ok(debounced, "防抖落盘后也应当能恢复");
assert.deepStrictEqual(debounced.tree, splitTree);
assert.strictEqual(debounced.focusedId, "pane-main");

// 3) 多主机树落盘后：desk 升为分屏工作台，hostHasTerminal 覆盖全部主机
const desk = app.terminalDesks.find((d) => d.id === deskMain);
assert.ok(desk.crossHost, "多主机分屏应标记 crossHost");
assert.ok(app.hostHasTerminal("main"));
assert.ok(app.hostHasTerminal("web"), "deskHosts 不能退回只剩一台主机");

// 4) 关闭会话：暂存与持久化一起清掉，不复活
app.closeTerminalDesk(deskWeb, true);
assert.strictEqual(app.consumeWorkspaceLayout(deskWeb), null);
assert.strictEqual(
  app.terminalDesks.some((d) => d.id === deskWeb),
  false
);

// 5) 已不存在的 desk 再落盘：只清理，不产生新暂存
app.persistWorkspaceLayoutNow(deskWeb, splitTree, "pane-main");
assert.strictEqual(app.consumeWorkspaceLayout(deskWeb), null);

console.log("test-term-desk-layout: ok");
