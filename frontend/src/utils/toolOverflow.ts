/** Preserve source order and keep the active tool in the visible portion. */
export function visibleToolIndices(
  count: number,
  width: number,
  active: number,
  itemWidth = 64,
  moreWidth = 76,
): number[] {
  if (width >= count * itemWidth)
    return Array.from({ length: count }, (_, i) => i);
  const slots = Math.min(
    count,
    Math.max(1, Math.floor((width - moreWidth) / itemWidth)),
  );
  const visible = Array.from({ length: slots }, (_, i) => i);
  if (active >= slots && active < count) visible[slots - 1] = active;
  return visible;
}


/** Fit measured labels, including custom font sizes, with one reserved overflow button. */
export function measuredToolIndices(widths: number[], available: number, active: number, moreWidth: number): number[] {
  if (!widths.length) return [];
  const selected = Math.max(0, Math.min(active, widths.length - 1));
  if (widths.reduce((sum, width) => sum + width, 0) <= available) return widths.map((_, index) => index);
  const budget = Math.max(0, available - moreWidth);
  const visible = new Set([selected]);
  let used = widths[selected];
  for (let index = 0; index < widths.length; index++) {
    if (index === selected || used + widths[index] > budget) continue;
    visible.add(index); used += widths[index];
  }
  return [...visible].sort((a, b) => a - b);
}
