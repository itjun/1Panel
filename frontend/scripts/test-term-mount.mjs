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
const outfile = join(tmpDir, "termMount.cjs");

buildSync({
  entryPoints: [join(root, "src/views/termMount.ts")],
  bundle: true,
  format: "cjs",
  platform: "node",
  outfile,
  logLevel: "silent",
});

const require = createRequire(import.meta.url);
const {
  paneFace,
  paneFaceLabel,
  terminalInputReady,
  coalesceSlot,
  parentAfterSlotSwap,
  probeUnchanged,
  shouldSettleAttached,
} = require(outfile);

const live = {
  hasLive: true,
  closed: false,
  sessionID: "sid-nginx",
  inputMounted: false,
  slotSized: true,
  probed: true,
};

assert.strictEqual(paneFace(live), "blind");
assert.notStrictEqual(paneFaceLabel(paneFace(live)), "已连接");
assert.strictEqual(
  paneFace({ ...live, inputMounted: true, slotSized: true }),
  "ready"
);
assert.strictEqual(paneFaceLabel("ready"), "已连接");
assert.strictEqual(paneFace({ ...live, closed: true, inputMounted: true }), "down");
assert.strictEqual(paneFace({ ...live, sessionID: "", inputMounted: true }), "connecting");
assert.strictEqual(paneFace({ ...live, probed: false, inputMounted: false }), "connecting");
assert.strictEqual(
  paneFace({ ...live, hasLive: false, sessionID: "", inputMounted: false }),
  "missing"
);

const slotEl = { id: "slot-b" };
assert.strictEqual(coalesceSlot([null, slotEl]), slotEl);
assert.strictEqual(coalesceSlot([slotEl, null]), null);
assert.strictEqual(coalesceSlot([null, slotEl, null, { id: "slot-c" }]).id, "slot-c");

assert.strictEqual(parentAfterSlotSwap(false, "slot-a", "slot-b"), "slot-a");
assert.strictEqual(parentAfterSlotSwap(true, "slot-a", "slot-b"), "slot-b");
assert.strictEqual(parentAfterSlotSwap(true, "slot-a", null), "slot-a");

const sized = {
  isConnected: true,
  clientWidth: 400,
  clientHeight: 200,
  querySelector(sel) {
    if (sel === "textarea.xterm-helper-textarea") return { isConnected: true };
    if (sel === ".xterm-screen") return { isConnected: true, clientWidth: 400, clientHeight: 180 };
    return null;
  },
};
assert.strictEqual(terminalInputReady(sized), true);
assert.strictEqual(
  terminalInputReady({
    ...sized,
    querySelector(sel) {
      if (sel === "textarea.xterm-helper-textarea") return null;
      return sized.querySelector(sel);
    },
  }),
  false
);
assert.strictEqual(
  terminalInputReady({
    ...sized,
    querySelector(sel) {
      if (sel === ".xterm-screen") return { isConnected: true, clientWidth: 0, clientHeight: 0 };
      return sized.querySelector(sel);
    },
  }),
  false
);
assert.strictEqual(terminalInputReady(null), false);

const readyProbe = {
  hasLive: true,
  closed: false,
  sessionID: "sid",
  inputMounted: true,
  slotSized: true,
  probed: true,
};
assert.strictEqual(probeUnchanged(undefined, readyProbe), false);
assert.strictEqual(probeUnchanged(readyProbe, { ...readyProbe }), true);
assert.strictEqual(probeUnchanged(readyProbe, { ...readyProbe, inputMounted: false }), false);
assert.strictEqual(shouldSettleAttached(true, true), false);
assert.strictEqual(shouldSettleAttached(false, true), true);
assert.strictEqual(shouldSettleAttached(false, false), false);

console.log("test-term-mount: ok");
