<template>
  <div
    v-if="node.kind === 'leaf'"
    class="pane-leaf"
    :class="{ 'is-focused': showFocus && node.id === focusedId }"
    @pointerdown="emit('focus', node.id)"
    @pointermove="onPointerMove"
    @dragover.prevent="onDragOver"
    @dragleave="onDragLeave"
    @drop.prevent="onDrop"
  >
    <header
      v-if="showHead"
      class="pane-head drag-region"
      @dblclick="chrome.toggleMaximise()"
      @contextmenu.prevent="chrome.openMenu($event)"
    >
      <div
        class="pane-tab-card no-drag"
        draggable="true"
        :title="'拖动调整 ' + node.host"
        @dragstart.stop="onGrabStart"
        @pointerdown.stop="emit('focus', node.id)"
        @dblclick.stop
        @contextmenu.stop
      >
        <span class="pane-head__host">{{ node.host }}</span>
        <span v-if="cwdById?.[node.id]" class="pane-head__cwd">{{ cwdById[node.id] }}</span>
        <span class="pane-head__status" :class="'is-' + faceOf(node.id)">
          {{ paneFaceLabel(faceOf(node.id)) }}
        </span>
      </div>
      <button
        v-if="needsRetry(node.id)"
        type="button"
        class="pane-head__re no-drag"
        title="重新挂上这个窗格，不关闭其它会话"
        @pointerdown.stop
        @click.stop="emit('retry', node.id)"
        @dblclick.stop
        @contextmenu.stop
      >
        重试
      </button>
      <button
        type="button"
        class="pane-head__x no-drag"
        title="关闭这个窗格，其它窗格的连接还在"
        @pointerdown.stop
        @click.stop="emit('close', node.id)"
        @dblclick.stop
        @contextmenu.stop
      >
        ✕
      </button>
    </header>
    <div
      class="term-body pane-slot"
      :ref="slotRef(node.id)"
      @contextmenu.prevent
    >
      <span
        v-if="echoBadge(node.id) !== null"
        class="pane-echo-badge"
        :class="echoBadge(node.id)! >= 150 ? 'is-bad' : 'is-warn'"
        :title="'按键到回显的延迟（近 32 次采样的 p95），包含 IPC 与 SSH 往返，不含界面绘制'"
      >
        回显 {{ echoBadge(node.id) }}ms
      </span>
      <div v-if="needsRetry(node.id)" class="pane-fail">
        <p>{{ paneFailText(faceOf(node.id)) }}</p>
        <button type="button" @click.stop="emit('retry', node.id)">重试</button>
      </div>
    </div>
    <div v-if="dropSide" class="drop-hint" :class="'is-' + dropSide" />
  </div>
  <div
    v-else
    class="pane-split"
    :class="node.dir === 'row' ? 'is-row' : 'is-col'"
    :data-split-id="node.id"
  >
    <TermPaneTree
      class="pane-child"
      :style="{ flex: `${node.ratio} 1 0%` }"
      :node="node.a"
      :focused-id="focusedId"
      :show-focus="showFocus"
      :show-head="showHead"
      :cwd-by-id="cwdById"
      :faces="faces"
      @focus="emit('focus', $event)"
      @hover="emit('hover', $event)"
      @slot="(id, el) => emit('slot', id, el)"
      @ratio="(id, ratio) => emit('ratio', id, ratio)"
      @drag-end="emit('drag-end')"
      @close="emit('close', $event)"
      @retry="emit('retry', $event)"
      @reconnect="emit('reconnect', $event)"
      @move="(paneId, targetId, side) => emit('move', paneId, targetId, side)"
      @adopt="(sessionId, host, targetId, side) => emit('adopt', sessionId, host, targetId, side)"
    />
    <div
      class="pane-grip"
      @pointerdown.stop.prevent="onGripDown"
    />
    <TermPaneTree
      class="pane-child"
      :style="{ flex: `${1 - node.ratio} 1 0%` }"
      :node="node.b"
      :focused-id="focusedId"
      :show-focus="showFocus"
      :show-head="showHead"
      :cwd-by-id="cwdById"
      :faces="faces"
      @focus="emit('focus', $event)"
      @hover="emit('hover', $event)"
      @slot="(id, el) => emit('slot', id, el)"
      @ratio="(id, ratio) => emit('ratio', id, ratio)"
      @drag-end="emit('drag-end')"
      @close="emit('close', $event)"
      @retry="emit('retry', $event)"
      @reconnect="emit('reconnect', $event)"
      @move="(paneId, targetId, side) => emit('move', paneId, targetId, side)"
      @adopt="(sessionId, host, targetId, side) => emit('adopt', sessionId, host, targetId, side)"
    />
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";
import type { PaneNode, PaneSide } from "@/views/termPanes";
import { paneFaceLabel, paneFailText, type PaneFace } from "@/views/termMount";
import { useChromeDrag } from "@/composables/useChromeDrag";

