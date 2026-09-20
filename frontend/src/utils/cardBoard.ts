/** 看板卡片：顺序和占列。span 按该看板的列数计，1 为最窄，等于列数为通栏。 */

export interface BoardSlot {
  id: string;
  span: number;
  /** 行首留白列。只有落到一行开头时生效，用来把左缘往右让。 */
  pad?: number;
  label?: string;
}

export interface PlacedSlot extends BoardSlot {
  col: number;
  row: number;
  span: number;
  pad: number;
}

export interface DropHint {
  targetId: string;
  place: "before" | "after";
  /** move 只改顺序；combine 并排；split 独占一行 */
  mode: "move" | "combine" | "split";
}

const KEY = "1pannel-card-boards";

function readAll(): Record<string, BoardSlot[]> {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, BoardSlot[]>;
    if (!parsed || typeof parsed !== "object") return {};
    return parsed;
  } catch {
    return {};
  }
}

function clampSpan(span: unknown, columns: number, fallback: number): number {
  const n = typeof span === "number" ? Math.round(span) : fallback;
  if (n < 1) return 1;
  if (n > columns) return columns;
  return n;
}

/** 已保存的顺序优先；新卡片补在末尾，删掉的卡片丢掉。 */
export function loadBoard(
  boardId: string,
  defaults: BoardSlot[],
  columns: number
): BoardSlot[] {
  const saved = readAll()[boardId];
  const known = new Map(defaults.map((d) => [d.id, d]));
  const used = new Set<string>();
  const out: BoardSlot[] = [];
  if (Array.isArray(saved)) {
    for (const item of saved) {
      if (!item || typeof item.id !== "string") continue;
      const base = known.get(item.id);
      if (!base || used.has(item.id)) continue;
      used.add(item.id);
      out.push({
        id: item.id,
        span: clampSpan(item.span, columns, base.span),
        pad: padNum(item),
        label: base.label,
      });
    }
  }
  for (const d of defaults) {
    if (used.has(d.id)) continue;
    out.push({
      id: d.id,
      span: clampSpan(d.span, columns, d.span),
      pad: padNum(d),
      label: d.label,
    });
  }
  return out;
}

export function saveBoard(boardId: string, slots: BoardSlot[]) {
  const all = readAll();
  all[boardId] = slots.map((s) => {
    const item: BoardSlot = { id: s.id, span: s.span };
    const pad = padNum(s);
    if (pad > 0) item.pad = pad;
    return item;
  });
  localStorage.setItem(KEY, JSON.stringify(all));
}

export function clearBoard(boardId: string) {
  const all = readAll();
  delete all[boardId];
  localStorage.setItem(KEY, JSON.stringify(all));
}

export function sameLayout(a: BoardSlot[], b: BoardSlot[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].id !== b[i].id || a[i].span !== b[i].span || padNum(a[i]) !== padNum(b[i])) {
      return false;
    }
  }
  return true;
}

function padNum(s: { pad?: number }): number {
  if (!s.pad || s.pad < 1) return 0;
  return Math.round(s.pad);
}

/** 按 4 列（或当前列数）从左往右排，排满换行。 */
export function placeBoard(slots: BoardSlot[], columns: number): PlacedSlot[] {
  const out: PlacedSlot[] = [];
  let cursor = 1;
  let row = 1;
  for (const s of slots) {
    let span = s.span;
    if (span < 1) span = 1;
    if (span > columns) span = columns;
    let pad = 0;
    if (cursor > 1 && cursor + span - 1 > columns) {
      row += 1;
      cursor = 1;
    }
    if (cursor === 1) {
      pad = padNum(s);
      if (pad + span > columns) pad = columns - span;
    }
    const col = cursor + pad;
    out.push({
      id: s.id,
      span,
      pad,
      col,
      row,
      label: s.label,
    });
    cursor = col + span;
    if (cursor > columns) {
      row += 1;
      cursor = 1;
    }
  }
  return out;
}

/**
 * 拉动左缘或右缘。右缘动右边，左缘动左边；同一行的邻卡把空出的列接过去。
 * nextSpan 是这张卡希望变成的列数。
 */
