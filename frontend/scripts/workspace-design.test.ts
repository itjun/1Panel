import { expect, test } from "bun:test";
import { COLOR_PALETTES, contrastRatio, paletteTokens } from "../src/react/lib/color-palettes";
import { workspaceRegionTokens } from "../src/react/lib/workspace-design";

test("切换模块只改变 B/C，保留全局 A 区和用户原配色", () => {
  for (const palette of COLOR_PALETTES) {
    for (const mode of ["light", "dark"] as const) {
      const base = { ...paletteTokens(palette.id, mode) };
      const remote = workspaceRegionTokens("remote", palette.id, mode);
      expect(remote.sidebar["--color-canvas"]).toBe(base["--color-canvas"]);
      expect(remote.content["--color-surface"]).toBe(base["--color-surface"]);
      const settings = workspaceRegionTokens("settings", palette.id, mode);
      expect(settings.sidebar["--color-canvas"]).toBe(base["--color-canvas"]);
      expect(settings.sidebar["--color-accent-soft"]).toBe(base["--color-accent-soft"]);
      const inspect = workspaceRegionTokens("inspect", palette.id, mode);
      if (palette.id !== "classic") expect(inspect.sidebar["--color-canvas"]).not.toBe(base["--color-canvas"]);
      else expect(inspect.sidebar["--color-canvas"]).toBe(base["--color-canvas"]);
      for (const region of [settings.sidebar, settings.content, inspect.sidebar, inspect.content]) {
        for (const surface of ["--color-canvas", "--color-surface", "--color-accent-soft"] as const) {
          for (const foreground of ["--color-ink", "--color-muted", "--color-accent"] as const) {
            expect(contrastRatio(region[foreground], region[surface]), `${palette.id} ${mode} ${foreground} ${surface}`).toBeGreaterThanOrEqual(4.5);
          }
        }
        expect(Object.values(region).every(value => !value.includes("NaN"))).toBe(true);
      }
      expect(paletteTokens(palette.id, mode)).toEqual(base);
    }
  }
});
