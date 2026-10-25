export type ColorPaletteId = "classic" | "macaron" | "morandi" | "glacier" | "latte" | "rose" | "iris" | "graphite";
export type PaletteMode = "light" | "dark";
export type ColorTokens = Record<`--${string}`, string>;

type PaletteBase = {
  rail: string; canvas: string; surface: string; accent: string; ink: string; muted: string;
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
  const accentSoft = soft(base.accent);
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
    "--color-accent-focus": accent, "--color-selection": soft(accent),
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
    id: "classic", name: "经典蓝灰", description: "中性灰 · 品牌蓝",
    light: { rail: "#eaebee", canvas: "#f2f3f5", surface: "#ffffff", accent: "#0052d9", ink: "#1f2937", muted: "#636a76", ok: "#2ba471", warn: "#d35a00", danger: "#d54941", read: "#1d8cf8", write: "#d78322" },
    dark: { rail: "#0d1017", canvas: "#12161f", surface: "#1a1f2b", accent: "#4c8dff", ink: "#e6ebf3", muted: "#94a1b5", ok: "#56c08d", warn: "#f29a4a", danger: "#f06c63", read: "#4fb0ff", write: "#f29a4a" },
  },
  {
    id: "macaron", name: "清甜马卡龙", description: "浅薰衣草 · 奶白",
    light: { rail: "#e2ddf2", canvas: "#f0edf8", surface: "#fffdff", accent: "#7560b5", ink: "#302b3c", muted: "#686174", ok: "#43856e", warn: "#ad681b", danger: "#c34e60", read: "#5b84bb", write: "#b8783e" },
    dark: { rail: "#201c2c", canvas: "#292435", surface: "#332d40", accent: "#c7b4f0", ink: "#f4eefb", muted: "#b6acc5", ok: "#91cbb5", warn: "#e9b777", danger: "#f197aa", read: "#a7c8f0", write: "#edba92" },
  },
  {
    id: "morandi", name: "雾感莫兰迪", description: "暖石灰 · 雾蓝",
    light: { rail: "#d8d5d0", canvas: "#ece9e4", surface: "#fcfaf7", accent: "#5c7185", ink: "#363833", muted: "#656760", ok: "#557d65", warn: "#a16a2a", danger: "#b65352", read: "#607f9c", write: "#af7a40" },
    dark: { rail: "#232522", canvas: "#2b2d29", surface: "#343732", accent: "#b0c1d0", ink: "#f0eee8", muted: "#babcb3", ok: "#a2c3a8", warn: "#d6b481", danger: "#dea09a", read: "#a4bdd0", write: "#d1b28e" },
  },
  {
    id: "glacier", name: "北欧冰川", description: "冰蓝 · 冷白",
    light: { rail: "#d6e5f0", canvas: "#eaf2f8", surface: "#fbfdff", accent: "#316b9c", ink: "#21394a", muted: "#536c7d", ok: "#2e826d", warn: "#a86c1f", danger: "#c24e52", read: "#347cad", write: "#b47b31" },
    dark: { rail: "#14232e", canvas: "#1b2d39", surface: "#243946", accent: "#98c8ec", ink: "#ecf6fc", muted: "#a4bdcc", ok: "#7bc6af", warn: "#e8bb7d", danger: "#f19999", read: "#8ac7ee", write: "#dfb784" },
  },
  {
    id: "latte", name: "奶油拿铁", description: "燕麦 · 焦糖棕",
    light: { rail: "#e5d8c8", canvas: "#f3ede3", surface: "#fffcf6", accent: "#89613f", ink: "#41362b", muted: "#766555", ok: "#4c805f", warn: "#a46b16", danger: "#b84840", read: "#5d7f9d", write: "#ac7b37" },
    dark: { rail: "#29221b", canvas: "#322a21", surface: "#3d3328", accent: "#dbb58d", ink: "#fbf2e6", muted: "#c7b49d", ok: "#a1c59b", warn: "#e6bd7e", danger: "#eb9f90", read: "#a8c1d6", write: "#d7b586" },
  },
  {
    id: "rose", name: "樱花玫瑰", description: "浅玫瑰粉 · 暖白",
    light: { rail: "#ead6df", canvas: "#f7edf1", surface: "#fffbfd", accent: "#a65075", ink: "#45313d", muted: "#7c606f", ok: "#3f8065", warn: "#a16a22", danger: "#bf3e35", read: "#5a86a5", write: "#aa7836" },
    dark: { rail: "#2b1d26", canvas: "#352630", surface: "#402e3a", accent: "#e6a5c2", ink: "#fceef5", muted: "#c7a9ba", ok: "#91c6ad", warn: "#e5ba80", danger: "#f49884", read: "#a5c5dd", write: "#dcba8e" },
  },
  {
    id: "iris", name: "鸢尾紫", description: "冷紫灰 · 瓷白",
    light: { rail: "#dcddf0", canvas: "#eeeef8", surface: "#fcfcff", accent: "#6551b8", ink: "#2e2c43", muted: "#69657e", ok: "#3f806a", warn: "#a16b20", danger: "#bd4a55", read: "#5680af", write: "#b07a36" },
    dark: { rail: "#1e1d30", canvas: "#27253c", surface: "#302e49", accent: "#bcaafa", ink: "#f0edff", muted: "#b5afd1", ok: "#86c8b0", warn: "#e5b879", danger: "#f095a6", read: "#9bbcf1", write: "#e2b681" },
  },
  {
    id: "graphite", name: "石墨极简", description: "中性灰阶 · 银灰",
    light: { rail: "#dddddf", canvas: "#f0f1f2", surface: "#ffffff", accent: "#454d59", ink: "#24282e", muted: "#636a73", ok: "#3e8066", warn: "#a66c20", danger: "#bf4d4d", read: "#557eaa", write: "#a77d42" },
    dark: { rail: "#17191c", canvas: "#202327", surface: "#292d32", accent: "#c2cad5", ink: "#f0f2f5", muted: "#aeb5bf", ok: "#72be9b", warn: "#e4ad62", danger: "#ee7d7d", read: "#84afda", write: "#ddb378" },
  },
];

export const COLOR_PALETTES = definitions.map((definition) => ({
  id: definition.id, name: definition.name, description: definition.description,
  light: tokens(definition.light, "light"), dark: tokens(definition.dark, "dark"),
}));

export function parseColorPalette(value: unknown): ColorPaletteId {
  return COLOR_PALETTES.find((palette) => palette.id === value)?.id ?? "classic";
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
