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
const layout = fs.readFileSync(path.join(root, "src/react/components/workspace-layout.tsx"), "utf8");
if (!app.includes("SessionProvider")) fail("App.tsx missing SessionProvider");
const rail = fs.readFileSync(
  path.join(root, "src/react/components/workspace-rail.tsx"),
  "utf8",
);
const moduleRail = fs.readFileSync(path.join(root, "src/react/components/module-rail.tsx"), "utf8");
if (!moduleRail.includes('label="主机"') || !layout.includes("ModuleRail")) {
  fail("primary module rail must provide host navigation");
}
if (!moduleRail.includes('label="配置"') || !app.includes("ConfigDataPage")) {
  fail("config workspace must remain available from the primary module rail");
}
if (!layout.includes("HostToolTabs")) fail("host tool tabs must remain available in the host workspace");
const toolbarMarkup = layout.slice(layout.indexOf("<header"), layout.indexOf("</header>"));
if (!toolbarMarkup.includes("<HostToolTabs />") || (layout.match(/<HostToolTabs\s*\/>/g) || []).length !== 1) {
  fail("host tools must appear exactly once in the window toolbar");
}
const hostOps = fs.readFileSync(path.join(root, "src/react/pages/host-ops.tsx"), "utf8");
const overviewPage = hostOps.slice(hostOps.indexOf("function OverviewPage("), hostOps.indexOf("/* ---------- 监控 ---------- */"));
if (app.includes("<HostWorkbenchHeader") ||
    !hostOps.includes('if (tool === "overview") return <OverviewPage host={host} />;') ||
    (hostOps.match(/<HostWorkbenchHeader\b/g) || []).length !== 1 ||
    !overviewPage.includes("<HostWorkbenchHeader host={host}")) {
  fail("host identity header must be limited to overview");
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
const overviewStyles = fs.readFileSync(path.join(root, "src/react/components/overview/device-overview.css"), "utf8");
if (overviewStyles.includes("--color-canvas")) {
  fail("overview must inherit the surface content plane; canvas is reserved for window chrome");
}
ok("overview retains the shared content surface");
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
  fail("sidebar navigation must stay outside the scrollable workspace list");
}
if (layout.includes("WindowChrome") || layout.includes("shell-sidebar-toolbar")) fail("global navigation toolbar must be removed");
if (!/isRemoteHostWorkspace\s*\?\s*\(\s*<header\b/.test(layout)) fail("only remote hosts may show content tool tabs");
if (!layout.includes("SidebarSplitter")) fail("module sidebar widths must remain adjustable");
const chrome = fs.readFileSync(path.join(root, "src/react/components/window-chrome.tsx"), "utf8");
const sidebarState = fs.readFileSync(path.join(root, "src/react/state/sidebar.tsx"), "utf8");
if (/WindowChrome|useNavHistory|useSidebar|Backslash|KeyB/.test(chrome)) fail("removed navigation actions must not remain in the window controls");
if (/matchMedia|closeOverlay|SIDEBAR_OPEN_KEY/.test(sidebarState)) fail("B must stay visible, including narrow windows and old saved collapsed state");
if (!sidebarState.includes("1pannel-sidebar-widths")) fail("sidebar widths must persist per module");
if (!/grid-template-rows:\s*minmax\(0, 1fr\)/.test(shellStyles)) fail("B/C must fill the height without a reserved toolbar row");
if (!layout.includes("regions.sidebar") || !layout.includes("regions.content")) fail("B/C require independently scoped theme tokens");
if (shellStyles.includes("acrylic")) fail("acrylic was removed from the material vocabulary (auto / classic / mica)");
if (!shellStyles.includes('[data-window-material="mica"]')) fail("mica chrome must be gated by the effective native material");
if (!shellStyles.includes('[data-window-material="sidebar"]')) fail("macOS sidebar chrome must be gated by the effective native material");
ok("classic / mica chrome with opaque content contract");
ok("ABC regions are independent; sidebar is always visible and remains resizable");

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
