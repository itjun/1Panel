<template>
  <div class="notify-messages">
    <ChromeTeleport>
      <RouterButton v-model="kindFilter" compact :buttons="kindButtons" />
      <RouterButton v-model="stateFilter" compact :buttons="stateButtons" />
      <el-button
        type="primary"
        plain
        :disabled="alertHistory.unread <= 0"
        :loading="markingAll"
        @click="onMarkAllRead"
      >
        全部已读
      </el-button>
      <el-button :loading="alertHistory.loading" @click="reload">
        刷新
      </el-button>
    </ChromeTeleport>

    <div class="notify-messages__table-wrap">
      <PageSkeleton
        v-if="alertHistory.loading && !filteredEvents.length"
        variant="notify"
      />
      <el-table
        v-else
        ref="tableRef"
        :data="filteredEvents"
        row-key="id"
        height="100%"
        class="notify-messages__table"
        empty-text="暂无告警消息"
        :row-class-name="rowClassName"
        @row-click="onRowClick"
      >
        <el-table-column
          label="时间"
          width="178"
          class-name="col-fit"
          label-class-name="col-fit-label"
        >
          <template #default="{ row }">
            <span class="col-nowrap">{{ formatEventTime(row.at) }}</span>
          </template>
        </el-table-column>
        <el-table-column
          label="主机"
          width="132"
          class-name="col-fit"
          label-class-name="col-fit-label"
        >
          <template #default="{ row }">
            <span class="col-nowrap">{{ row.host || "—" }}</span>
          </template>
        </el-table-column>
        <el-table-column
          label="类型"
          width="64"
          class-name="col-fit"
          label-class-name="col-fit-label"
        >
          <template #default="{ row }">
            <span class="col-nowrap">{{ alertKindLabel(row.kind) }}</span>
          </template>
        </el-table-column>
        <el-table-column
          label="状态"
          width="72"
          class-name="col-fit"
          label-class-name="col-fit-label"
        >
          <template #default="{ row }">
            <span
              class="col-nowrap col-state"
              :class="row.state === 'up' ? 'is-up' : 'is-down'"
            >
              {{ alertStateLabel(row.state) }}
            </span>
          </template>
        </el-table-column>
        <el-table-column
          label="摘要"
          min-width="200"
          show-overflow-tooltip
          label-class-name="col-fit-label"
        >
          <template #default="{ row }">
            {{ summaryOf(row) }}
          </template>
        </el-table-column>
      </el-table>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from "vue";
import type { TableInstance } from "element-plus";
import RouterButton from "@/components/RouterButton.vue";
import PageSkeleton from "@/components/PageSkeleton.vue";
import ChromeTeleport from "@/components/ChromeTeleport.vue";
import { useAppStore } from "@/stores/app";
import {
  useAlertHistoryStore,
  alertKindLabel,
  alertStateLabel,
  type AlertEvent,
} from "@/stores/alertHistory";
import { parseAppAlertKind } from "@/utils/watchServices";

const app = useAppStore();
const alertHistory = useAlertHistoryStore();

const tableRef = ref<TableInstance>();
const kindFilter = ref("all");
const stateFilter = ref("all");
const focusId = ref("");
const markingAll = ref(false);

const kindButtons = [
  { value: "all", label: "全部" },
  { value: "cpu", label: "CPU" },
  { value: "mem", label: "内存" },
  { value: "disk", label: "磁盘" },
  { value: "load", label: "负载" },
  { value: "app", label: "应用" },
];

const stateButtons = [
  { value: "all", label: "全部" },
  { value: "down", label: "告警" },
  { value: "up", label: "恢复" },
];

function matchKind(ev: AlertEvent, kind: string): boolean {
  if (kind === "all") return true;
  if (kind === "app") {
    return !!parseAppAlertKind(ev.kind) || (ev.kind || "").startsWith("app:");
  }
  return ev.kind === kind;
}

const filteredEvents = computed(() => {
  const kind = kindFilter.value;
  const state = stateFilter.value;
  return alertHistory.events.filter((e) => {
    if (!matchKind(e, kind)) return false;
    if (state !== "all" && e.state !== state) return false;
    return true;
  });
});

