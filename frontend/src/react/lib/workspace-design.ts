import { paletteTokens, regionPaletteTokens, type ColorPaletteId, type PaletteMode } from "./color-palettes";
import type { Workspace } from "@/react/state/session";

export type WorkspaceModule = Workspace | "settings";

/** A 使用全局主题；每个模块单独声明 B 的宽度，以及 B/C 的角色色。 */
export const WORKSPACE_DESIGNS = {
  remote: { title: "主机", sidebarWidth: 200 },
  local: { title: "本机", sidebarWidth: 184 },
  config: { title: "配置", sidebarWidth: 200 },
  notify: { title: "通知中心", sidebarWidth: 200 },
  speedtest: { title: "测速", sidebarWidth: 184 },
  inspect: { title: "巡检", sidebarWidth: 164 },
  settings: { title: "设置", sidebarWidth: 184 },
} satisfies Record<WorkspaceModule, { title: string; sidebarWidth: number }>;

const regionColors = {
  inspect: {
    light: { canvas: "#e9f2eb", selection: "#ccdfd0", surface: "#fbfdfb", accent: "#386247" },
    dark: { canvas: "#293a32", selection: "#40584a", surface: "#252d29", accent: "#aed0b8" },
  },
  settings: {
    light: { canvas: "#f0edf8", selection: "#ddd5ee", surface: "#fdfcfe", accent: "#67547b" },
    dark: { canvas: "#35313f", selection: "#51475e", surface: "#2b2830", accent: "#cdb9e2" },
  },
};

export function workspaceRegionTokens(module: WorkspaceModule, palette: ColorPaletteId, mode: PaletteMode) {
  // 默认配色保持中性；马卡龙主题下，巡检与设置使用已确认的模块配色。
  const overrides: Parameters<typeof regionPaletteTokens>[2] = palette !== "classic" && (module === "inspect" || module === "settings")
    ? regionColors[module][mode] : {};
  const base = paletteTokens(palette, mode);
  return {
    sidebar: regionPaletteTokens(palette, mode, overrides),
    content: regionPaletteTokens(palette, mode, { ...overrides, canvas: overrides.surface ?? base["--color-surface"] }),
  };
}
