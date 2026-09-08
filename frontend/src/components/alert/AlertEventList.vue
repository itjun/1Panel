<template>
  <div class="alert-list-root">
    <el-empty v-if="!loading && !listRows.length" :description="emptyText" />
    <ul v-else class="notify-list">
      <template v-for="row in listRows" :key="row.key">
        <li v-if="row.type === 'day'" class="notify-day-sep">
          <span class="notify-day-sep__date">{{ row.label }}</span>
          <span v-if="row.relative" class="notify-day-sep__rel">{{ row.relative }}</span>
          <span class="notify-day-sep__count">{{ row.count }}</span>
        </li>
        <li
          v-else
          :id="row.ev.id ? `alert-ev-${row.ev.id}` : undefined"
          class="notify-item"
          :class="itemClass(row.ev)"
          @click="onClick(row.ev)"
        >
          <div class="notify-item__main">
            <div class="notify-item__head">
              <span class="notify-kind" :class="kindClass(row.ev)">
                {{ alertKindLabel(row.ev.kind) }}
              </span>
              <span class="notify-state">{{ row.state }}</span>
              <span v-if="showHost" class="notify-host">{{ row.ev.host }}</span>
            </div>
            <div v-if="row.detail" class="notify-detail">
              {{ row.detail }}
            </div>
          </div>
          <time class="notify-time" :datetime="isoOf(row.ev.at)">
            <span class="notify-time__clock">{{ formatAlertClock(row.ev.at) }}</span>
            <span v-if="relativeOf(row.ev.at)" class="notify-time__rel">
              {{ relativeOf(row.ev.at) }}
            </span>
          </time>
        </li>
      </template>
    </ul>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import {
  alertKindLabel,
  formatAlertClock,
  formatAlertRelative,
  groupEventsByDay,
  type AlertEvent,
  type DayGroup,
} from "@/stores/alertHistory";
import { parseAppAlertKind } from "@/utils/watchServices";

const props = withDefaults(
  defineProps<{
    events?: AlertEvent[];
    /** 已按日分组时直接传入，优先于 events（flat 时忽略） */
    days?: DayGroup[];
    loading?: boolean;
    focusId?: string;
    showHost?: boolean;
    clickable?: boolean;
    /** 不按日期分组，扁平列表 */
    flat?: boolean;
    emptyText?: string;
  }>(),
  {
    events: () => [],
    days: undefined,
    loading: false,
    focusId: "",
    showHost: false,
    clickable: false,
    flat: false,
    emptyText: "暂无告警历史",
  }
);

const emit = defineEmits<{
  select: [ev: AlertEvent];
}>();

type ListRow =
  | {
      type: "day";
      key: string;
      label: string;
      relative: string;
      count: number;
    }
  | {
      type: "event";
      key: string;
      ev: AlertEvent;
      state: string;
      detail: string;
    };

const dayGroups = computed(() => {
  if (props.days?.length) return props.days;
  return groupEventsByDay(props.events || []);
});

function toEventRow(ev: AlertEvent, i: number, prefix = ""): ListRow {
  return {
    type: "event",
    key: ev.id || `ev-${prefix}${i}-${ev.at}`,
    ev,
    state: rowState(ev),
    detail: rowDetail(ev),
  };
}

const listRows = computed((): ListRow[] => {
  if (props.flat) {
    const events = props.events?.length
      ? props.events
      : dayGroups.value.flatMap((d) => d.events);
    return events.map((ev, i) => toEventRow(ev, i));
  }
  const rows: ListRow[] = [];
  for (const day of dayGroups.value) {
    rows.push({
      type: "day",
      key: `day-${day.dayKey}`,
      label: day.label,
      relative: day.relative,
      count: day.events.length,
    });
    for (let i = 0; i < day.events.length; i++) {
      rows.push(toEventRow(day.events[i], i, `${day.dayKey}-`));
    }
  }
  return rows;
});

function itemClass(ev: AlertEvent) {
  return {
    "is-alert": ev.state === "down",
    "is-plain": ev.state === "up",
    "is-unread": !ev.read,
    "is-focus": props.focusId && ev.id === props.focusId,
    "is-clickable": props.clickable,
  };
}

function kindClass(ev: AlertEvent) {
  return {
    "is-down": ev.state === "down",
    "is-up": ev.state === "up",
  };
}

/** 状态短文案：类型已由 chip 展示，不再重复主机/类型 */
function rowState(ev: AlertEvent): string {
  const isApp = !!parseAppAlertKind(ev.kind);
  if (ev.state === "up") return "已恢复";
  return isApp ? "探活异常" : "超阈值";
}

/** 去掉「主机名」前缀，避免与主机行重复 */
function stripHostPrefix(text: string, host: string): string {
  const raw = (text || "").trim();
  if (!raw || !host) return raw;
  const wrapped = `「${host}」`;
  if (raw.startsWith(wrapped)) {
    return raw.slice(wrapped.length).trim();
  }
  return raw;
}

/**
 * 详情行：优先展示指标/原因；去掉主机前缀与「类型+状态」标题重复。
 * 恢复态若无实质详情则不显示第二行。
 */
