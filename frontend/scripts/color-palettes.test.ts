import { expect, test } from "bun:test";
import { COLOR_PALETTES, contrastRatio, paletteTokens, parseColorPalette } from "../src/react/lib/color-palettes";

test("默认配色与选定的十组马卡龙独立保留", () => {
  expect(COLOR_PALETTES.map((palette) => palette.id)).toEqual(["classic", "mist-blue", "celadon", "pistachio", "almond", "strawberry", "lavender", "rose-mauve", "muted-pastel", "candy", "twilight"]);
  expect(COLOR_PALETTES.map((palette) => palette.name)).toEqual(["默认配色", "雾蓝", "青瓷", "开心果", "杏仁奶油", "草莓奶霜", "薰衣草", "玫瑰灰紫", "灰调粉彩", "糖果什锦", "暮蓝撞色"]);
  for (const value of [undefined, null, "", "unknown", "__proto__", 2]) expect(parseColorPalette(value)).toBe("classic");
  for (const palette of COLOR_PALETTES) expect(parseColorPalette(palette.id)).toBe(palette.id);
  const light = paletteTokens("classic", "light");
  expect([light["--color-rail"], light["--color-canvas"], light["--color-surface"], light["--color-accent"]]).toEqual(["#eaebee", "#f2f3f5", "#ffffff", "#0052d9"]);
  const dark = paletteTokens("classic", "dark");
  expect([dark["--color-rail"], dark["--color-canvas"], dark["--color-surface"]]).toEqual(["#0d1017", "#12161f", "#1a1f2b"]);
});

test("旧配色设置迁移到对应风格，避免丢失已选色系", () => {
  const legacy = { "sea-salt": "mist-blue", glacier: "celadon", morandi: "pistachio", latte: "almond", rose: "strawberry", macaron: "lavender", iris: "almond", graphite: "rose-mauve" };
  for (const [oldId, newId] of Object.entries(legacy)) expect(parseColorPalette(oldId)).toBe(newId);
});

test("应用的主要背景与选中底保留已确认预览色值", () => {
  // 固定来自确认预览的角色色，防止接入通用派生规则后将多色组合改回单色。
  const approved = [["#d1defb", "#ebf2ff", "#fcfdff", "#d2dffc"], ["#b4e7ed", "#d8f5f8", "#f5fefe", "#cdecee"], ["#cddcbd", "#f3f5ec", "#f9fcfc", "#c0ded4"], ["#fbd8c7", "#f8f5e6", "#fdfdf9", "#e2ecdb"], ["#c2e6fd", "#fff6f6", "#fffdfd", "#ffe3e3"], ["#d2cef4", "#ebfdfb", "#fafffe", "#d7e6fd"], ["#e3e7f8", "#fcf0ef", "#fefcfc", "#ffdfe2"], ["#e3d7e2", "#f7f7ee", "#fdfdfb", "#d4e6e6"], ["#cfebfd", "#f0fcf3", "#fffdfc", "#f5e1f9"], ["#e1e1e1", "#f2f4f7", "#fdfefe", "#cbeed7"]];
  const palettes = COLOR_PALETTES.filter(palette => palette.id !== "classic");
  for (const [index, palette] of palettes.entries()) {
    expect([palette.light["--color-rail"], palette.light["--color-canvas"], palette.light["--color-surface"], palette.light["--color-accent-soft"]]).toEqual(approved[index]);
    expect(contrastRatio(palette.light["--color-surface"], palette.dark["--color-surface"])).toBeGreaterThan(10);
  }
});

for (const palette of COLOR_PALETTES) {
  for (const mode of ["light", "dark"] as const) {
    test(`${palette.id} ${mode}: readable text, controls and health graphics`, () => {
      const colors = palette[mode];
      const surfaces = ["--color-rail", "--color-canvas", "--color-surface", "--color-raised"];
      const check = (foreground: string, background: string, minimum: number) => {
        expect(contrastRatio(colors[foreground as `--${string}`], colors[background as `--${string}`]), `${foreground} on ${background}`).toBeGreaterThanOrEqual(minimum);
      };
      for (const surface of surfaces) {
        for (const foreground of ["--color-ink", "--color-muted", "--color-accent", "--color-success-text", "--color-warn", "--color-danger", "--color-info"]) check(foreground, surface, 4.5);
        check("--color-line-strong", surface, 3);
      }
      for (const state of ["", "-hover", "-active"]) check("--color-on-accent", `--color-accent${state}`, 4.5);
      check("--color-on-danger", "--color-danger", 4.5);
      check("--color-accent", "--color-accent-soft", 4.5);
      check("--color-tab-hover-ink", "--color-tab-hover", 4.5);
      // 悬停仅有轻微明度差，不能再跳到另一块高反差的底色。
      expect(contrastRatio(colors["--color-tab-hover"], colors["--color-canvas"])).toBeGreaterThan(1.02);
      expect(contrastRatio(colors["--color-tab-hover"], colors["--color-canvas"])).toBeLessThan(1.3);
      check("--color-success-text", "--color-success-soft", 4.5);
      check("--color-warn", "--color-warn-soft", 4.5);
      check("--color-danger", "--color-danger-soft", 4.5);
      check("--color-info", "--color-info-soft", 4.5);
      check("--color-tooltip-text", "--color-tooltip", 4.5);
      for (const surface of ["--color-surface", "--color-raised", "--meter-off"]) {
        for (const foreground of ["--meter-ok", "--meter-warn", "--meter-danger", "--color-io-read", "--color-io-write"]) check(foreground, surface, 3);
      }
      expect(new Set([colors["--meter-ok"], colors["--meter-warn"], colors["--meter-danger"]]).size).toBe(3);
      expect(Object.values(colors).every((color) => /^#[0-9a-f]{6}$|^rgba\(/.test(color))).toBe(true);
    });
  }
}
