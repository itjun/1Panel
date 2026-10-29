import { expect, test } from "bun:test";
import { COLOR_PALETTES, contrastRatio, paletteTokens, parseColorPalette } from "../src/react/lib/color-palettes";

test("默认配色、十组马卡龙与八组撞色独立保留", () => {
  expect(COLOR_PALETTES.map((palette) => palette.id)).toEqual(["classic", "mist-blue", "celadon", "pistachio", "almond", "strawberry", "lavender", "rose-mauve", "muted-pastel", "candy", "twilight", "coral-sky", "apricot-sea", "lemon-taro", "apple-milk-tea", "mint-coral", "sea-salt-grape", "wisteria-lemon", "rose-mint"]);
  expect(COLOR_PALETTES.map((palette) => palette.name)).toEqual(["默认配色", "雾蓝", "青瓷", "开心果", "杏仁奶油", "草莓奶霜", "薰衣草", "玫瑰灰紫", "灰调粉彩", "糖果什锦", "暮蓝撞色", "珊瑚晴空", "杏橙海盐", "柠檬紫芋", "青苹奶茶", "薄荷珊瑚", "海盐葡萄", "紫藤奶柠", "玫瑰薄荷"]);
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
  const palettes = COLOR_PALETTES.slice(1, 11);
  for (const [index, palette] of palettes.entries()) {
    expect([palette.light["--color-rail"], palette.light["--color-canvas"], palette.light["--color-surface"], palette.light["--color-accent-soft"]]).toEqual(approved[index]);
    expect(contrastRatio(palette.light["--color-surface"], palette.dark["--color-surface"])).toBeGreaterThan(10);
  }
});

test("八组撞色的浅深色背景与选中底保留确认预览", () => {
  const approved = [
    { id: "coral-sky", light: ["#d1d9f5", "#fff1ed", "#fffefc", "#d2eee3"], dark: ["#202a3c", "#332a31", "#39353e", "#3d5651"] },
    { id: "apricot-sea", light: ["#bce7ea", "#fff2e8", "#fffefa", "#f8e4b5"], dark: ["#1f3036", "#342e2d", "#3d3735", "#5f503a"] },
    { id: "lemon-taro", light: ["#ddd0ed", "#fffce8", "#fffefa", "#f4d9c5"], dark: ["#282437", "#33322c", "#3d3c35", "#5f4d43"] },
    { id: "apple-milk-tea", light: ["#cad5f6", "#eff8eb", "#fcfefa", "#f9e1cc"], dark: ["#202b3c", "#2b3430", "#333d38", "#5f4e44"] },
    { id: "mint-coral", light: ["#f3cec6", "#ebf8f6", "#fbfefd", "#f5e9bc"], dark: ["#34272c", "#273638", "#303f41", "#5a513b"] },
    { id: "sea-salt-grape", light: ["#eee1cb", "#ecf3fe", "#fcfdff", "#e8d5ed"], dark: ["#322c25", "#293443", "#333e4d", "#51465f"] },
    { id: "wisteria-lemon", light: ["#f2eac5", "#f1ecfc", "#fefcff", "#d9e7fb"], dark: ["#302e24", "#302c3d", "#3c3649", "#414f67"] },
    { id: "rose-mint", light: ["#c2e8e4", "#fcedf4", "#fffcfe", "#e8d9f2"], dark: ["#223330", "#342d38", "#403644", "#514561"] },
  ];
  for (const expected of approved) {
    const palette = COLOR_PALETTES.find(palette => palette.id === expected.id)!;
    for (const mode of ["light", "dark"] as const) {
      expect(["--color-rail", "--color-canvas", "--color-surface", "--color-accent-soft"].map(key => palette[mode][key as `--${string}`])).toEqual(expected[mode]);
    }
  }
});

test("所有自选配色的半透明侧栏保留各自色相并能透出原生材质", () => {
  for (const palette of COLOR_PALETTES.slice(1)) {
    for (const mode of ["light", "dark"] as const) {
      const colors = paletteTokens(palette.id, mode);
      for (const name of ["rail", "canvas"] as const) {
        const solid = colors[`--color-${name}`];
        const translucent = colors[`--color-${name}-translucent`];
        const components = translucent.match(/^rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)$/);
        expect(components, `${palette.id} ${mode} ${name}`).not.toBeNull();
        const channels = [1, 3, 5].map((offset) => Number.parseInt(solid.slice(offset, offset + 2), 16));
        expect(components!.slice(1, 4).map(Number)).toEqual(channels);
        const opacity = Number(components![4]);
        expect(opacity).toBeGreaterThan(0.35);
        expect(opacity).toBeLessThan(0.65);
      }
    }
  }
});

for (const palette of COLOR_PALETTES) {
  for (const mode of ["light", "dark"] as const) {
    test(`${palette.id} ${mode}: readable text, controls and health graphics`, () => {
      const colors = palette[mode];
      const surfaces = ["--color-rail", "--color-canvas", "--color-surface", "--color-raised", "--color-card-selected"];
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
      for (const surface of ["--color-surface", "--color-raised", "--color-card-selected", "--meter-off"]) {
        for (const foreground of ["--meter-ok", "--meter-warn", "--meter-danger", "--color-io-read", "--color-io-write"]) check(foreground, surface, 3);
      }
      expect(new Set([colors["--meter-ok"], colors["--meter-warn"], colors["--meter-danger"]]).size).toBe(3);
      expect(Object.values(colors).every((color) => /^#[0-9a-f]{6}$|^rgba\(/.test(color))).toBe(true);
    });
  }
}
