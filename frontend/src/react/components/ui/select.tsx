import { Check, ChevronDown } from "lucide-react";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { Popup } from "@/react/components/ui/popup";
import { cn } from "@/react/lib/utils";

export type SelectOption<T extends string | number = string> = {
  value: T;
  label: ReactNode;
  disabled?: boolean;
};

/**
 * 下拉选择器（结构与交互照 TDesign Select，外观走本仓库 token）。
 *
 * - 触发器沿用 `.motion-field` 填充式输入框外观，打开时右侧箭头翻转。
 * - 面板：surface 底 + 1px line 描边，选项 32px 行高，hover raised，选中 accent-soft 底 + 对勾。
 * - 键盘：上下移动高亮、Enter / 空格选中、Esc 关闭、Home / End 到首尾。
 */
export function Select<T extends string | number = string>({
  value,
  onChange,
  options,
  placeholder = "请选择",
  disabled = false,
  size = "default",
  className,
  panelClassName,
  "aria-label": ariaLabel,
}: {
  value: T;
  onChange: (value: T) => void;
  options: SelectOption<T>[];
  placeholder?: string;
  disabled?: boolean;
  /** default 32px / sm 28px / lg 36px（表单里跟输入框对齐用） */
  size?: "default" | "sm" | "lg";
  className?: string;
  panelClassName?: string;
  "aria-label"?: string;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  const selectedIndex = options.findIndex((item) => item.value === value);
  const selected = selectedIndex >= 0 ? options[selectedIndex] : undefined;

  // 每次打开都把高亮放到当前选中项上
  useEffect(() => {
    if (!open) return;
    setActive(selectedIndex >= 0 ? selectedIndex : firstEnabled(options, 0, 1));
  }, [open, selectedIndex, options]);

  // 高亮项滚进可视区
  useEffect(() => {
    if (!open || active < 0) return;
    const node = listRef.current?.children[active] as HTMLElement | undefined;
    node?.scrollIntoView({ block: "nearest" });
  }, [open, active]);

  function pick(index: number) {
    const item = options[index];
    if (!item || item.disabled) return;
    onChange(item.value);
    setOpen(false);
  }

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (disabled) return;
    if (!open) {
      if (
        event.key === "ArrowDown" ||
        event.key === "ArrowUp" ||
        event.key === "Enter" ||
        event.key === " "
      ) {
        event.preventDefault();
        setOpen(true);
      }
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((prev) => firstEnabled(options, prev + 1, 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((prev) => firstEnabled(options, prev - 1, -1));
    } else if (event.key === "Home") {
      event.preventDefault();
      setActive(firstEnabled(options, 0, 1));
    } else if (event.key === "End") {
      event.preventDefault();
      setActive(firstEnabled(options, options.length - 1, -1));
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      pick(active);
    } else if (event.key === "Tab") {
      setOpen(false);
    }
  }

  let heightClass = "h-8 text-sm";
  if (size === "sm") {
    heightClass = "h-7 text-xs";
  } else if (size === "lg") {
    heightClass = "h-9 text-sm";
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={() => setOpen((prev) => !prev)}
        onKeyDown={onKeyDown}
        className={cn(
          "motion-field inline-flex items-center justify-between gap-2 rounded-control pl-3 pr-2 text-left text-ink disabled:cursor-not-allowed disabled:text-muted",
          heightClass,
          open && "motion-field-active",
          className,
        )}
      >
        <span className={cn("min-w-0 flex-1 truncate", !selected && "text-muted")}>
          {selected ? selected.label : placeholder}
        </span>
        <ChevronDown
          aria-hidden
          className={cn(
            "size-4 shrink-0 text-muted motion-transform",
            open && "rotate-180",
          )}
          strokeWidth={1.5}
        />
      </button>
      <Popup
        open={open}
        anchorRef={triggerRef}
        onClose={() => setOpen(false)}
        matchAnchorWidth
        className={cn("max-h-70 overflow-y-auto p-1", panelClassName)}
      >
        <div ref={listRef} role="listbox" id={listId} aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}>
          {options.map((item, index) => {
            const isSelected = item.value === value;
            const isActive = index === active;
            return (
              <div
                key={`${index}-${String(item.value)}`}
                id={`${listId}-${index}`}
                role="option"
                aria-selected={isSelected}
                aria-disabled={item.disabled || undefined}
                // 按下时不抢焦点，焦点留在触发器上，键盘能接着用
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => {
                  if (!item.disabled) setActive(index);
                }}
                onClick={() => pick(index)}
                className={cn(
                  "flex h-8 cursor-pointer items-center gap-2 rounded-control px-2 text-sm motion-colors",
                  isSelected ? "bg-accent-soft text-accent" : "text-ink",
                  isActive && !isSelected && "bg-raised",
                  item.disabled && "cursor-not-allowed text-muted opacity-50",
                )}
              >
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
                {isSelected ? (
                  <Check aria-hidden className="size-4 shrink-0" strokeWidth={1.5} />
                ) : null}
              </div>
            );
          })}
        </div>
      </Popup>
    </>
  );
}

/** 从 start 起按 step 方向找第一个可用项；越界则夹到边界，全都禁用返回 -1 */
function firstEnabled<T extends string | number>(
  options: SelectOption<T>[],
  start: number,
  step: 1 | -1,
): number {
  if (options.length === 0) return -1;
  let index = Math.min(Math.max(start, 0), options.length - 1);
  for (let i = 0; i < options.length; i += 1) {
    if (!options[index].disabled) return index;
    index += step;
    if (index < 0 || index >= options.length) break;
  }
  return -1;
}