const props = withDefaults(
  defineProps<{
    node: PaneNode;
    focusedId: string;
    showFocus: boolean;
    showHead?: boolean;
    cwdById?: Record<string, string>;
    faces?: Record<string, PaneFace>;
    /** 各窗格输入回显延迟 p95（毫秒），≥40 才显示徽标；诊断终端卡顿用 */
    echoById?: Record<string, number>;
  }>(),
  { cwdById: () => ({}), showHead: false, faces: () => ({}), echoById: () => ({}) }
);
const chrome = useChromeDrag();

const emit = defineEmits<{
  focus: [id: string];
  slot: [id: string, el: HTMLElement | null];
  ratio: [id: string, ratio: number];
  "drag-end": [];
  hover: [id: string];
  close: [id: string];
  retry: [id: string];
  reconnect: [id: string];
  move: [paneId: string, targetId: string, side: PaneSide];
  adopt: [sessionId: string, host: string, targetId: string, side: PaneSide];
}>();

const dropSide = ref<PaneSide | "">("");

function faceOf(id: string): PaneFace {
  return props.faces[id] || "connecting";
}

function needsRetry(id: string): boolean {
  const face = faceOf(id);
  return face === "down" || face === "blind" || face === "missing";
}

function echoBadge(id: string): number | null {
  const ms = props.echoById[id];
  if (ms === undefined || ms < 40) return null;
  return Math.round(ms);
}

function onPointerMove() {
  if (props.node.kind !== "leaf") return;
  emit("hover", props.node.id);
}

function onSlot(id: string, el: unknown) {
  if (el == null) {
    emit("slot", id, null);
    return;
  }
  if (el instanceof HTMLElement) emit("slot", id, el);
}

const slotFns = new Map<string, (el: unknown) => void>();
function slotRef(id: string) {
  let fn = slotFns.get(id);
  if (!fn) {
    fn = (el: unknown) => onSlot(id, el);
    slotFns.set(id, fn);
  }
  return fn;
}

function onGripDown(e: PointerEvent) {
  if (props.node.kind !== "split") return;
  const splitEl = (e.currentTarget as HTMLElement).parentElement;
  if (!splitEl) return;
  const dir = props.node.dir;
  const rect = splitEl.getBoundingClientRect();
  const move = (ev: PointerEvent) => {
    const size = dir === "row" ? rect.width : rect.height;
    if (size < 1) return;
    const pos = dir === "row" ? ev.clientX - rect.left : ev.clientY - rect.top;
    emit("ratio", props.node.id, pos / size);
  };
  const up = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    emit("drag-end");
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
}

function onGrabStart(e: DragEvent) {
  if (props.node.kind !== "leaf" || !e.dataTransfer) return;
  e.dataTransfer.effectAllowed = "move";
  e.dataTransfer.setData("application/x-pane-id", props.node.id);
  e.dataTransfer.setData("text/plain", props.node.id);
}

function nearestSide(e: DragEvent): PaneSide | "" {
  const el = e.currentTarget;
  if (!(el instanceof HTMLElement)) return "";
  const rect = el.getBoundingClientRect();
  if (rect.width < 1 || rect.height < 1) return "";
  const x = (e.clientX - rect.left) / rect.width;
  const y = (e.clientY - rect.top) / rect.height;
  const distLeft = x;
  const distRight = 1 - x;
  const distUp = y;
  const distDown = 1 - y;
  const min = Math.min(distLeft, distRight, distUp, distDown);
  if (min > 0.34) return "";
  if (min === distLeft) return "left";
  if (min === distRight) return "right";
  if (min === distUp) return "up";
  return "down";
}

function onDragOver(e: DragEvent) {
  dropSide.value = nearestSide(e);
  if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
}

function onDragLeave(e: DragEvent) {
  const next = e.relatedTarget;
  const cur = e.currentTarget;
  if (cur instanceof HTMLElement && next instanceof Node && cur.contains(next)) return;
  dropSide.value = "";
}

function onDrop(e: DragEvent) {
  const side = dropSide.value;
  dropSide.value = "";
  if (!side || props.node.kind !== "leaf" || !e.dataTransfer) return;
  const paneId = e.dataTransfer.getData("application/x-pane-id");
  if (paneId) {
    emit("move", paneId, props.node.id, side);
    return;
  }
  const sessionId = e.dataTransfer.getData("application/x-term-session");
  const host = e.dataTransfer.getData("application/x-term-host");
  if (sessionId && host) {
    emit("adopt", sessionId, host, props.node.id, side);
  }
}
</script>

