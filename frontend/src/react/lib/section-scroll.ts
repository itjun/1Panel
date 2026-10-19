/** Section offsets are relative to the scroll container, not the window. */
export function sectionReadingPosition<Section extends string>(
  sections: { id: Section; top: number }[],
  scrollTop: number,
  viewportHeight: number,
  scrollHeight: number,
  pointerOffset: number | null,
  fallback: Section,
): Section {
  // Keyboard/touch reading should reach the final section at the scroll limit;
  // an actual pointer still identifies its own module anywhere in the viewport.
  if (pointerOffset === null && scrollHeight > viewportHeight + 2 && scrollTop + viewportHeight >= scrollHeight - 2) {
    return sections[sections.length - 1]?.id ?? fallback;
  }
  const readingLine = scrollTop + Math.max(0, Math.min(pointerOffset ?? 96, viewportHeight - 1));
  let current: Section = fallback;
  for (const section of sections) {
    if (section.top > readingLine) break;
    current = section.id;
  }
  return current;
}
