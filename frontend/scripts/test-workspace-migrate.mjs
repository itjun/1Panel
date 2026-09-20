import { buildSync } from "esbuild";
import { createRequire } from "module";
import { mkdirSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import assert from "assert";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const tmpDir = join(root, "node_modules/.cache/ipannel-tests");
mkdirSync(tmpDir, { recursive: true });
const outfile = join(tmpDir, "workspaceMigrate.cjs");

buildSync({
  entryPoints: [join(root, "src/utils/workspaceMigrate.ts")],
  bundle: true,
  format: "cjs",
  platform: "node",
  outfile,
  logLevel: "silent",
});

const require = createRequire(import.meta.url);
const { migrateWorkspaces, isBenchLayout, liftTerminalDesks } = require(outfile);

function leaf(id, host) {
  return { kind: "leaf", id, host };
}

function split(a, b) {
  return {
    kind: "split",
    id: "s",
    dir: "row",
    ratio: 0.5,
    a,
    b,
  };
}

const cross = split(leaf("p1", "web1"), leaf("p2", "web2"));
assert.strictEqual(isBenchLayout({ title: "web1 终端", tree: cross }), true);
assert.strictEqual(isBenchLayout({ title: "Workspace", tree: leaf("p1", "web1") }), true);
assert.strictEqual(isBenchLayout({ title: "工作台", tree: leaf("p1", "web1") }), true);
assert.strictEqual(isBenchLayout({ title: "web1 终端", tree: leaf("p1", "web1") }), false);

const legacy = [
  { id: "info:web1", host: "web1", kind: "info", title: "web1 信息", titleCustom: false },
  { id: "sftp:web1", host: "web1", kind: "sftp", title: "web1 SFTP", titleCustom: false },
  { id: "terminal:web1:1", host: "web1", kind: "terminal", title: "web1 终端", titleCustom: false },
  { id: "terminal:web1:2", host: "web1", kind: "terminal", title: "web1 终端 2", titleCustom: false },
  { id: "terminal:web2:3", host: "web2", kind: "terminal", title: "web2 终端", titleCustom: false },
  { id: "bench-old", host: "web1", kind: "terminal", title: "Workspace", titleCustom: false },
];

const layouts = [
  {
    id: "bench-old",
    title: "Workspace",
    titleCustom: false,
    host: "web1",
    tree: cross,
    focusedId: "p1",
  },
  {
    id: "terminal:web1:1",
    title: "web1 终端",
    titleCustom: true,
    host: "web1",
    tree: leaf("p1", "web1"),
    focusedId: "p1",
  },
];

const migrated = migrateWorkspaces(legacy, layouts, "sftp:web1");
assert.strictEqual(migrated.activeSessionId, "host:web1");
assert.strictEqual(migrated.sessions.length, 3);

const web1 = migrated.sessions.find((s) => s.id === "host:web1");
assert.ok(web1);
assert.strictEqual(web1.role, "host");
assert.strictEqual(web1.tool, "sftp");
assert.deepStrictEqual(
  web1.terminals.map((t) => t.id),
  ["terminal:web1:1", "terminal:web1:2"]
);

const web2 = migrated.sessions.find((s) => s.id === "host:web2");
assert.ok(web2);
assert.strictEqual(web2.tool, "terminal");
assert.strictEqual(web2.terminals.length, 1);

const bench = migrated.sessions.find((s) => s.id === "bench-old");
assert.ok(bench);
assert.strictEqual(bench.role, "bench");
assert.strictEqual(bench.terminals[0].id, "bench-old");
assert.strictEqual(migrated.sessions.filter((s) => s.host === "web1" && s.role === "host").length, 1);

const activeTerm = migrateWorkspaces(legacy, layouts, "terminal:web1:2");
assert.strictEqual(activeTerm.activeSessionId, "host:web1");
assert.strictEqual(activeTerm.sessions.find((s) => s.id === "host:web1").activeTerminalId, "terminal:web1:2");

const fromLayouts = migrateWorkspaces([], layouts, "bench-old");
assert.ok(fromLayouts.sessions.some((s) => s.id === "bench-old" && s.role === "bench"));
assert.ok(fromLayouts.sessions.some((s) => s.id === "host:web1"));

const lifted = liftTerminalDesks(migrated.sessions, migrated.activeSessionId);
const web1Host = lifted.hostSessions.find((s) => s.id === "host:web1");
assert.ok(web1Host);
assert.strictEqual(web1Host.tool, "sftp");
assert.strictEqual(web1Host.terminals.length, 0);
assert.strictEqual(lifted.openedOnTerminal, false);
assert.ok(lifted.desks.find((d) => d.id === "terminal:web1:1" && d.crossHost === false));
assert.ok(lifted.desks.find((d) => d.id === "terminal:web1:2" && d.host === "web1"));
assert.ok(lifted.desks.find((d) => d.id === "bench-old" && d.crossHost === true && d.title === "分屏"));
assert.ok(!lifted.hostSessions.some((s) => s.id === "host:web2"));

const liftedTerm = liftTerminalDesks(activeTerm.sessions, activeTerm.activeSessionId);
assert.strictEqual(liftedTerm.openedOnTerminal, true);
assert.strictEqual(liftedTerm.activeDeskId, "terminal:web1:2");
assert.ok(!liftedTerm.hostSessions.some((s) => s.id === "host:web1"));

console.log("workspace migrate ok");
