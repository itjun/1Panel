import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { contrastRatio } from "./color-contrast";
import { paletteTokens } from "../src/react/lib/color-palettes";

const css = readFileSync(new URL("../src/react/styles/globals.css", import.meta.url), "utf8");

test("启动、运行时和独立看板共用 TDesign 角色", () => {
  const light = css.match(/@theme static \{([^}]+)}/)![1];
  const dark = css.match(/html\.dark,\s*html\.board-http,\s*\.board-mode,\s*\.board-dialog \{([^}]+)}/)![1];
  for (const [mode, source] of [["light", light], ["dark", dark]] as const) {
    const definitions = Object.fromEntries(Array.from(source.matchAll(/^  (--[\w-]+): ([^;]+);/gm), match => [match[1], match[2]]));
    expect(definitions).toMatchObject(paletteTokens(mode));
  }
  expect(paletteTokens("light")).toMatchObject({
    "--color-sidebar": "#f3f3f4", "--color-canvas": "#eeeeee", "--color-surface": "#ffffff",
    "--color-primary": "#0052d9", "--color-primary-hover": "#366ef4", "--color-primary-active": "#003cab",
  });
  expect(paletteTokens("dark")).toMatchObject({
    "--color-sidebar": "#272b34", "--color-canvas": "#181818", "--color-surface": "#242424",
    "--color-primary": "#4582e6", "--color-primary-hover": "#2667d4", "--color-primary-active": "#699ef5",
  });
});

test("A 区半透明底色保持可读", () => {
  for (const mode of ["light", "dark"] as const) {
    const colors = paletteTokens(mode);
    const solid = colors["--color-rail"];
    const translucent = colors["--color-rail-translucent"];
    const components = translucent.match(/^rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)$/);
    expect(components, mode).not.toBeNull();
    const channels = [1, 3, 5].map((offset) => Number.parseInt(solid.slice(offset, offset + 2), 16));
    expect(components!.slice(1, 4).map(Number)).toEqual(channels);
    const opacity = Number(components![4]);
    expect(opacity).toBeLessThanOrEqual(0.75);
    for (const backdrop of [0, 128, 255]) {
      const blended = channels.map((channel) => Math.round(channel * opacity + backdrop * (1 - opacity)));
      const background = `#${blended.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
      for (const foreground of ["--color-ink", "--color-shell-muted", "--color-shell-accent"] as const) {
        expect(contrastRatio(colors[foreground], background), `${mode} ${foreground} on A`).toBeGreaterThanOrEqual(4.5);
      }
    }
  }
});

for (const mode of ["light", "dark"] as const) {
  test(`${mode}: readable text, controls and health graphics`, () => {
    const colors = paletteTokens(mode);
    const surfaces = ["--color-rail", "--color-canvas", "--color-toolbar", "--color-surface", "--color-raised", "--color-item-hover", "--color-item-selected"];
    const check = (foreground: string, background: string, minimum: number) => {
      expect(contrastRatio(colors[foreground as `--${string}`], colors[background as `--${string}`]), `${foreground} on ${background}`).toBeGreaterThanOrEqual(minimum);
    };
    for (const surface of surfaces) {
      for (const foreground of ["--color-ink", "--color-muted", "--color-link", "--color-success-text", "--color-warn", "--color-danger", "--color-info"]) check(foreground, surface, 4.5);
      check("--color-accent-focus", surface, 3);
    }
    check("--color-on-accent", "--color-primary", 4.5);
    check("--color-on-accent-hover", mode === "light" ? "--color-primary" : "--color-primary-hover", 4.5);
    check("--color-on-accent", "--color-primary-active", 4.5);
    check("--color-nav-selected-text", "--color-nav-selected", 4.5);
    check("--color-rail-selected-text", "--color-rail-selected", 4.5);
    check("--color-on-danger", "--color-danger-fill", 4.5);
    check("--color-info", "--color-accent-soft", 4.5);
    check("--color-item-selected-text", "--color-item-selected", 4.5);
    expect(colors["--color-card-track"]).toBe(colors["--meter-off"]);
    check("--color-success-text", "--color-success-soft", 4.5);
    check("--color-warn", "--color-warn-soft", 4.5);
    check("--color-danger", "--color-danger-soft", 4.5);
    check("--color-info", "--color-info-soft", 4.5);
    check("--color-tooltip-text", "--color-tooltip", 4.5);
    for (const foreground of ["--meter-ok", "--meter-warn", "--meter-danger"]) check(foreground, "--color-surface", 3);
    for (const background of ["--color-surface", "--color-raised", "--color-item-selected", "--meter-off"]) {
      for (const direction of ["--color-io-read", "--color-io-write"]) check(direction, background, 3);
    }
    expect(new Set([colors["--meter-ok"], colors["--meter-warn"], colors["--meter-danger"]]).size).toBe(3);
    expect(Object.values(colors).every((color) => /^#[0-9a-f]{6}$|^rgba\(/.test(color))).toBe(true);
  });
}
