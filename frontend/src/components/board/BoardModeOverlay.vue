<template>
  <div
    class="board-mode"
    :class="{ 'is-embedded': embedded }"
    :role="embedded ? undefined : 'dialog'"
    :aria-modal="embedded ? undefined : 'true'"
    aria-label="看板模式"
  >
    <header v-if="!embedded" class="board-mode__bar drag-region">
      <div class="board-mode__identity">
        <span class="board-mode__live-mark" aria-hidden="true" />
        <div class="board-mode__titles">
          <div class="board-mode__group-line">
            <span class="board-mode__group">{{ groupName || "分组" }}</span>
            <span class="board-mode__count">{{ hosts.length }} 台主机</span>
          </div>
          <span class="board-mode__mode">实时运维监控</span>
        </div>
      </div>

      <div class="board-mode__center">
        <span v-if="boardTitle" class="board-mode__board-title">{{ boardTitle }}</span>
        <span v-else class="board-mode__board-title board-mode__board-title--fallback">
          运维监控看板
        </span>
      </div>

      <div class="board-mode__right">
        <span class="board-mode__last-update">{{ lastUpdateText }}</span>
        <button
          type="button"
          class="board-mode__fs-btn no-drag"
          @click="toggleFullscreen"
        >
          {{ isFullscreen ? "退出全屏" : "全屏" }}
        </button>
        <time class="board-mode__clock mono" :datetime="clockIso">{{ clockText }}</time>
      </div>
    </header>

    <BoardSummaryStrip :summary="summary" :embedded="embedded" />

    <main ref="gridRef" class="board-mode__grid" :style="gridStyle">
      <template v-if="hosts.length">
        <HostBoardCard
          v-for="h in hosts"
          :key="h.name"
          :name="h.name"
          :address="h.hostName || ''"
          :loading="cardOf(h.name).loading"
          :overview="cardOf(h.name).overview"
          :disks="cardOf(h.name).disks"
          :error="cardOf(h.name).error"
          :cpu-trend="trendOf(h.name).cpu"
          :mem-trend="trendOf(h.name).mem"
          :app-sub-items="cardOf(h.name).appSubItems"
          :app-sub-loading="cardOf(h.name).appSubLoading"
          :updated-at="cardOf(h.name).updatedAt"
          :density="cardDensity"
          @open="onOpen"
        />
      </template>
      <div v-else class="board-mode__empty">
        <span class="board-mode__empty-mark" aria-hidden="true">—</span>
        <strong>当前分组暂无主机</strong>
        <span>添加主机后，实时监控数据会显示在这里</span>
      </div>
    </main>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from "vue";
import { Events, Window } from "@wailsio/runtime";
import type { sshconfig } from "@/api";
import BoardSummaryStrip from "@/components/board/BoardSummaryStrip.vue";
import HostBoardCard from "@/components/board/HostBoardCard.vue";
import {
  boardDensityOf,
  pickBoardGrid,
  summarizeBoardCards,
  type BoardAppSubItem as BoardAppSubItemModel,
  type BoardGridShape,
  type BoardHostCard as BoardHostCardModel,
  type BoardHostTrend as BoardHostTrendModel,
} from "@/utils/boardModel";

export type BoardAppSubItem = BoardAppSubItemModel;
export type BoardHostCard = BoardHostCardModel;
export type BoardHostTrend = BoardHostTrendModel;

const props = withDefaults(
  defineProps<{
    groupName: string;
    /** 看板正中标题；空则使用默认标题。 */
    boardTitle?: string;
    hosts: sshconfig.HostConfig[];
    cards: Record<string, BoardHostCard>;
    /** 每主机近 1h 趋势；缺省则空数组。 */
    trends?: Record<string, BoardHostTrend>;
    /** 嵌入分组页时隐藏独立窗口 chrome，但保留统一摘要和卡片网格。 */
    embedded?: boolean;
  }>(),
  { embedded: false }
);

const emit = defineEmits<{
  exit: [];
  openHost: [name: string];
}>();

const emptyCard: BoardHostCard = { loading: true };
const gridRef = ref<HTMLElement | null>(null);
const viewport = reactive({ width: 0, height: 0 });
const nowMs = ref(Date.now());
const isFullscreen = ref(false);
let clockTimer: ReturnType<typeof setInterval> | null = null;
let resizeObserver: ResizeObserver | null = null;
let resizeHandler: (() => void) | null = null;
const fsEventOffs: (() => void)[] = [];

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function formatBoardClock(ms: number): string {
  const d = new Date(ms);
  return (
    `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ` +
    `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`
  );
}

