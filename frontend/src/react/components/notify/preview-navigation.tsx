import {
  PREVIEW_CATEGORIES,
  PREVIEW_STATES,
  previewSection,
  requestChannelSection,
  useChannelReadingSection,
  type ChannelSection,
  type PreviewState,
} from "@/react/state/notify-channels-navigation";

export function NotifyPreviewNavigation() {
  const readingSection = useChannelReadingSection();
  return (
    <nav className="notify-preview-navigation" aria-label="消息预览目录">
      {PREVIEW_STATES.map((state) => (
        <PreviewNavigationGroup key={state.id} state={state} readingSection={readingSection} />
      ))}
    </nav>
  );
}

function PreviewNavigationGroup({ state, readingSection }: {
  state: { id: PreviewState; label: string };
  readingSection: ChannelSection;
}) {
  const section = previewSection(state.id);
  const active = readingSection === section || readingSection.startsWith(`${section}-`);

  return (
    <div className="notify-preview-nav-group" role="group" aria-label={state.label}>
      <button
        type="button"
        className="notify-preview-group-link"
        data-active={active || undefined}
        aria-current={readingSection === section ? "location" : undefined}
        aria-controls={`notify-channel-${section}`}
        onClick={() => requestChannelSection(section)}
      >{state.label}</button>
      <div className="notify-preview-category-links">
        {PREVIEW_CATEGORIES.map((category) => {
          const target = previewSection(state.id, category.id);
          return (
            <button
              key={category.id}
              type="button"
              aria-label={`${state.label} · ${category.label}`}
              aria-current={readingSection === target ? "location" : undefined}
              aria-controls={`notify-channel-${target}`}
              onClick={() => requestChannelSection(target)}
            >{category.label}</button>
          );
        })}
      </div>
    </div>
  );
}
