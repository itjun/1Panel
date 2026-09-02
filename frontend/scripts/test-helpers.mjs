/**
 * 对 shipped 纯函数做冒烟单测（直接读编译后的逻辑：用 node 解析 TS 不现实时，
 * 改为动态 import vite-node 不可用则内嵌读源并 eval 不允许 —— 这里用 esbuild-register 的替代：
 * 用简单 re-export 的 .mjs 包装器调用 TS 编译产物。
 *
 * 实际：用 Node 直接加载同逻辑的 TS 源文件经 esbuild sync transform。
 */
import { createRequire } from "module";
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { transformSync } from "esbuild";
import assert from "assert";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const src = join(root, "src/utils/format.ts");
const code = readFileSync(src, "utf8");
const out = transformSync(code, {
  loader: "ts",
  format: "cjs",
  target: "node18",
}).code;

const tmpDir = join(root, "node_modules/.cache/ipannel-tests");
mkdirSync(tmpDir, { recursive: true });
const tmpFile = join(tmpDir, "format.cjs");
writeFileSync(tmpFile, out);

const require = createRequire(import.meta.url);
const mod = require(tmpFile);

const {
  modeToOctal,
  breadcrumbParts,
  breadcrumbPath,
  parentDir,
  formatBytes,
  pickByteScale,
  formatScaledBytes,
  formatDuration,
  detectLineEnding,
  detectTextEncoding,
  splitTextLines,
} = mod;

// modeToOctal
assert.strictEqual(modeToOctal("drwxr-xr-x"), "0755");
assert.strictEqual(modeToOctal("-rw-r--r--"), "0644");
assert.strictEqual(modeToOctal("-rwxr-xr-x"), "0755");
assert.strictEqual(modeToOctal(""), "");

// breadcrumb
assert.deepStrictEqual(breadcrumbParts("/"), ["/"]);
assert.deepStrictEqual(breadcrumbParts("/home/debian"), ["/", "home", "debian"]);
assert.strictEqual(breadcrumbPath(["/", "home", "debian"], 0), "/");
assert.strictEqual(breadcrumbPath(["/", "home", "debian"], 2), "/home/debian");

// parentDir
assert.strictEqual(parentDir("/"), "/");
assert.strictEqual(parentDir("/home"), "/");
assert.strictEqual(parentDir("/home/debian"), "/home");

// formatBytes / duration
assert.strictEqual(formatBytes(0), "0 B");
assert.match(formatBytes(1024), /KB/);
assert.strictEqual(formatDuration(30), "30s");
assert.match(formatDuration(120), /m/);

// pickByteScale：Y 轴按最大值自动换单位（截图堆 ~1.8e9 → GB）
assert.deepStrictEqual(pickByteScale(0), { unit: "B", divisor: 1 });
assert.deepStrictEqual(pickByteScale(500), { unit: "B", divisor: 1 });
assert.strictEqual(pickByteScale(1024).unit, "KB");
assert.strictEqual(pickByteScale(1024 * 512).unit, "KB");
assert.strictEqual(pickByteScale(1024 * 1024).unit, "MB");
assert.strictEqual(pickByteScale(500 * 1024 * 1024).unit, "MB");
assert.strictEqual(pickByteScale(1.8e9).unit, "GB");
assert.strictEqual(pickByteScale(12e9).unit, "GB");
assert.strictEqual(pickByteScale(1024 ** 4).unit, "TB");
assert.strictEqual(formatScaledBytes(0, 1024 ** 3), "0");
assert.strictEqual(formatScaledBytes(1.8e9, 1024 ** 3), "1.7");
assert.strictEqual(formatScaledBytes(12e9, 1024 ** 3), "11.2");
assert.strictEqual(formatScaledBytes(512 * 1024, 1024), "512");

// line ending / encoding / split
assert.strictEqual(detectLineEnding("a\nb\nc"), "LF");
assert.strictEqual(detectLineEnding("a\r\nb\r\nc"), "CRLF");
assert.strictEqual(detectLineEnding("a\rb\rc"), "CR");
assert.strictEqual(detectLineEnding("a\r\nb\nc"), "Mixed");
assert.strictEqual(detectLineEnding(""), "—");
assert.strictEqual(detectTextEncoding("hello"), "UTF-8");
assert.strictEqual(detectTextEncoding("\uFEFFhello"), "UTF-8 BOM");
assert.deepStrictEqual(splitTextLines("a\nb"), ["a", "b"]);
assert.deepStrictEqual(splitTextLines("a\r\nb\r\n"), ["a", "b", ""]);

console.log("OK: format helpers unit tests passed");