<style scoped lang="scss">
.pane-split {
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  display: flex;

  &.is-row {
    flex-direction: row;
    > .pane-grip {
      cursor: col-resize;
    }
  }

  &.is-col {
    flex-direction: column;
    > .pane-grip {
      cursor: row-resize;
    }
  }
}

.pane-child {
  min-width: 0;
  min-height: 0;
  display: flex;
  overflow: hidden;
}

.pane-grip {
  flex: 0 0 4px;
  background: #1c1c1c;
  z-index: 2;

  &:hover {
    background: var(--m3-primary);
  }
}

.pane-leaf {
  position: relative;
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: #000;

  &.is-focused {
    box-shadow: inset 0 0 0 1px var(--m3-primary);
  }
}

.pane-head {
  flex: 0 0 26px;
  height: 26px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 8px 0 10px;
  background: #111111;
  color: #e8e8e8;
  border-bottom: 1px solid #222222;
  cursor: default;
  user-select: none;
  z-index: 3;
}

.pane-tab-card {
  flex: 0 1 auto;
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  max-width: min(100%, 620px);
  height: 22px;
  padding: 0 8px;
  box-sizing: border-box;
  border: 1px solid #2b2b2b;
  border-radius: 5px;
  background: #171717;
  cursor: grab;

  &:hover {
    background: #1e1e1e;
    border-color: #3a3a3a;
  }

  &:active {
    cursor: grabbing;
  }
}

.pane-head__logo {
  flex-shrink: 0;
}

.pane-head__host {
  flex: 0 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  font-weight: 600;
}

.pane-head__status {
  flex-shrink: 0;
  font-size: 11px;
  color: #9a9a9a;

  &.is-ready {
    color: #8fdbb0;
  }

  &.is-down,
  &.is-blind,
  &.is-missing {
    color: #f0a05a;
  }
}

.pane-head__meta {
  flex-shrink: 0;
  font-size: 12px;
  color: #9a9a9a;
}

.pane-head__cwd {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  color: #7dcea0;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}

.pane-head__re,
.pane-head__x {
  flex-shrink: 0;
  height: 22px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: #c8c8c8;
  cursor: pointer;

  &:hover {
    color: #fff;
    background: rgba(255, 255, 255, 0.08);
  }
}

.pane-head__re {
  padding: 0 6px;
  font-size: 12px;
  line-height: 22px;
}

.pane-head__x {
  width: 22px;
}

.drop-hint {
  position: absolute;
  z-index: 5;
  pointer-events: none;
  background: color-mix(in srgb, var(--m3-primary) 38%, transparent);

  &.is-left {
    left: 0;
    top: 0;
    bottom: 0;
    width: 50%;
  }
  &.is-right {
    right: 0;
    top: 0;
    bottom: 0;
    width: 50%;
  }
  &.is-up {
    left: 0;
    right: 0;
    top: 0;
    height: 50%;
  }
  &.is-down {
    left: 0;
    right: 0;
    bottom: 0;
    height: 50%;
  }
}

.pane-slot {
  position: relative;
  flex: 1 1 auto;
  min-height: 0;
  min-width: 0;
  overflow: hidden;
  background: #000;
  user-select: text;

  :deep(.xterm),
  :deep(.xterm-viewport),
  :deep(.xterm-screen) {
    width: 100% !important;
    height: 100% !important;
  }

  :deep(.xterm) {
    padding: 8px 12px;
    box-sizing: border-box;
  }
}

.pane-echo-badge {
  position: absolute;
  top: 6px;
  right: 8px;
  z-index: 4;
  padding: 1px 7px;
  border-radius: 999px;
  font-size: 11px;
  line-height: 18px;
  pointer-events: none;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;

  &.is-warn {
    background: rgba(253, 151, 31, 0.18);
    color: #fd971f;
  }

  &.is-bad {
    background: rgba(249, 38, 114, 0.22);
    color: #f92672;
  }
}

.pane-fail {
  position: absolute;
  inset: 0;
  z-index: 4;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 16px;
  background: rgba(8, 8, 8, 0.92);
  color: #ececec;
  text-align: center;

  p {
    margin: 0;
    max-width: 280px;
    font-size: 13px;
    line-height: 1.5;
  }

  button {
    height: 28px;
    padding: 0 12px;
    border: 1px solid #3a3a3a;
    border-radius: 6px;
    background: #1c1c1c;
    color: #ececec;
    cursor: pointer;

    &:hover {
      border-color: #8fdbb0;
      color: #8fdbb0;
    }
  }
}
</style>
