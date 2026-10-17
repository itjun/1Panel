/** Failed snapshots can contain zero-filled overview structs. Never display them as live readings. */
export function currentGroupSample<T, D>(
  snapshot?: { overview?: T | null; disks?: D; error?: string; notInstalled?: boolean },
  unavailable = false,
) {
  const valid = !unavailable && !snapshot?.error && !snapshot?.notInstalled;
  return {
    overview: valid ? snapshot?.overview ?? null : null,
    disks: valid ? snapshot?.disks : undefined,
  };
}
