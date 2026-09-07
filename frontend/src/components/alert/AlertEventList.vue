<template>
  <div class="alert-list-root">
    <el-empty v-if="!loading && !flatEvents.length" :description="emptyText" />
    <ul v-else-if="flat" class="notify-list">
      <li
        v-for="ev in flatEvents"
        :id="ev.id ? `alert-ev-${ev.id}` : undefined"
        :key="ev.id"
        class="notify-item"
        :class="itemClass(ev)"
        @click="onClick(ev)"
      >
        <div class="notify-item__main">
          <div class="notify-item__line">
            <span v-if="showHost" class="notify-host">{{ ev.host }}</span>
            <span class="notify-kind">{{ alertKindLabel(ev.kind) }}</span>
            <span class="notify-title">{{ rowTitle(ev) }}</span>
          </div>
          <div
            v-if="ev.detail && ev.detail !== ev.title"
            class="notify-detail"
          >
            {{ ev.detail }}
          </div>
        </div>
        <time class="notify-time" :datetime="isoOf(ev.at)">
          {{ formatAlertClock(ev.at) }}
          <template v-if="formatAlertRelative(ev.at)">
            · {{ formatAlertRelative(ev.at) }}
          </template>
        </time>
      </li>
    </ul>
    <ul v-else-if="dayGroups.length" class="notify-list">
      <template v-for="day in dayGroups" :key="day.dayKey">
        <li class="notify-day-sep">
          <span class="notify-day-sep__date">{{ day.label }}</span>
          <span v-if="day.relative" class="notify-day-sep__rel">{{ day.relative }}</span>
          <span class="notify-day-sep__count">{{ day.events.length }}</span>
        </li>
        <li
          v-for="ev in day.events"
          :id="ev.id ? `alert-ev-${ev.id}` : undefined"
          :key="ev.id"
          class="notify-item"
          :class="itemClass(ev)"
          @click="onClick(ev)"
        >
          <div class="notify-item__main">
            <div class="notify-item__line">
              <span v-if="showHost" class="notify-host">{{ ev.host }}</span>
              <span class="notify-kind">{{ alertKindLabel(ev.kind) }}</span>
              <span class="notify-title">{{ rowTitle(ev) }}</span>
            </div>
            <div
              v-if="ev.detail && ev.detail !== ev.title"
              class="notify-detail"
            >
              {{ ev.detail }}
            </div>
          </div>
          <time class="notify-time" :datetime="isoOf(ev.at)">
            {{ formatAlertClock(ev.at) }}
            <template v-if="formatAlertRelative(ev.at)">
              · {{ formatAlertRelative(ev.at) }}
            </template>
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

const dayGroups = computed(() => {
  if (props.days?.length) return props.days;
  return groupEventsByDay(props.events || []);
});

const flatEvents = computed(() => {
  if (props.flat) {
    if (props.events?.length) return props.events;
    return dayGroups.value.flatMap((d) => d.events);
  }
  return dayGroups.value.flatMap((d) => d.events);
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

function rowTitle(ev: AlertEvent): string {
  if (ev.state === "up") {
    const t = (ev.title || "").trim();
    if (t) return t.replace(/已回落/g, "已恢复");
    return `${alertKindLabel(ev.kind)}已恢复`;
  }
  return ev.title || "告警";
}

function isoOf(at: number): string {
  if (!at) return "";
  return new Date(at).toISOString();
}

function onClick(ev: AlertEvent) {
  if (!props.clickable) return;
  emit("select", ev);
}
</script>

<style scoped lang="scss">
/* 主机通知页与全局通知中心共用同一套色板 */
.alert-list-root {
  --notify-red: #ff3b30;
  --notify-red-bg: #ffebe9;
  --notify-sep: #e5e5ea;
  --notify-text: #1c1c1e;
  --notify-secondary: #8e8e93;
  --notify-fill: #ffffff;
  --notify-grouped: #f2f2f7;
  min-height: 0;
}
html.dark .alert-list-root {
  --notify-red: #ff453a;
  --notify-red-bg: #3a1a18;
  --notify-sep: #38383a;
  --notify-text: #f5f5f7;
  --notify-secondary: #98989d;
  --notify-fill: #1c1c1e;
  --notify-grouped: #2c2c2e;
}

.notify-list {
  list-style: none;
  margin: 0;
  padding: 0;
  border-radius: 10px;
  overflow: hidden;
  border: 1px solid var(--notify-sep);
  background: var(--notify-fill);
}
.notify-day-sep {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 7px 14px;
  background: var(--notify-grouped);
  border-bottom: 1px solid var(--notify-sep);
  color: var(--notify-text);
}
.notify-day-sep__date {
  font-size: 13px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.01em;
}
.notify-day-sep__rel {
  font-size: 12px;
  color: var(--notify-secondary);
}
.notify-day-sep__count {
  margin-left: auto;
  font-size: 12px;
  color: var(--notify-secondary);
}
.notify-item {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 11px 14px;
  border-bottom: 1px solid var(--notify-sep);
  background: var(--notify-fill);
  color: var(--notify-text);
}
.notify-item:last-child {
  border-bottom: 0;
}
.notify-item.is-clickable {
  cursor: pointer;
}
.notify-item.is-clickable:hover {
  background: var(--notify-grouped);
}
.notify-item.is-alert.is-unread {
  background: var(--notify-red-bg);
}
.notify-item.is-focus {
  outline: 2px solid var(--notify-red);
  outline-offset: -2px;
}
.notify-item__main {
  flex: 1;
  min-width: 0;
}
.notify-item__line {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 8px;
}
.notify-host {
  flex: 0 0 auto;
  font-size: 13px;
  font-weight: 500;
  color: var(--notify-text);
}
.notify-kind {
  flex: 0 0 auto;
  font-size: 13px;
  font-weight: 500;
  color: var(--notify-secondary);
}
.notify-title {
  font-size: 14px;
  font-weight: 400;
  color: var(--notify-text);
  letter-spacing: -0.01em;
}
.notify-item.is-alert .notify-kind,
.notify-item.is-alert .notify-title,
.notify-item.is-alert .notify-host {
  color: var(--notify-red);
  font-weight: 400;
}
.notify-detail {
  margin-top: 3px;
  font-size: 12px;
  line-height: 1.4;
  color: var(--notify-secondary);
  white-space: pre-wrap;
  word-break: break-word;
}
.notify-time {
  flex: 0 0 auto;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  color: var(--notify-secondary);
  white-space: nowrap;
  padding-top: 1px;
}
</style>
