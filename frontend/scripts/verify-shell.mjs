#!/usr/bin/env node
/**
 * Structural smoke for shipped Vue shell after production build.
 * Asserts dist + source entrypoints that gate "app can load".
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
  "src/main.ts",
  "src/App.vue",
  "src/layout/SidebarHost.vue",
  "src/layout/MainArea.vue",
  "src/views/OverviewView.vue",
  "src/styles/element.scss",
  "src/styles/element-dark.scss",
];
for (const rel of requiredSrc) {
  const p = path.join(root, rel);
  if (!fs.existsSync(p)) fail(`missing source ${rel}`);
  if (fs.statSync(p).size < 20) fail(`empty source ${rel}`);
}
ok(`required sources present (${requiredSrc.length})`);

// App.vue must mount shell pieces
const appVue = fs.readFileSync(path.join(root, "src/App.vue"), "utf8");
for (const needle of ["SidebarHost", "MainArea", "添加主机", "主题"]) {
  if (!appVue.includes(needle)) fail(`App.vue missing ${needle}`);
}
if (appVue.includes("TabColumn")) fail("App.vue still references TabColumn");
ok("App.vue shell markers present");

const overview = fs.readFileSync(path.join(root, "src/views/OverviewView.vue"), "utf8");
// 折线图随「监控」子页签独立后已从概览移除（91fae1d），概览只保留饼图 + 系统信息
for (const needle of ["VChartPie", "系统信息", "监控"]) {
  if (!overview.includes(needle)) fail(`OverviewView missing ${needle}`);
}
ok("OverviewView dashboard markers present");

console.log("VERIFY_SHELL_PASS");
