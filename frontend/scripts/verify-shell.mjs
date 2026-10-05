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
const moduleRail = fs.readFileSync(path.join(root, "src/react/components/module-rail.tsx"), "utf8");
if (!moduleRail.includes('label="主机"') || !app.includes("ModuleRail")) {
  fail("primary module rail must provide host navigation");
}
if (!app.includes("HostToolTabs")) fail("host tool tabs must be rendered in the toolbar");
if (app.includes("workspace-host__header")) {
  fail("host tool tabs are still rendered in the content header");
}
ok("React shell and workspace navigation markers present");

const shellStyles = fs.readFileSync(path.join(root, "src/react/styles/globals.css"), "utf8");
if (shellStyles.includes("--shell-gutter")) fail("collapsed shell gutter should be gone");
if (!shellStyles.includes(".glass-chrome")) fail("shared chrome rule missing");
if (!rail.includes("glass-chrome")) fail("sidebar chrome is missing");
if (shellStyles.includes('data-platform="solid"')) {
  fail("platform solid light-blue / white fork should be removed");
}
if (shellStyles.includes("rgba(255, 255, 255, 0.62)")) {
  fail("frosted/transparent chrome still present on glass-chrome");
}
if (shellStyles.includes("rgba(18, 18, 18, 0.58)")) {
  fail("frosted/transparent dark chrome still present");
}
if (!/background-color:\s*var\(--color-surface\)/.test(shellStyles)) {
  fail("chrome must use --color-surface");
}
if (!/\.glass-chrome-main\s*\{[^}]*var\(--color-surface\)/s.test(shellStyles)) {
  fail("content must retain the opaque surface background in every material mode");
}
if (!/\.content-float\s*\{[^}]*overflow:\s*auto/s.test(shellStyles)) {
  fail("content-float must be a flush scroll region");
}
if (/\.content-float\s*\{[^}]*margin:\s*8px/s.test(shellStyles)) {
  fail("content-float must not be a floating panel with margin");
}
if (/\.content-float\s*\{[^}]*border-radius:/s.test(shellStyles)) {
  fail("content-float must not set border-radius (flush, not floating panel)");
}
if (!shellStyles.includes("--radius-surface: 0px") && !shellStyles.includes("--radius-surface: 0;")) {
  fail("--radius-surface must be 0 (right angles)");
}
if (!/\.rail-item-active\s*\{[^}]*var\(--color-accent-soft\)/s.test(shellStyles)) {
  fail("rail-item-active must use --color-accent-soft");
}
if (
  /html,\s*body,\s*#app,\s*\.react-root\s*\{[^}]*transparent/s.test(shellStyles)
) {
  fail("html/body/#app/.react-root must not be transparent");
}
if (!rail.includes("sidebarWidth") && !rail.includes("useSidebar")) {
  fail("sidebar width is not driven by sidebar state");
}
if (rail.includes("WindowChrome") || rail.includes("rail-traffic")) {
  fail("window chrome must sit on the full-width app toolbar, not the sidebar");
}
if (!app.includes("WindowChrome")) fail("app toolbar does not host window chrome");
if (!app.includes("shell-app-toolbar")) fail("Firefox-style full-width app toolbar missing");
if (!app.includes("SidebarSplitter")) fail("resizable sidebar splitter missing");
if (!app.includes("data-sidebar")) fail("shell does not mark sidebar state");
if (!app.includes("ShellToolbarProvider")) fail("shell toolbar portal provider missing");
const chrome = fs.readFileSync(
  path.join(root, "src/react/components/window-chrome.tsx"),
  "utf8",
);
if (!chrome.includes("后退") || !chrome.includes("前进") || !chrome.includes("收起侧栏")) {
  fail("window chrome is missing back, forward, or sidebar toggle");
}
const sidebarState = fs.readFileSync(path.join(root, "src/react/state/sidebar.tsx"), "utf8");
if (!sidebarState.includes("1pannel-sidebar-open")) fail("sidebar open state is not persisted");
if (!sidebarState.includes("1pannel-sidebar-width")) fail("sidebar width is not persisted");
if (!sidebarState.includes("SIDEBAR_WIDTH_MIN") || !sidebarState.includes("SIDEBAR_WIDTH_MAX")) {
  fail("sidebar width min/max missing");
}
if (shellStyles.includes("acrylic")) fail("acrylic was removed from the material vocabulary (auto / classic / mica)");
if (!shellStyles.includes('html[data-window-material="mica"]')) fail("mica chrome must be gated by the effective native material");
ok("classic / mica chrome with opaque content contract");
ok("sidebar sits below the full-width app toolbar and is resizable");

const entry = fs.readFileSync(path.join(root, "index.html"), "utf8");
if (!entry.includes("/src/react/main.tsx")) fail("index.html does not load React");
if (entry.includes('dataset.platform') || entry.includes('data-platform')) {
  fail("index.html must not set data-platform=solid");
}
if (/background-color:\s*transparent\s*!important/.test(entry)) {
  fail("index.html boot must not use transparent root background");
}
if (!entry.includes("background-color: var(--color-canvas, #f2f3f5)")) {
  fail("index.html boot root should use classic canvas #f2f3f5");
}
ok("index.html loads React with solid boot skeleton");

console.log("VERIFY_SHELL_PASS");
