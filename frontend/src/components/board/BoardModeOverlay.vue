<template>
  <div
    class="board-mode is-dark"
    role="dialog"
    aria-modal="true"
    aria-label="看板模式"
  >
    <header class="board-mode__bar lg-chrome drag-region">
      <div class="board-mode__titles">
        <span class="board-mode__group">{{ groupName || "分组" }}</span>
        <span class="board-mode__count">{{ hosts.length }} 台</span>
      </div>
      <div class="board-mode__center">
        <span v-if="boardTitle" class="board-mode__board-title">{{
          boardTitle
        }}</span>
      </div>
      <div class="board-mode__right">
        <button
          type="button"
          class="board-mode__fs-btn no-drag"
          @click="toggleFullscreen"
        >
          {{ isFullscreen ? "退出全屏" : "全屏" }}
        </button>
        <time class="board-mode__clock mono" :datetime="clockIso">{{
          clockText
        }}</time>
      </div>
    </header>

    <div class="board-mode__grid" :style="gridStyle">
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
        :density="cardDensity"
        @open="onOpen"
      />
      <div
        v-for="i in emptySlotCount"
        :key="'empty-' + i"
        class="board-mode__slot--empty"
        aria-hidden="true"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { Events, Window } from "@wailsio/runtime";
import type { monitor, sshconfig } from "@/api";
import HostBoardCard from "@/components/board/HostBoardCard.vue";

export interface BoardAppSubItem {
  name: string;
  count: number;
}

export interface BoardHostCard {
  loading: boolean;
  overview?: monitor.Overview | null;
  disks?: monitor.DiskInfo[] | null;
  error?: string | null;
  /** 已订阅微服务及实例数；null 表示从未配置、不显示该行；[] 表示配置过但当前为 0 */
  appSubItems?: BoardAppSubItem[] | null;
}

/** 近 1 小时 CPU/内存趋势（0–100），供 sparkline */
export interface BoardHostTrend {
  cpu: number[];
  mem: number[];
}

const emptyTrend: BoardHostTrend = { cpu: [], mem: [] };

const props = defineProps<{
  groupName: string;
  /** 看板正中标题；空则不显示 */
  boardTitle?: string;
  hosts: sshconfig.HostConfig[];
  cards: Record<string, BoardHostCard>;
  /** 每主机近 1h 趋势；缺省则空数组 */
  trends?: Record<string, BoardHostTrend>;
}>();

const emit = defineEmits<{
  exit: [];
  openHost: [name: string];
}>();

const emptyCard: BoardHostCard = {
  loading: true,
};

let clockTimer: ReturnType<typeof setInterval> | null = null;
const nowMs = ref(Date.now());
const isFullscreen = ref(false);
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

const clockText = computed(() => formatBoardClock(nowMs.value));
const clockIso = computed(() => new Date(nowMs.value).toISOString());

function startClock() {
  stopClock();
  nowMs.value = Date.now();
  clockTimer = setInterval(() => {
    nowMs.value = Date.now();
  }, 1000);
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
  return props.trends?.[name] || emptyTrend;
}

/**
 * 固定宫格档位：升档到完整矩形，空位补齐，投屏整齐。
 * 1 → 1×1；2–4 → 2×2；5–6 → 3×2；7–9 → 3×3；10–12 → 4×3；…
 */
function pickBoardGrid(n: number): { cols: number; rows: number; capacity: number } {
  const count = Math.max(1, n);
  if (count <= 1) return { cols: 1, rows: 1, capacity: 1 };
  if (count <= 4) return { cols: 2, rows: 2, capacity: 4 };
  if (count <= 6) return { cols: 3, rows: 2, capacity: 6 };
  if (count <= 9) return { cols: 3, rows: 3, capacity: 9 };
  if (count <= 12) return { cols: 4, rows: 3, capacity: 12 };
  if (count <= 16) return { cols: 4, rows: 4, capacity: 16 };
  if (count <= 20) return { cols: 5, rows: 4, capacity: 20 };
  if (count <= 25) return { cols: 5, rows: 5, capacity: 25 };
  const cols = 6;
  const rows = Math.ceil(count / cols);
  return { cols, rows, capacity: cols * rows };
}