export function resizeEdge(
  slots: BoardSlot[],
  id: string,
  edge: "left" | "right",
  nextSpan: number,
  columns: number
): BoardSlot[] {
  const placed = placeBoard(slots, columns);
  const index = placed.findIndex((p) => p.id === id);
  if (index < 0) return slots;
  const card = placed[index];
  let span = Math.round(nextSpan);
  if (span < 1) span = 1;
  if (span > columns) span = columns;
  if (span === card.span) return slots;

  const next = slots.map((s) => ({ ...s, pad: padNum(s) }));
  const prev = index > 0 ? placed[index - 1] : null;
  const follower = placed[index + 1];
  const prevSame = !!prev && prev.row === card.row;
  const nextSame = !!follower && follower.row === card.row;

  if (edge === "right") {
    if (span > card.span) {
      const grow = span - card.span;
      const room = columns - (card.col + card.span - 1);
      if (nextSame) {
        const take = Math.min(grow, follower.span - 1);
        if (take < 1) return slots;
        next[index].span = card.span + take;
        next[index + 1].span = follower.span - take;
        return next;
      }
      const take = Math.min(grow, room);
      if (take < 1) return slots;
      next[index].span = card.span + take;
      return next;
    }
    const take = Math.min(card.span - span, card.span - 1);
    if (take < 1) return slots;
    next[index].span = card.span - take;
    if (nextSame) next[index + 1].span = follower.span + take;
    return next;
  }

  if (span > card.span) {
    const grow = span - card.span;
    if (prevSame && prev) {
      const take = Math.min(grow, prev.span - 1);
      if (take < 1) return slots;
      next[index].span = card.span + take;
      next[index - 1].span = prev.span - take;
      return next;
    }
    const take = Math.min(grow, card.pad);
    if (take < 1) return slots;
    next[index].span = card.span + take;
    next[index].pad = card.pad - take;
    return next;
  }

  const take = Math.min(card.span - span, card.span - 1);
  if (take < 1) return slots;
  next[index].span = card.span - take;
  if (prevSame && prev) {
    next[index - 1].span = prev.span + take;
    return next;
  }
  next[index].pad = card.pad + take;
  return next;
}

export function hintFromRect(rect: DOMRect, x: number, y: number, targetId: string): DropHint {
  const rx = rect.width > 0 ? (x - rect.left) / rect.width : 0.5;
  const ry = rect.height > 0 ? (y - rect.top) / rect.height : 0.5;
  if (rx < 0.28 || rx > 0.72) {
    return {
      targetId,
      place: rx < 0.5 ? "before" : "after",
      mode: "combine",
    };
  }
  if (ry < 0.22 || ry > 0.78) {
    return {
      targetId,
      place: ry < 0.5 ? "before" : "after",
      mode: "split",
    };
  }
  return {
    targetId,
    place: ry < 0.5 ? "before" : "after",
    mode: "move",
  };
}

export function applyDrop(
  slots: BoardSlot[],
  dragId: string,
  hint: DropHint,
  columns: number
): BoardSlot[] {
  if (dragId === hint.targetId) return slots;
  const next = slots.map((s) => ({ ...s }));
  const from = next.findIndex((s) => s.id === dragId);
  if (from < 0) return slots;
  const drag = next[from];
  next.splice(from, 1);
  const target = next.find((s) => s.id === hint.targetId);
  if (!target) return slots;
  if (hint.mode === "combine" && columns > 1) {
    const half = columns / 2;
    if (target.span >= columns && half >= 1) {
      drag.span = half;
      target.span = half;
    } else {
      drag.span = target.span;
    }
  } else if (hint.mode === "split") {
    drag.span = columns;
  }
  let to = next.findIndex((s) => s.id === hint.targetId);
  if (hint.place === "after") to += 1;
  next.splice(to, 0, drag);
  return next;
}

/** 窄屏把占列折进当前列数，不改已保存的布局。 */
export function shownSpan(span: number, nativeCols: number, liveCols: number): number {
  if (liveCols === nativeCols) return Math.min(Math.max(1, span), liveCols);
  const next = Math.round((span / nativeCols) * liveCols);
  if (next < 1) return 1;
  if (next > liveCols) return liveCols;
  return next;
}

/** 把当前屏上的列数折回看板原始列数再保存。 */
export function nativeSpan(shown: number, nativeCols: number, liveCols: number): number {
  if (liveCols === nativeCols) {
    if (shown < 1) return 1;
    if (shown > nativeCols) return nativeCols;
    return shown;
  }
  const next = Math.round((shown / liveCols) * nativeCols);
  if (next < 1) return 1;
  if (next > nativeCols) return nativeCols;
  return next;
}
