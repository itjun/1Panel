/** Counter resets and missing samples must not appear as traffic spikes. */
export function counterRate(
  previous: number | undefined,
  current: number | undefined,
  elapsedMs: number,
): number | undefined {
  if (
    previous == null ||
    current == null ||
    !Number.isFinite(previous) ||
    !Number.isFinite(current) ||
    !Number.isFinite(elapsedMs) ||
    elapsedMs <= 0 ||
    elapsedMs > 30000 ||
    previous < 0 ||
    current < previous
  )
    return undefined;
  return ((current - previous) * 1000) / elapsedMs;
}