function formatTime(ms?: number): string {
  if (!ms) return "等待数据";
  const d = new Date(ms);
  return `数据更新 ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

const clockText = computed(() => formatBoardClock(nowMs.value));
const clockIso = computed(() => new Date(nowMs.value).toISOString());
const summary = computed(() => summarizeBoardCards(props.cards, nowMs.value));
const latestUpdate = computed(() => {
  let latest = 0;
  for (const card of Object.values(props.cards)) {
    latest = Math.max(latest, card.updatedAt || 0);
  }
  return latest;
});
const lastUpdateText = computed(() => formatTime(latestUpdate.value));

const gridShape = computed<BoardGridShape>(() =>
  pickBoardGrid(props.hosts.length, viewport.width, viewport.height)
);
const cardDensity = computed(() => boardDensityOf(gridShape.value));
const gridStyle = computed(() => ({
  "--board-cols": String(gridShape.value.cols),
  "--board-rows": String(gridShape.value.rows),
}));

function startClock() {
  stopClock();
  nowMs.value = Date.now();
  clockTimer = setInterval(() => {
    nowMs.value = Date.now();
  }, props.embedded ? 5000 : 1000);
}

function stopClock() {
  if (clockTimer != null) {
    clearInterval(clockTimer);
    clockTimer = null;
  }
}

function cardOf(name: string): BoardHostCard {
  return props.cards[name] || emptyCard;
}

function trendOf(name: string): BoardHostTrend {
  return props.trends?.[name] || { cpu: [], mem: [] };
}

function onOpen(name: string) {
  emit("openHost", name);
}

async function toggleFullscreen() {
  if (props.embedded) return;
  try {
    const fs = await Window.IsFullscreen();
    if (fs) {
      await Window.UnFullscreen();
      isFullscreen.value = false;
    } else {
      await Window.Fullscreen();
      isFullscreen.value = true;
    }
  } catch {
    /* 忽略：保留当前窗口状态 */
  }
}

function onKeydown(e: KeyboardEvent) {
  if (props.embedded) return;
  if (e.key === "Escape") {
    e.preventDefault();
    emit("exit");
    return;
  }
  if (e.key === "f" || e.key === "F" || e.key === "F11") {
    e.preventDefault();
    void toggleFullscreen();
  }
}

function observeGrid() {
  const el = gridRef.value;
  if (!el) return;
  const update = () => {
    const rect = el.getBoundingClientRect();
    viewport.width = Math.round(rect.width);
    viewport.height = Math.round(rect.height);
  };
  update();
  if (typeof ResizeObserver !== "undefined") {
    resizeObserver = new ResizeObserver(update);
    resizeObserver.observe(el);
  } else {
    resizeHandler = update;
    window.addEventListener("resize", resizeHandler);
  }
}

function stopObservingGrid() {
  resizeObserver?.disconnect();
  resizeObserver = null;
  if (resizeHandler) {
    window.removeEventListener("resize", resizeHandler);
    resizeHandler = null;
  }
}

async function syncFullscreenFlag() {
  try {
    isFullscreen.value = await Window.IsFullscreen();
  } catch {
    isFullscreen.value = false;
  }
}

onMounted(() => {
  observeGrid();
  startClock();
  if (props.embedded) return;
  window.addEventListener("keydown", onKeydown);
  fsEventOffs.push(
    Events.On(Events.Types.Common.WindowFullscreen, () => {
      isFullscreen.value = true;
    })
  );
  fsEventOffs.push(
    Events.On(Events.Types.Common.WindowUnFullscreen, () => {
      isFullscreen.value = false;
    })
  );
  void syncFullscreenFlag();
});

onBeforeUnmount(() => {
  stopClock();
  stopObservingGrid();
  window.removeEventListener("keydown", onKeydown);
  fsEventOffs.forEach((off) => off());
  fsEventOffs.length = 0;
});
</script>

<style scoped lang="scss">
.board-mode {
  --board-canvas: #07131b;
  --board-surface: #10232d;
  --board-text: #edf7f5;
  --board-muted: #8faeb2;
  --board-line: rgba(160, 207, 213, 0.16);
  --board-healthy: #51d5b0;
  --board-attention: #eab25f;
  --board-critical: #ff6673;

  position: fixed;
  inset: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px 20px 20px;
  box-sizing: border-box;
  overflow: hidden;
  background:
    linear-gradient(90deg, rgba(81, 213, 176, 0.025) 1px, transparent 1px) 0 0 / 64px 64px,
    linear-gradient(rgba(81, 213, 176, 0.018) 1px, transparent 1px) 0 0 / 64px 64px,
    var(--board-canvas);
  color: var(--board-text);
  font-family: "SF Pro Display", "PingFang SC", "Helvetica Neue", sans-serif;
  user-select: none;
  -webkit-user-select: none;
}

.board-mode.is-embedded {
  position: relative;
  inset: auto;
  width: 100%;
  height: 100%;
  min-height: 0;
  padding: 12px;
  gap: 10px;
  border: 1px solid rgba(160, 207, 213, 0.12);
  background:
    linear-gradient(90deg, rgba(81, 213, 176, 0.018) 1px, transparent 1px) 0 0 / 56px 56px,
    linear-gradient(rgba(81, 213, 176, 0.012) 1px, transparent 1px) 0 0 / 56px 56px,
    var(--board-canvas);
}

.board-mode__bar {
  flex-shrink: 0;
  display: grid;
  grid-template-columns: minmax(220px, 1fr) minmax(220px, 1.2fr) minmax(300px, 1fr);
  align-items: center;
  gap: 20px;
  min-height: 54px;
  border-bottom: 1px solid var(--board-line);
}

.board-mode__identity,
.board-mode__right,
.board-mode__group-line {
  display: flex;
  align-items: center;
}

.board-mode__identity {
  min-width: 0;
  gap: 11px;
}

.board-mode__live-mark {
  flex: 0 0 auto;
  width: 9px;
  height: 30px;
  background: var(--board-healthy);
  box-shadow: 0 0 16px rgba(81, 213, 176, 0.5);
}

.board-mode__titles {
  min-width: 0;
}

.board-mode__group-line {
  min-width: 0;
  gap: 10px;
}

.board-mode__group,
.board-mode__board-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.board-mode__group {
  color: var(--board-text);
  font-size: 21px;
  font-weight: 700;
  letter-spacing: 0.01em;
}

.board-mode__count,
.board-mode__mode,
.board-mode__last-update {
  color: var(--board-muted);
  font-size: 11px;
}

.board-mode__count {
  font-family: "SF Mono", "JetBrains Mono", ui-monospace, monospace;
  font-variant-numeric: tabular-nums;
}

.board-mode__mode {
  display: block;
  margin-top: 3px;
  letter-spacing: 0.12em;
}

.board-mode__center {
  min-width: 0;
  text-align: center;
}

.board-mode__board-title {
  display: block;
  color: var(--board-text);
  font-size: clamp(18px, 1.25vw, 26px);
  font-weight: 650;
  letter-spacing: 0.1em;
}

.board-mode__board-title--fallback {
  color: #a6c1c2;
  font-size: clamp(15px, 1vw, 20px);
  font-weight: 500;
}

.board-mode__right {
  justify-content: flex-end;
  gap: 12px;
  min-width: 0;
}

.board-mode__last-update {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.board-mode__fs-btn {
  appearance: none;
  flex-shrink: 0;
  min-height: 28px;
  padding: 0 9px;
  border: 1px solid rgba(160, 207, 213, 0.25);
  border-radius: 3px;
  background: rgba(16, 35, 45, 0.8);
  color: #c7dad9;
  font: 500 12px/1 "SF Pro Display", "PingFang SC", sans-serif;
  cursor: pointer;
}

.board-mode__fs-btn:hover {
  border-color: var(--board-healthy);
  color: var(--board-text);
}

.board-mode__fs-btn:focus-visible {
  outline: 2px solid var(--board-healthy);
  outline-offset: 3px;
}

.board-mode__clock {
  flex-shrink: 0;
  color: #d0dfdd;
  font-size: 14px;
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.02em;
}

.mono {
  font-family: "SF Mono", "JetBrains Mono", ui-monospace, monospace;
}

.board-mode__grid {
  --board-cols: 1;
  --board-rows: 1;

  flex: 1;
  min-width: 0;
  min-height: 0;
  display: grid;
  grid-template-columns: repeat(var(--board-cols), minmax(0, 1fr));
  grid-template-rows: repeat(var(--board-rows), minmax(150px, 1fr));
  gap: 12px;
  align-content: stretch;
  overflow: auto;
  scrollbar-width: thin;
  scrollbar-color: rgba(81, 213, 176, 0.38) transparent;
}

.board-mode__empty {
  grid-column: 1 / -1;
  min-height: 240px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: var(--board-muted);
}

.board-mode__empty-mark {
  color: var(--board-healthy);
  font: 700 28px/1 "SF Mono", ui-monospace, monospace;
}

.board-mode__empty strong {
  color: var(--board-text);
  font-size: 18px;
}

.board-mode__empty span:last-child {
  font-size: 12px;
}

@media (max-width: 1200px) {
  .board-mode {
    padding-inline: 14px;
  }

  .board-mode__bar {
    grid-template-columns: minmax(180px, 1fr) minmax(160px, 1fr) minmax(240px, 1fr);
    gap: 12px;
  }

  .board-mode__last-update {
    display: none;
  }
}

@media (max-width: 760px) {
  .board-mode__bar {
    grid-template-columns: 1fr auto;
  }

  .board-mode__center {
    display: none;
  }

  .board-mode__right {
    gap: 7px;
  }

  .board-mode__clock {
    font-size: 11px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .board-mode__live-mark {
    box-shadow: none;
  }
}
</style>