function formatEventTime(at: number): string {
  if (!at) return "—";
  const d = new Date(at);
  const y = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${y}-${mm}-${day} ${hh}:${mi}:${ss}`;
}

function summaryOf(ev: AlertEvent): string {
  return (ev.title || ev.detail || "").trim() || "—";
}

function rowClassName({ row }: { row: AlertEvent }): string {
  const classes: string[] = [];
  if (!row.read) classes.push("is-unread");
  if (focusId.value && row.id === focusId.value) classes.push("is-focus");
  return classes.join(" ");
}

async function reload() {
  await alertHistory.refresh();
}

async function onMarkAllRead() {
  markingAll.value = true;
  try {
    await alertHistory.markAllRead("");
  } catch {
    /* ignore */
  } finally {
    markingAll.value = false;
  }
}

async function onRowClick(row: AlertEvent) {
  if (!row.id || row.read) return;
  try {
    await alertHistory.markRead(row.id);
  } catch {
    /* ignore */
  }
}

async function scrollToFocus(id: string) {
  if (!id) return;
  focusId.value = id;
  await nextTick();
  const row = filteredEvents.value.find((e) => e.id === id);
  if (row) {
    tableRef.value?.setCurrentRow(row);
  }
  await nextTick();
  const el = tableRef.value?.$el?.querySelector(
    ".el-table__body tr.is-focus"
  ) as HTMLElement | null;
  el?.scrollIntoView({ block: "center", behavior: "smooth" });
  window.setTimeout(() => {
    if (focusId.value === id) focusId.value = "";
    if (app.focusAlertId === id) app.clearFocusAlertId();
  }, 2500);
}

async function applyFocusFromApp() {
  const id = (app.focusAlertId || "").trim();
  if (!id) return;
  if (!alertHistory.events.some((e) => e.id === id)) {
    await alertHistory.refresh();
  }
  await scrollToFocus(id);
}

onMounted(() => {
  void alertHistory.refresh().then(() => applyFocusFromApp());
});

watch(
  () => app.focusAlertId,
  (id) => {
    if (id) void applyFocusFromApp();
  }
);
</script>

<style scoped lang="scss">
.notify-messages {
  display: flex;
  flex-direction: column;
  min-height: 0;
  height: 100%;
  box-sizing: border-box;
}

.notify-messages__table-wrap {
  flex: 1;
  min-height: 0;
  padding: 12px;
  display: flex;
  flex-direction: column;
}

.notify-messages__table {
  width: 100%;
  flex: 1;
  min-height: 0;

  :deep(.el-table__header th) {
    font: var(--m3-label-medium);
    font-weight: 600;
    color: var(--m3-on-surface-variant);
    background: color-mix(in srgb, var(--m3-on-surface) 3%, var(--m3-surface));
  }

  /* 表头单行，避免「类型」「状态」竖排 */
  :deep(th.col-fit-label .cell) {
    white-space: nowrap;
    overflow: visible;
    text-overflow: clip;
    line-height: 1.4;
  }

  :deep(.el-table__body td) {
    font: var(--m3-body-medium);
    color: var(--m3-on-surface);
  }

  :deep(.el-table__body .cell) {
    line-height: 1.4;
  }

  /* 时间/主机/类型/状态：不截断、不换行 */
  :deep(td.col-fit .cell) {
    overflow: visible;
    text-overflow: clip;
    white-space: nowrap;
  }

  :deep(.el-table__body-wrapper) {
    scrollbar-width: thin;
  }

  :deep(.el-table__row) {
    cursor: pointer;
  }

  :deep(.el-table__row.is-unread td) {
    font-weight: 600;
  }

  :deep(.el-table__row.is-unread td:first-child) {
    box-shadow: inset 3px 0 0 var(--m3-primary);
  }

  :deep(.el-table__row.is-focus > td) {
    background: color-mix(in srgb, var(--m3-primary) 12%, transparent) !important;
  }
}

.col-nowrap {
  display: inline-block;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

.col-state.is-down {
  color: var(--m3-error);
}

.col-state.is-up {
  color: var(--el-color-success);
}
</style>
