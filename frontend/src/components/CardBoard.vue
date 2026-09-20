<template>
  <div
    ref="root"
    class="card-board"
    :class="{ 'is-fill': fill, 'is-dragging': !!draggingId, 'is-resizing': !!resizingId }"
    :style="{ '--board-cols': String(liveCols) }"
  >
    <div
      v-for="slot in placed"
      :key="slot.id"
      class="card-board__cell"
      :class="{
        'is-dragging': draggingId === slot.id,
        'is-resizing': resizingId === slot.id,
        'is-resizing-left': resizingId === slot.id && resizingEdge === 'left',
        'is-resizing-right': resizingId === slot.id && resizingEdge === 'right',
      }"
      :data-card-id="slot.id"
      :style="cellStyle(slot)"
    >
      <button
        type="button"
        class="card-board__grip"
        aria-label="拖动卡片"
        v-tip="'拖动排序。松手后按预览的位置落下。'"
        @pointerdown="onGripDown($event, slot.id)"
      >
        ⋮⋮
      </button>
      <button
        v-if="columns > 1"
        type="button"
        class="card-board__resize card-board__resize--left"
        aria-label="拖动左缘"
        v-tip="'拖动左缘调整宽度'"
        @pointerdown.stop="onResizeDown($event, slot.id, 'left')"
      />
      <button
        v-if="columns > 1"
        type="button"
        class="card-board__resize card-board__resize--right"
        aria-label="拖动右缘"
        v-tip="'拖动右缘调整宽度'"
        @pointerdown.stop="onResizeDown($event, slot.id, 'right')"
      />
      <div v-if="resizingId === slot.id" class="card-board__width">
        {{ slot.span }} / {{ columns }} 列
      </div>
      <div class="card-board__body" :class="{ 'is-hidden': draggingId === slot.id }">
        <slot :name="slot.id" />
      </div>
      <div v-if="draggingId === slot.id" class="card-board__placeholder">
        <b>{{ labelOf(slot.id) }}</b>
        <span>{{ slot.span }} 列</span>
      </div>
    </div>
    <Teleport to="body">
      <div
        v-if="ghost"
        class="card-board__ghost"
        :style="{ left: ghost.x + 'px', top: ghost.y + 'px' }"
      >
        {{ ghost.label }}
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from "vue";
import {
  applyDrop,
  clearBoard,
  hintFromRect,
  loadBoard,
  placeBoard,
  resizeEdge,
  sameLayout,
  saveBoard,
  type BoardSlot,
  type DropHint,
  type PlacedSlot,
} from "@/utils/cardBoard";

const GAP = 12;

const props = withDefaults(
  defineProps<{
    boardId: string;
    columns: number;
    defaults: BoardSlot[];
    /** 监控页：格子吃满剩余高度 */
    fill?: boolean;
  }>(),
  { fill: false }
);

const root = ref<HTMLElement | null>(null);
const layout = ref<BoardSlot[]>(loadBoard(props.boardId, props.defaults, props.columns));
const draggingId = ref("");
const resizingId = ref("");
const resizingEdge = ref<"left" | "right" | "">("");
const hint = ref<DropHint | null>(null);
const ghost = ref<{ x: number; y: number; label: string } | null>(null);

let pending: { id: string; x: number; y: number } | null = null;
let resizeDrag: {
  id: string;
  edge: "left" | "right";
  startX: number;
  startSpan: number;
  startSlots: BoardSlot[];
  pitch: number;
} | null = null;

const liveCols = computed(() => props.columns);

const displayLayout = computed(() => {
  if (!draggingId.value || !hint.value) return layout.value;
  return applyDrop(layout.value, draggingId.value, hint.value, props.columns);
});

const placed = computed(() => placeBoard(displayLayout.value, props.columns));

const isDirty = computed(() => !sameLayout(layout.value, props.defaults));

function cellStyle(slot: PlacedSlot) {
  return {
    gridColumn: `${slot.col} / span ${slot.span}`,
    gridRow: String(slot.row),
  };
}

function labelOf(id: string): string {
  const found = layout.value.find((s) => s.id === id);
  if (found?.label) return found.label;
  const fallback = props.defaults.find((s) => s.id === id);
  if (fallback?.label) return fallback.label;
  return id;
}

