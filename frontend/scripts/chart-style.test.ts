import { expect, test } from "bun:test";
import type { LineSeriesOption, VisualMapComponentOption } from "echarts";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { lineOption, TrendDirectionSwatch } from "../src/react/components/monitor/charts";
import { chartPalette, trendLineStyle } from "../src/react/lib/chart-style";
import { contrastRatio } from "./color-contrast";
import { paletteTokens } from "../src/react/lib/color-palettes";
import { usageBands } from "../src/react/lib/usage-tone";

test("方向图例使用与读写曲线对应的实线", () => {
  for (const direction of ["read", "write"] as const) {
    const html = renderToStaticMarkup(createElement(TrendDirectionSwatch, { direction }));
    expect(html).toContain("border-solid");
    expect(html).toContain(`border-io-${direction}`);
  }
});

for (const mode of ["light", "dark"] as const) {
  test(`${mode}: direction colors, line patterns and detail layering`, () => {
    const palette = chartPalette(mode);
    expect([palette.read, palette.write]).toEqual(
      mode === "light" ? ["#0080b0", "#008858"] : ["#41b8f2", "#92dab2"],
    );
    for (const ink of [palette.read, palette.write]) {
      expect(contrastRatio(ink, palette.surface)).toBeGreaterThanOrEqual(3);
      expect(contrastRatio(ink, palette.raised)).toBeGreaterThanOrEqual(3);
      expect(contrastRatio(ink, palette.line)).toBeGreaterThanOrEqual(3);
    }

    const option = lineOption(["0s", "1s"], [
      { name: "A→B", direction: "write", data: [60, 60] },
      { name: "B→A", direction: "read", data: [60, 60] },
      { name: "A→B #1", direction: "write", detail: true, data: [30, 30] },
    ], { colorMode: mode });
    expect(option.color).toEqual([palette.write, palette.read, palette.write]);
    const [send, receive, stream] = option.series as LineSeriesOption[];
    expect(send?.lineStyle?.type).toBe("solid");
    expect(receive?.lineStyle?.type).toBe("solid");
    expect(stream?.lineStyle).toMatchObject({ type: "solid", width: 1.25, opacity: mode === "light" ? 0.72 : 0.58 });
    expect(stream?.emphasis?.lineStyle?.opacity).toBe(1);
    expect(send?.z).toBeGreaterThan(stream?.z ?? 0);
    expect(receive?.z).toBeGreaterThan(stream?.z ?? 0);
    const rgb = mode === "light" ? ["0,136,88", "0,128,176"] : ["146,218,178", "65,184,242"];
    [send, receive].forEach((series, index) => {
      expect(series?.areaStyle?.color).toMatchObject({
        colorStops: [
          { offset: 0, color: `rgba(${rgb[index]},0.28)` },
          { offset: 1, color: `rgba(${rgb[index]},0)` },
        ],
      });
    });
    expect(stream?.areaStyle).toBeUndefined();

    const partial = trendLineStyle({ color: palette.write, values: [20, 10], mode, fill: false });
    expect(partial.lineStyle?.type).toBe("solid");
    expect(partial.areaStyle).toBeUndefined();
  });

  test(`${mode}: occupancy thresholds and neutral fallback`, () => {
    const tokens = paletteTokens(mode);
    const option = lineOption(["0s", "1s", "2s"], [
      { name: "CPU", data: [20, 70, 90], bands: usageBands(100) },
      { name: "交换", data: [4, 5, 6], muted: true },
      { name: "已用", data: [20, 70, 90] },
    ], { colorMode: mode });
    expect(option.color).toEqual([tokens["--meter-ok"], tokens["--color-muted"], tokens["--color-chart-1"]]);
    expect((option.visualMap as VisualMapComponentOption[])[0]).toMatchObject({
      pieces: [
        { lt: 60, color: tokens["--meter-ok"] },
        { gte: 60, lt: 85, color: tokens["--meter-warn"] },
        { gte: 85, color: tokens["--meter-danger"] },
      ],
    });
    const [usage, swap] = option.series as LineSeriesOption[];
    expect(usage?.areaStyle?.color).toMatchObject({
      colorStops: expect.arrayContaining([
        { offset: 0, color: expect.stringMatching(/,0\.28\)$/) },
      ]),
    });
    expect(swap?.lineStyle).toMatchObject({ type: "solid", width: 1.25 });
    expect(swap?.areaStyle).toBeUndefined();
  });
}
