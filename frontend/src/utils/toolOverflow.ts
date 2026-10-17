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
