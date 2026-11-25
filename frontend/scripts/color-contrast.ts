// 按渲染时的底色合成半透明文字，再计算 sRGB 相对亮度。
export function contrastRatio(foreground: string, background: string): number {
  const rgb = (hex: string) => [1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16));
  const surface = rgb(background);
  const rgba = foreground.match(/^rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)$/);
  const alpha = rgba ? Number(rgba[4]) : 1;
  const ink = rgba ? surface.map((channel, i) => Number(rgba[i + 1]) * alpha + channel * (1 - alpha)) : rgb(foreground);
  const luminance = (channels: number[]) => channels.reduce((sum, component, index) => {
    const v = component / 255;
    return sum + [0.2126, 0.7152, 0.0722][index] * (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  }, 0);
  const a = luminance(ink), b = luminance(surface);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}