const boardGrid = computed(() => pickBoardGrid(props.hosts.length));

const emptySlotCount = computed(() =>
  Math.max(0, boardGrid.value.capacity - props.hosts.length)
);

/** 宫格越密，卡内字号/间距越紧，保证各档视觉统一 */
const cardDensity = computed<"lg" | "md" | "sm" | "xs" | "xxs">(() => {
  const c = boardGrid.value.capacity;
  if (c <= 4) return "lg";
  if (c <= 9) return "md";
  if (c <= 12) return "sm";
  if (c <= 16) return "xs";
  return "xxs";
});

const gridStyle = computed(() => {
  const { cols, rows } = boardGrid.value;
  return {
    gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
    gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))`,
  };
});

function onOpen(name: string) {
  emit("openHost", name);
}

async function toggleFullscreen() {
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
    /* 忽略 */
  }
}

function onKeydown(e: KeyboardEvent) {
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

onMounted(() => {
  startClock();
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

/** 初始同步一次全屏状态（窗口可能是在全屏态下重载） */
async function syncFullscreenFlag() {
  try {
    isFullscreen.value = await Window.IsFullscreen();
  } catch {
    isFullscreen.value = false;
  }
}

onBeforeUnmount(() => {
  stopClock();
  window.removeEventListener("keydown", onKeydown);
  fsEventOffs.forEach((off) => off());
  fsEventOffs.length = 0;
});
</script>

<style scoped lang="scss">
.board-mode {
  position: fixed;
  inset: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px 20px 20px;
  box-sizing: border-box;
  background: #0f1115;
  color: #e8eaed;
  overflow: hidden;
  user-select: none;
  -webkit-user-select: none;
}

:global(html.frosted) .board-mode {
  /* 磨砂底色单变量：reduced-transparency 时 tokens 已把 --lg-fill 退回实色，
     直接整值使用，不再 color-mix 稀释（稀释会让降级后的实色又变半透明） */
  background: var(--lg-fill);
}

.board-mode__bar {
  flex-shrink: 0;
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  gap: 16px;
  padding: 10px 14px;
  border-radius: var(--lg-radius, 16px);
}

.board-mode__titles {
  display: flex;
  align-items: baseline;
  gap: 12px;
  flex-wrap: wrap;
  min-width: 0;
  justify-self: start;
}

.board-mode__group {
  font-size: 22px;
  font-weight: 650;
}

.board-mode__count {
  font-size: 15px;
  color: #9aa0a6;
}

.board-mode__center {
  justify-self: center;
  min-width: 0;
  max-width: 100%;
  text-align: center;
  padding: 0 8px;
}

.board-mode__board-title {
  display: block;
  font-size: 22px;
  font-weight: 650;
  letter-spacing: 0.04em;
  color: #e8eaed;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.board-mode__right {
  justify-self: end;
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}

.board-mode__fs-btn {
  flex-shrink: 0;
  appearance: none;
  border: 1px solid #2a303c;
  background: #1a1d24;
  color: #e8eaed;
  font-size: 13px;
  line-height: 1;
  padding: 6px 12px;
  border-radius: 6px;
  cursor: pointer;

  &:hover {
    border-color: #3a4250;
    background: #22262f;
  }

  &:active {
    background: #181b22;
  }
}

.board-mode__clock {
  flex-shrink: 0;
  font-size: 16px;
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.02em;
  color: #c4c7cc;
}

.mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}

.board-mode__grid {
  flex: 1;
  min-height: 0;
  display: grid;
  gap: 12px;
  align-content: stretch;
  overflow: auto;
}

.board-mode__slot--empty {
  min-width: 0;
  min-height: 0;
  pointer-events: none;
  visibility: hidden;
}
</style>
