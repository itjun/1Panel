export type PaletteMode = "light" | "dark";
export type ColorTokens = Record<`--${string}`, string>;

// TDesign Web 色阶。每行按浅色、深色排列。同值角色各自保留变量名，供控件、图表和预览使用。
const roles: readonly [string, string, readonly (`--${string}`)[]][] = [
  ["#e7e8eb", "#20232b", ["--color-rail"]],
  ["#f3f3f4", "#272b34", ["--color-sidebar"]],
  ["#eeeeee", "#181818", ["--color-canvas"]],
  ["#ffffff", "#242424", ["--color-surface"]],
  ["#f3f3f3", "#2c2c2c", ["--color-toolbar", "--color-raised", "--color-item-hover"]],
  ["#e8e8e8", "#393939", ["--color-line", "--color-rail-line", "--color-line-veil", "--meter-off", "--color-card-track"]],
  ["#dddddd", "#5e5e5e", ["--color-line-strong"]],
  ["rgba(0, 0, 0, 0.9)", "rgba(255, 255, 255, 0.9)", ["--color-ink", "--color-nav-label", "--color-item-selected-text", "--color-nav-selected-text"]],
  ["rgba(0, 0, 0, 0.6)", "rgba(255, 255, 255, 0.55)", ["--color-muted", "--color-rail-label", "--color-rail-icon", "--color-nav-icon"]],
  ["rgba(0, 0, 0, 0.4)", "rgba(255, 255, 255, 0.35)", ["--color-placeholder"]],
  ["rgba(0, 0, 0, 0.26)", "rgba(255, 255, 255, 0.22)", ["--color-disabled"]],
  ["#f2f3ff", "#1b2f51", ["--color-rail-selected", "--color-nav-selected", "--color-item-selected", "--color-selection", "--color-accent-soft", "--color-accent-tint", "--color-accent-veil", "--color-info-soft"]],
  ["#0052d9", "#4582e6", ["--color-accent", "--color-primary"]],
  ["#366ef4", "#2667d4", ["--color-accent-hover", "--color-primary-hover"]],
  ["#003cab", "#699ef5", ["--color-accent-active", "--color-primary-active", "--color-link"]],
  ["#0052d9", "#699ef5", ["--color-rail-selected-text", "--color-accent-focus", "--color-info", "--color-chart-1"]],
  ["#ffffff", "#181818", ["--color-on-accent"]],
  ["#ffffff", "#ffffff", ["--color-on-accent-hover", "--color-on-danger"]],
  ["#ad352f", "#a03f46", ["--color-danger-fill"]],
  ["#2ba471", "#059465", ["--color-success", "--meter-ok"]],
  ["#006c45", "#46bf96", ["--color-success-text"]],
  ["#e3f9e9", "#193a2a", ["--color-success-soft"]],
  ["#e37318", "#cf6e2d", ["--meter-warn"]],
  ["#954500", "#e8935c", ["--color-warn"]],
  ["#fff1e9", "#4f2a1d", ["--color-warn-soft"]],
  ["#d54941", "#c64751", ["--meter-danger"]],
  ["#ad352f", "#ec888e", ["--color-danger"]],
  ["#fff0ed", "#472324", ["--color-danger-soft"]],
  ["#f2f3ff", "#1b2f51", ["--color-heat-low"]],
  ["#d9e1ff", "#173463", ["--color-heat-mid"]],
  ["#b5c7ff", "#143975", ["--color-heat-high"]],
  ["#0080b0", "#41b8f2", ["--color-io-read", "--color-chart-2", "--color-chart-gc"]],
  ["#008858", "#92dab2", ["--color-io-write", "--color-chart-3"]],
  ["#8e56dd", "#c69cff", ["--color-chart-comparison"]],
  ["#b38500", "#ffd36d", ["--color-category-yellow"]],
  ["#c43695", "#ff79cd", ["--color-category-pink"]],
  ["rgba(0, 0, 0, 0.6)", "rgba(0, 0, 0, 0.4)", ["--color-scrim"]],
  ["#2c2c2c", "#e8e8e8", ["--color-tooltip"]],
  ["#ffffff", "rgba(0, 0, 0, 0.9)", ["--color-tooltip-text"]],
  ["#181818", "#181818", ["--color-graphite"]],
  ["#e8e8e8", "#e8e8e8", ["--color-graphite-text"]],
  ["rgba(231, 232, 235, 0.6)", "rgba(32, 35, 43, 0.72)", ["--color-rail-translucent"]],
  ["#181818", "#e8e8e8", ["--color-shell-muted"]],
  ["#001a57", "#d9e1ff", ["--color-shell-accent"]],
];

const appearanceColors: Record<PaletteMode, ColorTokens> = { light: {}, dark: {} };
for (const [light, dark, names] of roles) {
  for (const name of names) {
    appearanceColors.light[name] = light;
    appearanceColors.dark[name] = dark;
  }
}

export function paletteTokens(mode: PaletteMode): ColorTokens {
  return appearanceColors[mode];
}

export function applyColorPalette(root: HTMLElement, mode: PaletteMode) {
  for (const [name, value] of Object.entries(appearanceColors[mode])) root.style.setProperty(name, value);
}
