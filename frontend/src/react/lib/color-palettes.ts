export type ColorPaletteId = "classic" | "mist-blue" | "celadon" | "pistachio" | "almond" | "strawberry" | "lavender" | "rose-mauve" | "muted-pastel" | "candy" | "twilight";
export type PaletteMode = "light" | "dark";
export type ColorTokens = Record<`--${string}`, string>;

type PaletteBase = {
  rail: string; canvas: string; surface: string; accent: string; ink: string; muted: string;
  selection?: string;
  ok: string; warn: string; danger: string; read: string; write: string;
};

function rgb(hex: string): number[] {
  return [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16));
}

function mix(background: string, foreground: string, amount: number): string {
  const front = rgb(foreground);
  return `#${rgb(background).map((value, index) => Math.round(value + (front[index] - value) * amount).toString(16).padStart(2, "0")).join("")}`;
}

function luminance(hex: string): number {
  const channels = rgb(hex).map((value) => {
    const channel = value / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

export function contrastRatio(first: string, second: string): number {
  const a = luminance(first);
  const b = luminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** 在同一色相方向上加深或提亮，最终输出明确的十六进制色值，兼容旧 WebKit。 */
function readable(color: string, backgrounds: string[], ratio: number, ink: string): string {
  for (let step = 0; step <= 100; step++) {
    const candidate = mix(color, ink, step / 100);
    if (backgrounds.every((background) => contrastRatio(candidate, background) >= ratio)) return candidate;
  }
  return ink;
}

function foreground(backgrounds: string[]): string {
  const minimum = (color: string) => Math.min(...backgrounds.map((background) => contrastRatio(color, background)));
  return minimum("#ffffff") >= minimum("#15151a") ? "#ffffff" : "#15151a";
}

function tokens(base: PaletteBase, mode: PaletteMode): ColorTokens {
  const isDark = mode === "dark";
  const raised = mix(base.surface, base.ink, isDark ? 0.045 : 0.035);
  const line = mix(base.surface, base.ink, isDark ? 0.14 : 0.12);
  const surfaces = [base.rail, base.canvas, base.surface, raised];
  const soft = (color: string) => mix(base.surface, color, isDark ? 0.16 : 0.1);
  const accentSoft = base.selection ?? soft(base.accent);
  const accent = readable(base.accent, [...surfaces, accentSoft], 4.5, base.ink);
  const accentHover = mix(accent, isDark ? "#ffffff" : "#15151a", 0.09);
  const accentActive = mix(accent, isDark ? "#ffffff" : "#15151a", 0.17);
  const successSoft = soft(base.ok);
  const warnSoft = soft(base.warn);
  const dangerSoft = soft(base.danger);
  const infoSoft = soft(base.read);
  const graphicSurfaces = [base.surface, raised, line];
  const ok = readable(base.ok, graphicSurfaces, 3, base.ink);
  const meterWarn = readable(base.warn, graphicSurfaces, 3, base.ink);
  const danger = readable(base.danger, [...surfaces, dangerSoft], 4.5, base.ink);
  const read = readable(base.read, graphicSurfaces, 3, base.ink);
  const write = readable(base.write, graphicSurfaces, 3, base.ink);
  return {
    "--color-rail": base.rail, "--color-canvas": base.canvas, "--color-surface": base.surface,
    "--color-raised": raised, "--color-line": line,
    "--color-line-strong": readable(mix(base.surface, base.ink, 0.4), surfaces, 3, base.ink),
    "--color-ink": base.ink,
    "--color-muted": readable(base.muted, [...surfaces, accentSoft], 4.5, base.ink),
    "--color-accent": accent, "--color-accent-hover": accentHover, "--color-accent-active": accentActive,
    "--color-on-accent": foreground([accent, accentHover, accentActive]),
    "--color-accent-soft": accentSoft, "--color-accent-tint": mix(base.surface, accent, 0.045),
    "--color-accent-focus": accent, "--color-selection": base.selection ?? soft(accent),
    "--color-accent-veil": `rgba(${rgb(accent).join(", ")}, ${isDark ? 0.18 : 0.1})`,
    "--color-line-veil": `rgba(${rgb(base.ink).join(", ")}, 0.08)`,
    "--color-success": ok, "--color-success-text": readable(base.ok, [...surfaces, successSoft], 4.5, base.ink),
    "--color-warn": readable(base.warn, [...surfaces, warnSoft], 4.5, base.ink),
    "--color-danger": danger, "--color-on-danger": foreground([danger]),
    "--color-info": readable(base.read, [...surfaces, infoSoft], 4.5, base.ink),
    "--color-success-soft": successSoft, "--color-warn-soft": warnSoft,
    "--color-danger-soft": dangerSoft, "--color-info-soft": infoSoft,
    "--color-tooltip": base.ink, "--color-tooltip-text": base.surface,
    "--color-chart-1": accent, "--color-chart-2": read, "--color-chart-3": write,
    "--color-io-read": read, "--color-io-write": write,
    "--meter-ok": ok, "--meter-warn": meterWarn,
    "--meter-danger": readable(base.danger, graphicSurfaces, 3, base.ink), "--meter-off": line,
  };
}

type PaletteDefinition = { id: ColorPaletteId; name: string; description: string; light: PaletteBase; dark: PaletteBase };

const definitions: PaletteDefinition[] = [
  {
    id: "classic", name: "默认配色", description: "中性灰 · 品牌蓝",
    light: { rail: "#eaebee", canvas: "#f2f3f5", surface: "#ffffff", accent: "#0052d9", ink: "#1f2937", muted: "#636a76", ok: "#2ba471", warn: "#d35a00", danger: "#d54941", read: "#1d8cf8", write: "#d78322" },
    dark: { rail: "#0d1017", canvas: "#12161f", surface: "#1a1f2b", accent: "#4c8dff", ink: "#e6ebf3", muted: "#94a1b5", ok: "#56c08d", warn: "#f29a4a", danger: "#f06c63", read: "#4fb0ff", write: "#f29a4a" },
  },
  // 用户确认的 peiseka 预览角色色；语义状态仍沿用健康绿、告警橙、危险红。
  {
    id: "mist-blue", name: "雾蓝", description: "蓝色控 · No.1311",
    light: { rail: "#d1defb", canvas: "#ebf2ff", surface: "#fcfdff", accent: "#54627e", ink: "#313846", muted: "#5c626d", selection: "#d2dffc", ok: "#2ba471", warn: "#d35a00", danger: "#d54941", read: "#1d8cf8", write: "#d78322" },
    dark: { rail: "#1e242f", canvas: "#2a2f37", surface: "#323841", accent: "#a2befa", ink: "#e9ecf2", muted: "#b6becb", selection: "#454d5c", ok: "#56c08d", warn: "#f29a4a", danger: "#f06c63", read: "#4fb0ff", write: "#f29a4a" },
  },
  {
    id: "celadon", name: "青瓷", description: "配色导航 No.7",
    light: { rail: "#b4e7ed", canvas: "#d8f5f8", surface: "#f5fefe", accent: "#41676d", ink: "#2b3940", muted: "#596369", selection: "#cdecee", ok: "#2ba471", warn: "#d35a00", danger: "#d54941", read: "#1d8cf8", write: "#d78322" },
    dark: { rail: "#1a242b", canvas: "#282f37", surface: "#323841", accent: "#71c9ce", ink: "#e9ecf2", muted: "#afb8c6", selection: "#364c54", ok: "#56c08d", warn: "#f29a4a", danger: "#f06c63", read: "#4fb0ff", write: "#f29a4a" },
  },
  {
    id: "pistachio", name: "开心果", description: "思绪.色彩 · No.2455",
    light: { rail: "#cddcbd", canvas: "#f3f5ec", surface: "#f9fcfc", accent: "#4f6067", ink: "#303940", muted: "#585f64", selection: "#c0ded4", ok: "#2ba471", warn: "#d35a00", danger: "#d54941", read: "#1d8cf8", write: "#d78322" },
    dark: { rail: "#1d242b", canvas: "#2a2f36", surface: "#323841", accent: "#9ec6cc", ink: "#e9ecf2", muted: "#b2bbc8", selection: "#404d50", ok: "#56c08d", warn: "#f29a4a", danger: "#f06c63", read: "#4fb0ff", write: "#f29a4a" },
  },
  {
    id: "almond", name: "杏仁奶油", description: "配色导航 No.252",
    light: { rail: "#fbd8c7", canvas: "#f8f5e6", surface: "#fdfdf9", accent: "#6f5f5a", ink: "#3c393c", muted: "#656265", selection: "#e2ecdb", ok: "#2ba471", warn: "#d35a00", danger: "#d54941", read: "#1d8cf8", write: "#d78322" },
    dark: { rail: "#242429", canvas: "#2b2f35", surface: "#323841", accent: "#f9c4aa", ink: "#e9ecf2", muted: "#bac2ce", selection: "#4b5151", ok: "#56c08d", warn: "#f29a4a", danger: "#f06c63", read: "#4fb0ff", write: "#f29a4a" },
  },
  {
    id: "strawberry", name: "草莓奶霜", description: "配色导航 No.72",
    light: { rail: "#c2e6fd", canvas: "#fff6f6", surface: "#fffdfd", accent: "#865761", ink: "#3c323a", muted: "#6a6268", selection: "#ffe3e3", ok: "#2ba471", warn: "#d35a00", danger: "#d54941", read: "#1d8cf8", write: "#d78322" },
    dark: { rail: "#242028", canvas: "#2b2f37", surface: "#323841", accent: "#fcafb8", ink: "#e9ecf2", muted: "#bdc4cf", selection: "#535057", ok: "#56c08d", warn: "#f29a4a", danger: "#f06c63", read: "#4fb0ff", write: "#f29a4a" },
  },
  {
    id: "lavender", name: "薰衣草", description: "配色导航 No.19",
    light: { rail: "#d2cef4", canvas: "#ebfdfb", surface: "#fafffe", accent: "#605572", ink: "#363544", muted: "#595965", selection: "#d7e6fd", ok: "#2ba471", warn: "#d35a00", danger: "#d54941", read: "#1d8cf8", write: "#d78322" },
    dark: { rail: "#21222d", canvas: "#2a3037", surface: "#323841", accent: "#d5b7ed", ink: "#e9ecf2", muted: "#bbc3ce", selection: "#48515c", ok: "#56c08d", warn: "#f29a4a", danger: "#f06c63", read: "#4fb0ff", write: "#f29a4a" },
  },
  {
    id: "rose-mauve", name: "玫瑰灰紫", description: "柔软的毛毯 · No.1676",
    light: { rail: "#e3e7f8", canvas: "#fcf0ef", surface: "#fefcfc", accent: "#6b647f", ink: "#343541", muted: "#666770", selection: "#ffdfe2", ok: "#2ba471", warn: "#d35a00", danger: "#d54941", read: "#1d8cf8", write: "#d78322" },
    dark: { rail: "#1f222c", canvas: "#2b2f36", surface: "#323841", accent: "#c9bbdf", ink: "#e9ecf2", muted: "#bac2ce", selection: "#534e54", ok: "#56c08d", warn: "#f29a4a", danger: "#f06c63", read: "#4fb0ff", write: "#f29a4a" },
  },
  {
    id: "muted-pastel", name: "灰调粉彩", description: "万籁俱寂 · No.1888",
    light: { rail: "#e3d7e2", canvas: "#f7f7ee", surface: "#fdfdfb", accent: "#645e69", ink: "#373840", muted: "#5f6066", selection: "#d4e6e6", ok: "#2ba471", warn: "#d35a00", danger: "#d54941", read: "#1d8cf8", write: "#d78322" },
    dark: { rail: "#21232b", canvas: "#2b2f36", surface: "#323841", accent: "#d1bcce", ink: "#e9ecf2", muted: "#b8c0cc", selection: "#474f55", ok: "#56c08d", warn: "#f29a4a", danger: "#f06c63", read: "#4fb0ff", write: "#f29a4a" },
  },
  {
    id: "candy", name: "糖果什锦", description: "糖果的味道 · No.1959",
    light: { rail: "#cfebfd", canvas: "#f0fcf3", surface: "#fffdfc", accent: "#6b6574", ink: "#3b3c46", muted: "#66676f", selection: "#f5e1f9", ok: "#2ba471", warn: "#d35a00", danger: "#d54941", read: "#1d8cf8", write: "#d78322" },
    dark: { rail: "#24262e", canvas: "#2a3036", surface: "#323841", accent: "#f2daf7", ink: "#e9ecf2", muted: "#bdc4cf", selection: "#50505b", ok: "#56c08d", warn: "#f29a4a", danger: "#f06c63", read: "#4fb0ff", write: "#f29a4a" },
  },
  {
    id: "twilight", name: "暮蓝撞色", description: "小清新 · No.1328",
    light: { rail: "#e1e1e1", canvas: "#f2f4f7", surface: "#fdfefe", accent: "#546486", ink: "#292f3a", muted: "#60646d", selection: "#cbeed7", ok: "#2ba471", warn: "#d35a00", danger: "#d54941", read: "#1d8cf8", write: "#d78322" },
    dark: { rail: "#191e28", canvas: "#2a2f37", surface: "#323841", accent: "#b2bbcf", ink: "#e9ecf2", muted: "#b4bcc9", selection: "#3d4f4c", ok: "#56c08d", warn: "#f29a4a", danger: "#f06c63", read: "#4fb0ff", write: "#f29a4a" },
  },
];

export const COLOR_PALETTES = definitions.map((definition) => ({
  id: definition.id, name: definition.name, description: definition.description,
  light: tokens(definition.light, "light"), dark: tokens(definition.dark, "dark"),
}));

const LEGACY_PALETTES = new Map<string, ColorPaletteId>([
  ["sea-salt", "mist-blue"], ["glacier", "celadon"], ["morandi", "pistachio"],
  ["latte", "almond"], ["rose", "strawberry"], ["macaron", "lavender"],
  ["iris", "almond"], ["graphite", "rose-mauve"],
]);

export function parseColorPalette(value: unknown): ColorPaletteId {
  const id = typeof value === "string" ? LEGACY_PALETTES.get(value) ?? value : value;
  return COLOR_PALETTES.find((palette) => palette.id === id)?.id ?? "classic";
}

export function paletteTokens(id: ColorPaletteId, mode: PaletteMode): ColorTokens {
  return (COLOR_PALETTES.find((palette) => palette.id === id) ?? COLOR_PALETTES[0])[mode];
}

export function applyColorPalette(root: HTMLElement, id: ColorPaletteId, mode: PaletteMode) {
  for (const [name, value] of Object.entries(paletteTokens(id, mode))) root.style.setProperty(name, value);
  // 应用内看板始终取同一色系的深色版，局部变量覆盖不会污染主窗口。
  for (const [name, value] of Object.entries(paletteTokens(id, "dark"))) root.style.setProperty(`--board-${name.slice(2)}`, value);
  root.dataset.colorPalette = id;
}
