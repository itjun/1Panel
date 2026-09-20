import { createRequire } from "module";
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { transformSync } from "esbuild";
import assert from "assert";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const src = join(root, "src/utils/pointerAction.ts");
const code = readFileSync(src, "utf8");
const out = transformSync(code, {
  loader: "ts",
  format: "cjs",
  target: "node18",
}).code;

const tmpDir = join(root, "node_modules/.cache/ipannel-tests");
mkdirSync(tmpDir, { recursive: true });
const tmpFile = join(tmpDir, "pointerAction.cjs");
writeFileSync(tmpFile, out);

const require = createRequire(import.meta.url);
const { pointerAction, clickAction } = require(tmpFile);

let n = 0;
pointerAction({ button: 0 }, () => {
  n += 1;
});
clickAction(() => {
  n += 10;
});
assert.strictEqual(n, 1, "鼠标 click 不应再跑一遍");

pointerAction({ button: 1 }, () => {
  n += 1;
});
assert.strictEqual(n, 1, "非主键 pointerdown 忽略");

await new Promise((r) => setTimeout(r, 20));
clickAction(() => {
  n += 1;
});
assert.strictEqual(n, 2, "键盘 click 仍要执行");

console.log("test-pointer-action ok");
