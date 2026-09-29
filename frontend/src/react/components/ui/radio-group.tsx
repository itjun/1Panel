import {
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { cn } from "@/react/lib/utils";

export type RadioOption<T extends string> = {
  value: T;
  label: ReactNode;
  disabled?: boolean;
};

/**
 * 按钮式单选组（照 TDesign RadioGroup variant="default-filled"）：少量互斥选项。
 *
 * - raised 底轨道 + 2px 内边距；选项 28px 高；选中项 surface 底 + accent 字 + 600 字重。
 * - 选中底块在选项间滑动（--duration-moderate）；减少动态效果时直接跳。
 * - role="radiogroup"，左右 / 上下键切换并聚焦，Tab 只停在选中项上。
 */
export function RadioGroup<T extends string>({
  value,
  onChange,
  options,
  disabled = false,
  className,
  "aria-label": ariaLabel,
}: {
  value: T;
  onChange: (value: T) => void;
  options: RadioOption<T>[];
  disabled?: boolean;
  className?: string;
  "aria-label"?: string;
}) {
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [indicator, setIndicator] = useState<CSSProperties>({ opacity: 0 });
  const selectedIndex = options.findIndex((item) => item.value === value);

  // 选中底块跟随选中项的位置和宽度
  useLayoutEffect(() => {
    const el = itemRefs.current[selectedIndex];
    if (!el) {
      setIndicator({ opacity: 0 });
      return;
    }
    setIndicator({ left: el.offsetLeft, width: el.offsetWidth, opacity: 1 });
  }, [selectedIndex, options]);

  function move(from: number, step: 1 | -1) {
    const count = options.length;
    let index = from;
    for (let i = 0; i < count; i += 1) {
      index = (index + step + count) % count;
      if (!options[index].disabled) {
        onChange(options[index].value);
        itemRefs.current[index]?.focus();
        return;
      }
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      event.preventDefault();
      move(index, 1);
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      event.preventDefault();
      move(index, -1);
    }
  }

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      aria-disabled={disabled || undefined}
      className={cn(
        "relative inline-flex rounded-control bg-raised p-0.5",
        disabled && "opacity-50",
        className,
      )}
    >
      <span
        aria-hidden
        style={indicator}
        className="motion-segment absolute top-0.5 bottom-0.5 rounded-tag bg-surface"
      />
      {options.map((item, index) => {
        const selected = index === selectedIndex;
        let tabIndex = -1;
        if (selected || (selectedIndex < 0 && index === 0)) {
          tabIndex = 0;
        }
        return (
          <button
            key={item.value}
            ref={(el) => {
              itemRefs.current[index] = el;
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={tabIndex}
            disabled={disabled || item.disabled}
            onClick={() => onChange(item.value)}
            onKeyDown={(event) => onKeyDown(event, index)}
            className={cn(
              "relative z-10 inline-flex h-7 items-center rounded-tag px-3 text-sm whitespace-nowrap motion-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent-focus disabled:cursor-not-allowed",
              selected ? "font-semibold text-accent" : "text-ink hover:text-accent",
              item.disabled && "text-muted",
            )}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
