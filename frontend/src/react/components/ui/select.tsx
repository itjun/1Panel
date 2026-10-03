import { Check, ChevronDown } from "lucide-react";
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { Popup } from "@/react/components/ui/popup";
import { cn } from "@/react/lib/utils";

export type SelectOption<T extends string | number = string> = {
  value: T;
  label: ReactNode;
  disabled?: boolean;
  /** filterable 时参与匹配的额外文字（如主机的 IP）；label 为字符串时自动参与 */
  keywords?: string;
};

/**
 * 下拉选择器（结构与交互照 TDesign Select，外观走本仓库 token）。
 *
 * - 触发器沿用 `.motion-field` 填充式输入框外观，打开时右侧箭头翻转。
 * - 面板：surface 底 + 1px line 描边，选项 32px 行高，hover raised，选中 accent-soft 底 + 对勾。
 * - 键盘：上下移动高亮、Enter / 空格选中、Esc 关闭、Home / End 到首尾。
 * - filterable（照 TDesign Select filterable）：打开后触发器变输入框，按 value / 字符串 label / keywords
 *   不区分大小写包含匹配；此时空格是输入，只有 Enter 选中。
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
  filterable = false,
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
  /** 可输入关键字过滤选项 */
  filterable?: boolean;
  "aria-label"?: string;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [query, setQuery] = useState("");
  const triggerRef = useRef<HTMLElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  const selected = options.find((item) => item.value === value);
  const keyword = filterable ? query.trim().toLowerCase() : "";
  const visible = useMemo(
    () => (keyword ? options.filter((item) => matches(item, keyword)) : options),
    [options, keyword],
  );
  const selectedIndex = visible.findIndex((item) => item.value === value);

  // 每次打开都把高亮放到当前选中项上；输入关键字后高亮第一个匹配项
  useEffect(() => {
    if (!open) return;
    if (keyword) setActive(firstEnabled(visible, 0, 1));
    else setActive(selectedIndex >= 0 ? selectedIndex : firstEnabled(visible, 0, 1));
  }, [open, keyword, selectedIndex, visible]);

  useEffect(() => {
    if (!open) setQuery("");
    else if (filterable) inputRef.current?.focus();
  }, [open, filterable]);

  // 高亮项滚进可视区
  useEffect(() => {
    if (!open || active < 0) return;
    const node = listRef.current?.children[active] as HTMLElement | undefined;
    node?.scrollIntoView({ block: "nearest" });
  }, [open, active]);

  function pick(index: number) {
    const item = visible[index];
    if (!item || item.disabled) return;
    onChange(item.value);
    setOpen(false);
  }

  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    // 输入法组字中的回车 / 方向键属于输入法
    if (disabled || event.nativeEvent.isComposing) return;
    if (!open) {
      if (
        event.key === "ArrowDown" ||
        event.key === "ArrowUp" ||
        event.key === "Enter" ||
        (event.key === " " && !filterable)
      ) {
        event.preventDefault();
        setOpen(true);
      }
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((prev) => firstEnabled(visible, prev + 1, 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((prev) => firstEnabled(visible, prev - 1, -1));
    } else if (event.key === "Home" && !filterable) {
      event.preventDefault();
      setActive(firstEnabled(visible, 0, 1));
    } else if (event.key === "End" && !filterable) {
      event.preventDefault();
      setActive(firstEnabled(visible, visible.length - 1, -1));
    } else if (event.key === "Enter" || (event.key === " " && !filterable)) {
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

  const chevron = (
    <ChevronDown
      aria-hidden
      className={cn("size-4 shrink-0 text-muted motion-transform", open && "rotate-180")}
      strokeWidth={1.5}
    />
  );
  const fieldClass = cn(
    "motion-field inline-flex items-center justify-between gap-2 rounded-control pl-3 pr-2 text-left text-ink",
    heightClass,
    open && "motion-field-active",
    className,
  );

  return (
    <>
      {filterable ? (
        <div
          ref={triggerRef as RefObject<HTMLDivElement>}
          tabIndex={-1}
          aria-disabled={disabled || undefined}
          onMouseDown={(event) => {
            if (disabled) return;
            // 点输入框本身不切换，避免打开后立刻又被关掉
            if (event.target === inputRef.current && open) return;
            event.preventDefault();
            setOpen((prev) => !prev);
            inputRef.current?.focus();
          }}
          className={cn(fieldClass, disabled ? "cursor-not-allowed text-muted" : "cursor-text")}
        >
          <span className="relative flex min-w-0 flex-1 items-center">
            <input
              ref={inputRef}
              role="combobox"
              aria-haspopup="listbox"
              aria-expanded={open}
              aria-controls={open ? listId : undefined}
              aria-label={ariaLabel}
              aria-activedescendant={open && active >= 0 ? `${listId}-${active}` : undefined}
              disabled={disabled}
              value={open ? query : ""}
              placeholder={open ? (typeof selected?.label === "string" ? selected.label : "输入关键字搜索") : ""}
              onChange={(event) => {
                setQuery(event.target.value);
                if (!open) setOpen(true);
              }}
              onKeyDown={onKeyDown}
              className="min-w-0 flex-1 bg-transparent text-ink outline-none placeholder:text-muted disabled:cursor-not-allowed"
            />
            {open ? null : (
              <span
                className={cn(
                  "pointer-events-none absolute inset-0 flex items-center truncate",
                  !selected && "text-muted",
                )}
              >
                <span className="min-w-0 flex-1 truncate">{selected ? selected.label : placeholder}</span>
              </span>
            )}
          </span>
          {chevron}
        </div>
      ) : (
      <button
        ref={triggerRef as RefObject<HTMLButtonElement>}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={() => setOpen((prev) => !prev)}
        onKeyDown={onKeyDown}
        className={cn(fieldClass, "disabled:cursor-not-allowed disabled:text-muted")}
      >
        <span className={cn("min-w-0 flex-1 truncate", !selected && "text-muted")}>
          {selected ? selected.label : placeholder}
        </span>
        {chevron}
      </button>
      )}
      <Popup
        open={open}
        anchorRef={triggerRef}
        onClose={() => setOpen(false)}
        matchAnchorWidth
        className={cn("max-h-70 overflow-y-auto p-1", panelClassName)}
      >
        <div ref={listRef} role="listbox" id={listId} aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}>
          {visible.length === 0 ? (
            <div className="flex h-8 items-center px-2 text-sm text-muted">无匹配项</div>
          ) : null}
          {visible.map((item, index) => {
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

function matches<T extends string | number>(item: SelectOption<T>, keyword: string): boolean {
  const text = [String(item.value), typeof item.label === "string" ? item.label : "", item.keywords || ""]
    .join("\n")
    .toLowerCase();
  return text.includes(keyword);
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
