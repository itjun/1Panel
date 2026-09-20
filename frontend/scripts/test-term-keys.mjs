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
const outfile = join(tmpDir, "termKeys.cjs");

buildSync({
  entryPoints: [join(root, "src/utils/termKeys.ts")],
  bundle: true,
  format: "cjs",
  platform: "node",
  outfile,
  logLevel: "silent",
});

const require = createRequire(import.meta.url);
const { isTermAppShortcut, ctrlLetter, shouldCloseDeskOnLastPane, TERM_EOF } = require(outfile);

assert.strictEqual(isTermAppShortcut({ metaKey: true, ctrlKey: false }, true), true);
assert.strictEqual(isTermAppShortcut({ metaKey: false, ctrlKey: true }, true), false);
assert.strictEqual(isTermAppShortcut({ metaKey: true, ctrlKey: true }, true), false);
assert.strictEqual(isTermAppShortcut({ metaKey: false, ctrlKey: true, shiftKey: false }, false), false);
assert.strictEqual(isTermAppShortcut({ metaKey: false, ctrlKey: true, shiftKey: true }, false), true);
assert.strictEqual(isTermAppShortcut({ metaKey: true, ctrlKey: false }, false), false);

assert.strictEqual(ctrlLetter({ ctrlKey: true, metaKey: false, altKey: false, shiftKey: false, key: "d" }), "\x04");
assert.strictEqual(ctrlLetter({ ctrlKey: true, metaKey: false, altKey: false, shiftKey: false, key: "c" }), "\x03");
assert.strictEqual(ctrlLetter({ ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, key: "d" }), "");
assert.strictEqual(ctrlLetter({ ctrlKey: true, metaKey: true, altKey: false, shiftKey: false, key: "d" }), "");

assert.strictEqual(TERM_EOF, "\x04");
assert.strictEqual(shouldCloseDeskOnLastPane(1), true);
assert.strictEqual(shouldCloseDeskOnLastPane(0), true);
assert.strictEqual(shouldCloseDeskOnLastPane(2), false);

console.log("test-term-keys: ok");
