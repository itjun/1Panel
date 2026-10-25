import { expect, test } from "bun:test";
import { COLOR_PALETTES, contrastRatio, paletteTokens, parseColorPalette } from "../src/react/lib/color-palettes";

test("eight stable palettes preserve the classic fallback", () => {
  expect(COLOR_PALETTES.map((palette) => palette.id)).toEqual(["classic", "macaron", "morandi", "glacier", "latte", "rose", "iris", "graphite"]);
  for (const value of [undefined, null, "", "unknown", "__proto__", 2]) expect(parseColorPalette(value)).toBe("classic");
  expect(parseColorPalette("morandi")).toBe("morandi");
  expect(paletteTokens("macaron", "light")["--color-rail"]).toBe("#e2ddf2");
  expect(paletteTokens("graphite", "dark")["--color-surface"]).toBe("#292d32");
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
