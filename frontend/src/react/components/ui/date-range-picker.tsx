import {
  Calendar,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "@/react/components/ui/button";
import { Popup } from "@/react/components/ui/popup";
import { cn } from "@/react/lib/utils";

/** 值格式与原生 datetime-local 一致：YYYY-MM-DDTHH:mm（本地时间） */
export type DateRangeValue = [string, string];

const WEEKDAYS = ["一", "二", "三", "四", "五", "六", "日"];
const HOURS = Array.from({ length: 24 }, (_, i) => i);
const MINUTES = Array.from({ length: 60 }, (_, i) => i);

type Side = 0 | 1;

/**
 * 日期时间区间选择器（结构与交互照 TDesign DateRangePicker + enableTimePicker，外观走本仓库 token）。
 *
 * - 触发器一个输入框，显示「开始 ~ 结束」。
 * - 面板：上方开始 / 结束两个框（当前编辑侧 accent 描边）；左边月历，右边时 / 分两列；底部「此刻」「确定」。
 * - 先点开始日期自动切到结束；两端都有值「确定」才可点；结束早于开始时自动交换。
 * - 点「确定」才回写，Esc / 外点关闭不改值。
 */
export function DateRangePicker({
  value,
  onChange,
  disabled = false,
  className,
}: {
  value: DateRangeValue;
  onChange: (next: DateRangeValue) => void;
  disabled?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<[Date | null, Date | null]>([null, null]);
  const [side, setSide] = useState<Side>(0);
  const [viewMonth, setViewMonth] = useState(() => startOfMonth(new Date()));
  const [hoverDay, setHoverDay] = useState<Date | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const start = parseValue(value[0]);
  const end = parseValue(value[1]);

  function openPanel() {
    if (disabled) return;
    setDraft([start, end]);
    setSide(0);
    setViewMonth(startOfMonth(start ?? new Date()));
    setHoverDay(null);
    setOpen(true);
  }

  /** 把某一侧的日期部分换成 day，时间部分沿用该侧已有值，没有就 00:00 */
  function pickDay(day: Date) {
    const current = draft[side];
    const next = new Date(
      day.getFullYear(),
      day.getMonth(),
      day.getDate(),
      current ? current.getHours() : 0,
      current ? current.getMinutes() : 0,
    );
    const nextDraft: [Date | null, Date | null] = [draft[0], draft[1]];
    nextDraft[side] = next;
    setDraft(nextDraft);
    // 选完开始自动跳到结束；选完结束停在结束，方便调时间
    if (side === 0) {
      setSide(1);
    }
  }

  function pickTime(kind: "hour" | "minute", n: number) {
    const base = draft[side] ?? startOfDay(new Date());
    const next = new Date(base);
    if (kind === "hour") {
      next.setHours(n);
    } else {
      next.setMinutes(n);
    }
    const nextDraft: [Date | null, Date | null] = [draft[0], draft[1]];
    nextDraft[side] = next;
    setDraft(nextDraft);
  }

  function pickNow() {
    const now = new Date();
    now.setSeconds(0, 0);
    const nextDraft: [Date | null, Date | null] = [draft[0], draft[1]];
    nextDraft[side] = now;
    setDraft(nextDraft);
    setViewMonth(startOfMonth(now));
  }

  function confirm() {
    let [a, b] = draft;
    if (!a || !b) return;
    if (b.getTime() < a.getTime()) {
      [a, b] = [b, a];
    }
    onChange([formatValue(a), formatValue(b)]);
    setOpen(false);
  }

  const canConfirm = draft[0] !== null && draft[1] !== null;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          if (open) {
            setOpen(false);
          } else {
            openPanel();
          }
        }}
        className={cn(
          "motion-field inline-flex h-8 items-center gap-2 rounded-control pl-3 pr-2 text-left text-sm text-ink disabled:cursor-not-allowed disabled:text-muted",
          open && "motion-field-active",
          className,
        )}
      >
        <span className="font-mono tabular-nums">
          {start ? formatDisplay(start) : <span className="text-muted">开始时间</span>}
          <span className="mx-2 text-muted">~</span>
          {end ? formatDisplay(end) : <span className="text-muted">结束时间</span>}
        </span>
        <Calendar aria-hidden className="size-4 shrink-0 text-muted" strokeWidth={1.5} />
      </button>

      <Popup open={open} anchorRef={triggerRef} onClose={() => setOpen(false)} className="p-3">
        <div className="mb-3 flex gap-2">
          <SideField
            label="开始时间"
            value={draft[0]}
            active={side === 0}
            onClick={() => {
              setSide(0);
              if (draft[0]) setViewMonth(startOfMonth(draft[0]));
            }}
          />
          <SideField
            label="结束时间"
            value={draft[1]}
            active={side === 1}
            onClick={() => {
              setSide(1);
              if (draft[1]) setViewMonth(startOfMonth(draft[1]));
            }}
          />
        </div>

        <div className="flex gap-3">
          <CalendarPanel
            viewMonth={viewMonth}
            onViewMonthChange={setViewMonth}
            rangeStart={draft[0]}
            rangeEnd={draft[1]}
            side={side}
            hoverDay={hoverDay}
            onHoverDay={setHoverDay}
            onPickDay={pickDay}
          />
          <div className="flex gap-1 border-l border-line pl-3">
            <TimeColumn
              items={HOURS}
              selected={draft[side]?.getHours() ?? -1}
              onPick={(n) => pickTime("hour", n)}
              resetKey={side}
            />
            <TimeColumn
              items={MINUTES}
              selected={draft[side]?.getMinutes() ?? -1}
              onPick={(n) => pickTime("minute", n)}
              resetKey={side}
            />
          </div>
        </div>

        <div className="mt-3 flex items-center justify-between border-t border-line pt-3">
          <button
            type="button"
            onClick={pickNow}
            className="rounded-control px-2 py-1 text-sm text-accent motion-colors hover:bg-accent-soft"
          >
            此刻
          </button>
          <Button variant="primary" size="sm" disabled={!canConfirm} onClick={confirm}>
            确定
          </Button>
        </div>
      </Popup>
    </>
  );
}