function rowDetail(ev: AlertEvent): string {
  const title = stripHostPrefix(ev.title || "", ev.host);
  let detail = stripHostPrefix(ev.detail || "", ev.host);
  if (!detail || detail === title) {
    // 告警时 detail 常等于 title，回退用清洗后的 title（去掉「CPU超阈值」这类状态句）
    if (ev.state === "down") {
      detail = title;
    } else {
      return "";
    }
  }
  // 去掉与 kind chip 重复的「CPU超阈值 / CPU已回落 / CPU已恢复」整句标题
  const kind = alertKindLabel(ev.kind);
  const isApp = !!parseAppAlertKind(ev.kind);
  const statusTitles = isApp
    ? [`${kind} 探活异常`, `${kind}探活异常`, `${kind} 已恢复`, `${kind}已恢复`]
    : [`${kind}超阈值`, `${kind}已回落`, `${kind}已恢复`];
  if (statusTitles.includes(detail)) {
    return "";
  }
  // 「CPU已恢复到阈值以下」→「已恢复到阈值以下」
  if (detail.startsWith(kind)) {
    const rest = detail.slice(kind.length).trim();
    if (rest) detail = rest;
  }
  return detail;
}

function isoOf(at: number): string {
  if (!at) return "";
  return new Date(at).toISOString();
}

function relativeOf(at: number): string {
  return formatAlertRelative(at);
}

function onClick(ev: AlertEvent) {
  if (!props.clickable) return;
  emit("select", ev);
}
</script>

<style scoped lang="scss">
/* 通知列表：M3 surface / type / semantic 色，主机页与通知中心共用 */
.alert-list-root {
  --notify-error: var(--m3-error);
  --notify-error-container: var(--m3-error-container);
  --notify-on-error: var(--m3-on-error-container);
  --notify-ok: var(--el-color-success);
  --notify-ok-container: var(--el-color-success-light-9);
  --notify-outline: var(--m3-outline-variant);
  --notify-on-surface: var(--m3-on-surface);
  --notify-on-variant: var(--m3-on-surface-variant);
  --notify-surface: var(--m3-surface-container-lowest);
  --notify-surface-low: var(--m3-surface-container);
  --notify-chip: var(--m3-surface-container-high);
  min-height: 0;
}

.notify-list {
  list-style: none;
  margin: 0;
  padding: 0;
  border-radius: var(--m3-shape-m);
  overflow: hidden;
  border: 1px solid var(--notify-outline);
  background: var(--notify-surface);
}
.notify-day-sep {
  display: flex;
  align-items: baseline;
  gap: var(--m3-shape-s);
  padding: 10px 16px;
  background: var(--notify-surface-low);
  border-bottom: 1px solid var(--notify-outline);
  color: var(--notify-on-surface);
}
.notify-day-sep__date {
  font: var(--m3-title-small);
  font-variant-numeric: tabular-nums;
}
.notify-day-sep__rel {
  font: var(--m3-body-small);
  color: var(--notify-on-variant);
}
.notify-day-sep__count {
  margin-left: auto;
  font: var(--m3-label-medium);
  color: var(--notify-on-variant);
}
.notify-item {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 14px 16px;
  border-bottom: 1px solid var(--notify-outline);
  background: var(--notify-surface);
  color: var(--notify-on-surface);
  transition: background var(--m3-duration-short2) var(--m3-easing-standard);
}
.notify-item:last-child {
  border-bottom: 0;
}
.notify-item.is-clickable {
  cursor: pointer;
}
.notify-item.is-clickable:hover {
  background: color-mix(
    in srgb,
    var(--m3-primary) calc(var(--m3-state-hover) * 100%),
    var(--notify-surface)
  );
}
.notify-item.is-alert.is-unread {
  background: var(--notify-error-container);
}
.notify-item.is-plain.is-unread {
  background: var(--notify-ok-container);
}
.notify-item.is-focus {
  outline: 2px solid var(--m3-primary);
  outline-offset: -2px;
}
.notify-item__main {
  flex: 1;
  min-width: 0;
}
.notify-item__head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 8px;
}
.notify-kind {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  border-radius: var(--m3-shape-xs);
  font: var(--m3-label-medium);
  color: var(--notify-on-variant);
  background: var(--notify-chip);
}
.notify-kind.is-down {
  color: var(--notify-on-error);
  background: color-mix(in srgb, var(--notify-error) 16%, var(--notify-surface));
}
.notify-kind.is-up {
  color: var(--notify-ok);
  background: color-mix(in srgb, var(--notify-ok) 14%, var(--notify-surface));
}
.notify-state {
  font: var(--m3-title-small);
  color: var(--notify-on-surface);
}
.notify-item.is-alert .notify-state {
  color: var(--notify-error);
}
.notify-item.is-plain .notify-state {
  color: var(--notify-ok);
}
.notify-host {
  flex: 0 0 auto;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font: var(--m3-label-medium);
  color: var(--notify-on-variant);
  font-variant-numeric: tabular-nums;
}
.notify-detail {
  margin-top: 6px;
  font: var(--m3-body-medium);
  color: var(--notify-on-variant);
  white-space: pre-wrap;
  word-break: break-word;
}
.notify-item.is-alert.is-unread .notify-detail {
  color: var(--notify-on-error);
}
.notify-item.is-plain.is-unread .notify-detail {
  color: var(--notify-ok);
}
.notify-time {
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 2px;
  min-width: 56px;
  padding-top: 2px;
  font-variant-numeric: tabular-nums;
  color: var(--notify-on-variant);
  white-space: nowrap;
}
.notify-time__clock {
  font: var(--m3-label-medium);
}
.notify-time__rel {
  font: var(--m3-label-small);
}
</style>
