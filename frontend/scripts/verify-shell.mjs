#!/usr/bin/env node
/**
 * 生产构建后的壳检查：dist 能加载，React 入口还在。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const fail = (m) => {
  console.error("FAIL:", m);
  process.exit(1);
};
const ok = (m) => console.log("OK:", m);

const distIndex = path.join(root, "dist/index.html");
if (!fs.existsSync(distIndex)) fail("dist/index.html missing — run bun run build");
const html = fs.readFileSync(distIndex, "utf8");
if (!html.includes("id=\"app\"") && !html.includes("id='app'")) {
  // vite may inject assets only; check non-empty
  if (html.trim().length < 50) fail("dist/index.html too small");
}
ok(`dist/index.html size=${html.length}`);

const assetsDir = path.join(root, "dist/assets");
if (!fs.existsSync(assetsDir)) fail("dist/assets missing");
const assets = fs.readdirSync(assetsDir);
const hasJs = assets.some((f) => f.endsWith(".js"));
const hasCss = assets.some((f) => f.endsWith(".css"));
if (!hasJs) fail("no .js in dist/assets");
if (!hasCss) fail("no .css in dist/assets");
ok(`assets js=${hasJs} css=${hasCss} count=${assets.length}`);

const requiredSrc = [
  "index.html",
  "src/react/main.tsx",
  "src/react/App.tsx",
  "src/api/index.ts",
];
for (const rel of requiredSrc) {
  const p = path.join(root, rel);
  if (!fs.existsSync(p)) fail(`missing source ${rel}`);
  if (fs.statSync(p).size < 20) fail(`empty source ${rel}`);
}
ok(`required sources present (${requiredSrc.length})`);

const app = fs.readFileSync(path.join(root, "src/react/App.tsx"), "utf8");
for (const needle of ["SessionProvider", "主机"]) {
  if (!app.includes(needle)) fail(`App.tsx missing ${needle}`);
}
ok("React shell markers present");

const entry = fs.readFileSync(path.join(root, "index.html"), "utf8");
if (!entry.includes("/src/react/main.tsx")) fail("index.html does not load React");
ok("index.html loads React");

console.log("VERIFY_SHELL_PASS");