/** 面板顶部的开始 / 结束显示框，点一下切换当前编辑侧 */
function SideField({
  label,
  value,
  active,
  onClick,
}: {
  label: string;
  value: Date | null;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "motion-field h-8 flex-1 rounded-control px-3 text-left font-mono text-sm tabular-nums text-ink",
        active && "motion-field-active",
      )}
    >
      {value ? formatDisplay(value) : <span className="text-muted">{label}</span>}
    </button>
  );
}

function CalendarPanel({
  viewMonth,
  onViewMonthChange,
  rangeStart,
  rangeEnd,
  side,
  hoverDay,
  onHoverDay,
  onPickDay,
}: {
  viewMonth: Date;
  onViewMonthChange: (month: Date) => void;
  rangeStart: Date | null;
  rangeEnd: Date | null;
  side: Side;
  hoverDay: Date | null;
  onHoverDay: (day: Date | null) => void;
  onPickDay: (day: Date) => void;
}) {
  const today = startOfDay(new Date());
  const days = buildCalendarDays(viewMonth);

  // 正在选结束、且已有开始时，悬停显示预览区间
  let previewStart = rangeStart ? startOfDay(rangeStart) : null;
  let previewEnd = rangeEnd ? startOfDay(rangeEnd) : null;
  if (side === 1 && previewStart && hoverDay) {
    previewEnd = hoverDay;
  }
  if (previewStart && previewEnd && previewEnd.getTime() < previewStart.getTime()) {
    [previewStart, previewEnd] = [previewEnd, previewStart];
  }

  function shiftMonth(delta: number) {
    onViewMonthChange(new Date(viewMonth.getFullYear(), viewMonth.getMonth() + delta, 1));
  }

  return (
    <div className="w-56">
      <div className="mb-2 flex h-7 items-center justify-between">
        <div className="flex">
          <NavButton label="上一年" onClick={() => shiftMonth(-12)}>
            <ChevronsLeft className="size-4" strokeWidth={1.5} />
          </NavButton>
          <NavButton label="上个月" onClick={() => shiftMonth(-1)}>
            <ChevronLeft className="size-4" strokeWidth={1.5} />
          </NavButton>
        </div>
        <div className="text-sm font-semibold text-ink tabular-nums">
          {viewMonth.getFullYear()} 年 {viewMonth.getMonth() + 1} 月
        </div>
        <div className="flex">
          <NavButton label="下个月" onClick={() => shiftMonth(1)}>
            <ChevronRight className="size-4" strokeWidth={1.5} />
          </NavButton>
          <NavButton label="下一年" onClick={() => shiftMonth(12)}>
            <ChevronsRight className="size-4" strokeWidth={1.5} />
          </NavButton>
        </div>
      </div>

      <div className="grid grid-cols-7">
        {WEEKDAYS.map((name) => (
          <div key={name} className="flex h-7 items-center justify-center text-xs text-muted">
            {name}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7" onMouseLeave={() => onHoverDay(null)}>
        {days.map((day) => {
          const inMonth = day.getMonth() === viewMonth.getMonth();
          const isStart = rangeStart ? isSameDay(day, rangeStart) : false;
          const isEnd = rangeEnd ? isSameDay(day, rangeEnd) : false;
          const isEndpoint = isStart || isEnd;
          let inRange = false;
          if (previewStart && previewEnd) {
            const t = day.getTime();
            inRange = t > previewStart.getTime() && t < previewEnd.getTime();
          }
          const isToday = isSameDay(day, today);

          let cellClass = "text-ink hover:bg-raised";
          if (!inMonth) {
            cellClass = "text-muted hover:bg-raised";
          }
          if (inRange) {
            cellClass = "bg-accent-soft text-accent";
          }
          if (isEndpoint) {
            cellClass = "bg-accent text-white";
          }

          return (
            <button
              key={day.getTime()}
              type="button"
              onClick={() => onPickDay(day)}
              onMouseEnter={() => onHoverDay(startOfDay(day))}
              aria-label={formatDisplay(day).slice(0, 10)}
              aria-pressed={isEndpoint}
              className={cn(
                "flex h-8 w-8 items-center justify-center rounded-control text-sm tabular-nums motion-colors",
                cellClass,
                isToday && !isEndpoint && "border border-accent",
              )}
            >
              {day.getDate()}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function NavButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="flex h-7 w-7 items-center justify-center rounded-control text-muted motion-colors hover:bg-raised hover:text-ink"
    >
      {children}
    </button>
  );
}

/** 时 / 分滚动列；切换编辑侧或选中值变化时把选中项滚到可视区 */
function TimeColumn({
  items,
  selected,
  onPick,
  resetKey,
}: {
  items: number[];
  selected: number;
  onPick: (n: number) => void;
  resetKey: Side;
}) {
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (selected < 0) return;
    const node = listRef.current?.children[selected] as HTMLElement | undefined;
    node?.scrollIntoView({ block: "center" });
  }, [selected, resetKey]);

  return (
    // 高度 = 月历高度（标题 28 + 8 + 星期 28 + 6 行 × 32），两边齐平
    <div ref={listRef} className="h-64 w-12 overflow-y-auto">
      {items.map((n) => (
        <button
          key={n}
          type="button"
          onClick={() => onPick(n)}
          className={cn(
            "flex h-7 w-full items-center justify-center rounded-control text-sm tabular-nums motion-colors",
            n === selected ? "bg-accent-soft text-accent" : "text-ink hover:bg-raised",
          )}
        >
          {pad2(n)}
        </button>
      ))}
    </div>
  );
}

/* ---------- 日期工具 ---------- */

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** 存储格式：YYYY-MM-DDTHH:mm（与 datetime-local 一致，方便 new Date() 直接解析） */
function formatValue(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** 显示格式：YYYY-MM-DD HH:mm */
function formatDisplay(d: Date): string {
  return formatValue(d).replace("T", " ");
}

function parseValue(text: string): Date | null {
  if (!text) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(text);
  if (!match) return null;
  const d = new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
  );
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** 周一起始，固定 6 行 × 7 列 = 42 天，头尾用相邻月份补齐 */
function buildCalendarDays(viewMonth: Date): Date[] {
  const first = startOfMonth(viewMonth);
  // getDay(): 0 = 周日；换成周一 = 0 的偏移
  const offset = (first.getDay() + 6) % 7;
  const days: Date[] = [];
  for (let i = 0; i < 42; i += 1) {
    days.push(new Date(first.getFullYear(), first.getMonth(), 1 - offset + i));
  }
  return days;
}