function sameHint(a: DropHint | null, b: DropHint | null): boolean {
  if (!a || !b) return a === b;
  return a.targetId === b.targetId && a.place === b.place && a.mode === b.mode;
}

function reset() {
  clearBoard(props.boardId);
  layout.value = props.defaults.map((d) => ({
    id: d.id,
    span: d.span,
    label: d.label,
  }));
}

defineExpose({ reset, isDirty });

function onGripDown(e: PointerEvent, id: string) {
  if (e.button !== 0 || resizingId.value) return;
  const cell = (e.currentTarget as HTMLElement).closest(".card-board__cell");
  if (cell?.querySelector(".is-enlarged")) return;
  pending = { id, x: e.clientX, y: e.clientY };
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
  window.addEventListener("pointercancel", onUp);
}

function onMove(e: PointerEvent) {
  if (!pending && !draggingId.value) return;
  if (pending && !draggingId.value) {
    const dx = e.clientX - pending.x;
    const dy = e.clientY - pending.y;
    if (dx * dx + dy * dy < 36) return;
    draggingId.value = pending.id;
    document.body.style.cursor = "grabbing";
  }
  if (!draggingId.value) return;
  const hit = document.elementFromPoint(e.clientX, e.clientY);
  const cell = hit?.closest("[data-card-id]") as HTMLElement | null;
  let nextHint = hint.value;
  if (!cell || !root.value?.contains(cell)) {
    nextHint = null;
  } else {
    const id = cell.dataset.cardId || "";
    if (id && id !== draggingId.value) {
      nextHint = hintFromRect(cell.getBoundingClientRect(), e.clientX, e.clientY, id);
    }
  }
  if (!sameHint(hint.value, nextHint)) hint.value = nextHint;
  ghost.value = {
    x: e.clientX + 14,
    y: e.clientY + 14,
    label: labelOf(draggingId.value),
  };
}

function onUp() {
  window.removeEventListener("pointermove", onMove);
  window.removeEventListener("pointerup", onUp);
  window.removeEventListener("pointercancel", onUp);
  if (!resizingId.value) document.body.style.cursor = "";
  if (draggingId.value && hint.value) {
    layout.value = applyDrop(layout.value, draggingId.value, hint.value, props.columns);
    saveBoard(props.boardId, layout.value);
  }
  pending = null;
  draggingId.value = "";
  hint.value = null;
  ghost.value = null;
}

function onResizeDown(e: PointerEvent, id: string, edge: "left" | "right") {
  if (e.button !== 0 || draggingId.value) return;
  const slot = layout.value.find((s) => s.id === id);
  if (!slot || !root.value || props.columns < 2) return;
  const cols = props.columns;
  const colW = (root.value.clientWidth - GAP * (cols - 1)) / cols;
  resizeDrag = {
    id,
    edge,
    startX: e.clientX,
    startSpan: slot.span,
    startSlots: layout.value.map((s) => ({ ...s })),
    pitch: colW + GAP,
  };
  resizingId.value = id;
  resizingEdge.value = edge;
  document.body.style.cursor = "ew-resize";
  window.addEventListener("pointermove", onResizeMove);
  window.addEventListener("pointerup", onResizeUp);
  window.addEventListener("pointercancel", onResizeUp);
}

function onResizeMove(e: PointerEvent) {
  if (!resizeDrag) return;
  const dx = e.clientX - resizeDrag.startX;
  const dir = resizeDrag.edge === "right" ? 1 : -1;
  let next = Math.round(resizeDrag.startSpan + (dir * dx) / resizeDrag.pitch);
  if (next < 1) next = 1;
  if (next > props.columns) next = props.columns;
  layout.value = resizeEdge(
    resizeDrag.startSlots,
    resizeDrag.id,
    resizeDrag.edge,
    next,
    props.columns
  );
}

function onResizeUp() {
  window.removeEventListener("pointermove", onResizeMove);
  window.removeEventListener("pointerup", onResizeUp);
  window.removeEventListener("pointercancel", onResizeUp);
  document.body.style.cursor = "";
  if (resizingId.value) saveBoard(props.boardId, layout.value);
  resizeDrag = null;
  resizingId.value = "";
  resizingEdge.value = "";
}

