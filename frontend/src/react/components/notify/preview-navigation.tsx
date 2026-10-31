import { RadioGroup } from "@/react/components/ui/radio-group";
import { Select } from "@/react/components/ui/select";
import {
  PREVIEW_CATEGORIES,
  PREVIEW_STATES,
  type PreviewCategory,
  type PreviewState,
} from "@/react/state/notify-channels-navigation";

const stateOptions = PREVIEW_STATES.map(({ id, label }) => ({ value: id, label }));
const categoryOptions = PREVIEW_CATEGORIES.map(({ id, label }) => ({ value: id, label }));

export function NotifyPreviewNavigation({ state, category, onStateChange, onCategoryChange }: {
  state: PreviewState;
  category: PreviewCategory;
  onStateChange: (state: PreviewState) => void;
  onCategoryChange: (category: PreviewCategory) => void;
}) {
  return (
    <div className="notify-preview-navigation">
      <RadioGroup aria-label="消息状态" value={state} onChange={onStateChange} options={stateOptions} />
      <Select aria-label="消息类型" value={category} onChange={onCategoryChange} options={categoryOptions} className="w-40" />
    </div>
  );
}
