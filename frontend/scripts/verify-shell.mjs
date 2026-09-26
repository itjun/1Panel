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
if (!app.includes("SessionProvider")) fail("App.tsx missing SessionProvider");
const rail = fs.readFileSync(
  path.join(root, "src/react/components/workspace-rail.tsx"),
  "utf8",
);
if (!rail.includes('label: "主机"')) {
  fail("WorkspaceRail.tsx missing the 主机 navigation item");
}
if (!rail.includes("HOST_TOOLS")) {
  fail("host tool tabs are not rendered in the sidebar");
}
if (app.includes("workspace-host__header")) {
  fail("host tool tabs are still rendered in the content header");
}
ok("React shell and workspace navigation markers present");

const shellStyles = fs.readFileSync(path.join(root, "src/react/styles/globals.css"), "utf8");
if (shellStyles.includes("--shell-gutter")) fail("collapsed shell gutter should be gone");
if (!shellStyles.includes(".glass-chrome")) fail("shared frosted chrome rule missing");
if (!rail.includes("glass-chrome")) fail("sidebar is not frosted chrome");
if (!rail.includes("w-[220px]")) fail("sidebar is not a fixed width");
if (!rail.includes("WindowChrome")) fail("sidebar does not host window chrome");
if (!app.includes("WindowChrome")) fail("collapsed sidebar does not keep window chrome");
if (!app.includes("data-sidebar")) fail("shell does not mark sidebar state");
if (!shellStyles.includes("--window-chrome-inset")) fail("collapsed header inset missing");
const chrome = fs.readFileSync(
  path.join(root, "src/react/components/window-chrome.tsx"),
  "utf8",
);
if (!chrome.includes("后退") || !chrome.includes("前进") || !chrome.includes("收起侧栏")) {
  fail("window chrome is missing back, forward, or sidebar toggle");
}
const sidebarState = fs.readFileSync(path.join(root, "src/react/state/sidebar.tsx"), "utf8");
if (!sidebarState.includes("1pannel-sidebar-open")) fail("sidebar open state is not persisted");
ok("sidebar has a fixed open width and window chrome");

const entry = fs.readFileSync(path.join(root, "index.html"), "utf8");
if (!entry.includes("/src/react/main.tsx")) fail("index.html does not load React");
ok("index.html loads React");

console.log("VERIFY_SHELL_PASS");