onBeforeUnmount(() => {
  onUp();
  onResizeUp();
});
</script>

<style lang="scss">
.card-board__ghost {
  position: fixed;
  z-index: 4000;
  pointer-events: none;
  padding: 6px 10px;
  border-radius: var(--m3-shape-s, 8px);
  background: var(--m3-card, #fff);
  color: var(--m3-on-surface, #1d1b20);
  font-size: 13px;
  font-weight: 650;
  box-shadow:
    inset 0 0 0 1px var(--m3-primary, #005eeb),
    0 8px 24px rgba(0, 0, 0, 0.12);
}
</style>

<style scoped lang="scss">
.card-board {
  display: grid;
  grid-template-columns: repeat(var(--board-cols), minmax(0, 1fr));
  gap: 12px;
  align-items: start;
}

.card-board.is-fill {
  flex: 1;
  min-height: 0;
  align-items: stretch;
  grid-auto-rows: minmax(180px, 1fr);
}

.card-board__cell {
  position: relative;
  min-width: 0;
}

.card-board.is-fill .card-board__cell {
  min-height: 0;
  height: 100%;
  display: flex;
  flex-direction: column;
}

.card-board__body {
  min-width: 0;
  height: 100%;
}

.card-board__body.is-hidden {
  visibility: hidden;
}

.card-board.is-fill .card-board__body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.card-board.is-fill .card-board__body > :deep(*) {
  flex: 1;
  min-height: 0;
}

.card-board__placeholder {
  position: absolute;
  inset: 0;
  z-index: 4;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  border: 1.5px dashed var(--m3-primary);
  border-radius: var(--m3-shape-m);
  background: color-mix(in srgb, var(--m3-primary) 10%, var(--m3-card));
  color: var(--m3-primary);

  b {
    font-size: 14px;
    font-weight: 650;
  }

  span {
    font-size: 12px;
  }
}

.card-board__grip {
  position: absolute;
  z-index: 6;
  top: 6px;
  left: 4px;
  width: 22px;
  height: 22px;
  padding: 0;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--m3-on-surface-variant);
  font-size: 12px;
  line-height: 22px;
  letter-spacing: -2px;
  cursor: grab;

  &:hover {
    color: var(--m3-on-surface);
    background: color-mix(in srgb, var(--m3-on-surface) 8%, transparent);
  }
}

.card-board.is-dragging .card-board__grip {
  cursor: grabbing;
}

.card-board__resize {
  position: absolute;
  z-index: 6;
  top: 18px;
  bottom: 18px;
  width: 12px;
  padding: 0;
  border: 0;
  background: transparent;
  opacity: 0;
  pointer-events: auto;
  cursor: ew-resize;
  transition: opacity 120ms ease;

  &::after {
    content: "";
    position: absolute;
    top: 0;
    bottom: 0;
    width: 3px;
    border-radius: 999px;
    background: var(--m3-outline);
    opacity: 0.85;
  }

  &:hover,
  &:focus-visible {
    opacity: 1;
  }

  &:hover::after,
  &:focus-visible::after {
    background: var(--m3-primary);
    opacity: 1;
  }
}

.card-board__resize--left {
  left: -2px;

  &::after {
    left: 4px;
  }
}

.card-board__resize--right {
  right: -2px;

  &::after {
    right: 4px;
  }
}

.card-board__cell.is-resizing-left .card-board__resize--left,
.card-board__cell.is-resizing-right .card-board__resize--right {
  opacity: 1;
}

.card-board__cell.is-resizing-left .card-board__resize--left::after,
.card-board__cell.is-resizing-right .card-board__resize--right::after {
  background: var(--m3-primary);
  opacity: 1;
}

@media (prefers-reduced-motion: reduce) {
  .card-board__resize {
    transition: none;
  }
}

.card-board__width {
  position: absolute;
  z-index: 7;
  top: 8px;
  right: 16px;
  padding: 2px 8px;
  border-radius: var(--m3-shape-full);
  background: var(--m3-primary);
  color: #fff;
  font-size: 12px;
  pointer-events: none;
}

.card-board__cell :deep(.card__head),
.card-board__cell :deep(.enl-head-zone) {
  padding-left: 22px;
  padding-right: 16px;
}
</style>
