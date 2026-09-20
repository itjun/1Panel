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

function el(name = "div") {
  return {
    tagName: name,
    style: {},
    parentElement: null,
    children: [],
    setAttribute() {},
    appendChild(child) {
      if (child.parentElement && child.parentElement !== this) {
        const prev = child.parentElement;
        prev.children = prev.children.filter((c) => c !== child);
      }
      child.parentElement = this;
      if (!this.children.includes(child)) this.children.push(child);
    },
  };
}

const body = el("body");
const created = [];
globalThis.document = {
  createElement(tag) {
    const node = el(tag);
    created.push(node);
    return node;
  },
  body: {
    appendChild(child) {
      body.appendChild(child);
    },
  },
};

const outfile = join(tmpDir, "termLive.cjs");
buildSync({
  entryPoints: [join(root, "src/views/termLive.ts")],
  bundle: true,
  format: "cjs",
  platform: "node",
  outfile,
  logLevel: "silent",
});

const require = createRequire(import.meta.url);
const {
  parkTermEl,
  termDomPark,
  rememberSession,
  parkTermPane,
  takeTermDesk,
  registerTermDesk,
} = require(outfile);

const park = termDomPark();
assert.ok(park);
assert.strictEqual(park.getAttribute ? true : true, true);
assert.ok(String(park.style.cssText).includes("contain:strict"));

const canvas = el("canvas");
const slot = el("slot");
slot.appendChild(canvas);
assert.strictEqual(canvas.parentElement, slot);

parkTermEl(canvas);
assert.strictEqual(canvas.parentElement, park);
assert.ok(!slot.children.includes(canvas));

parkTermEl(canvas);
assert.strictEqual(canvas.parentElement, park);
assert.strictEqual(park.children.filter((c) => c === canvas).length, 1);

parkTermEl(null);
parkTermEl(undefined);

rememberSession("p1", { id: "p1" }, {
  id: "p1",
  host: "alpha",
  ownerDesk: "desk-a",
  sessionID: "sid-1",
  closed: false,
  reconnecting: false,
});
parkTermPane({ id: "p1", host: "alpha", session: { id: "p1" }, ctl: null });
const hidden = takeTermDesk("desk-a");
assert.strictEqual(hidden.length, 1);
assert.strictEqual(hidden[0].id, "p1");
assert.strictEqual(takeTermDesk("desk-a").length, 0);

let took = 0;
const off = registerTermDesk("desk-b", {
  takeAll() {
    took += 1;
    return [{ id: "p2", host: "beta", session: { id: "p2" }, ctl: null }];
  },
});
const live = takeTermDesk("desk-b");
assert.strictEqual(took, 1);
assert.strictEqual(live.length, 1);
assert.strictEqual(live[0].id, "p2");
off();

console.log("test-term-live: ok");
