<template>
  <div class="host-fn">
    <button type="button" class="host-fn__back" @click="app.goHome()">
      <span class="host-fn__back-arrow" aria-hidden="true">←</span>
      <span class="host-fn__back-text">全部主机</span>
    </button>

    <div class="host-fn__current" :title="host">
      <span class="host-fn__current-label">当前主机：</span>
      <span class="host-fn__current-name">{{ host }}</span>
    </div>

    <nav class="host-fn__list" aria-label="主机功能">
      <button
        v-for="b in tabs"
        :key="b.value"
        type="button"
        class="host-fn__item"
        :class="{ 'is-active': current === b.value }"
        @click="app.setSubTab(host, b.value)"
      >
        <span class="host-fn__label">{{ b.label }}</span>
        <span v-if="b.badge" class="host-fn__badge">{{ b.badge }}</span>
      </button>
    </nav>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useAppStore } from "@/stores/app";
import { hostSubTabButtons } from "@/constants/hostSubTabs";

const props = defineProps<{
  host: string;
}>();

const app = useAppStore();

const current = computed(
  () => app.hostSessions[props.host]?.subTab || "overview"
);

const tabs = computed(() =>
  hostSubTabButtons(app.terminalSessionCount[props.host] || 0)
);
</script>

<style scoped lang="scss">
.host-fn {
  display: flex;
  flex-direction: column;
  min-height: 0;
  flex: 1;
  border-top: 1px solid var(--m3-outline-variant);
}

.host-fn__back {
  appearance: none;
  width: calc(100% - 12px);
  margin: 8px 6px 4px;
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 36px;
  padding: 0 14px;
  border: 1px solid var(--m3-outline-variant);
  border-radius: 10px;
  background: color-mix(in srgb, var(--m3-primary) 8%, transparent);
  color: var(--m3-primary);
  font: var(--m3-label-large);
  font-weight: 600;
  cursor: pointer;
  text-align: left;
  box-sizing: border-box;
  transition:
    background-color var(--m3-motion-state),
    border-color var(--m3-motion-state);

  &:hover {
    background: color-mix(in srgb, var(--m3-primary) 14%, transparent);
    border-color: color-mix(in srgb, var(--m3-primary) 40%, transparent);
  }
}

.host-fn__back-arrow {
  flex-shrink: 0;
  font-size: 16px;
  line-height: 1;
}

.host-fn__back-text {
  flex: 1;
  min-width: 0;
}

.host-fn__current {
  display: flex;
  align-items: baseline;
  gap: 4px;
  min-width: 0;
  padding: 6px 14px 4px;
}

.host-fn__current-label {
  flex-shrink: 0;
  font: var(--m3-label-small);
  color: var(--m3-on-surface-variant);
}

.host-fn__current-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font: var(--m3-label-large);
  font-weight: 600;
  color: var(--m3-on-surface);
}

.host-fn__list {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 4px 0 8px;
}

.host-fn__item {
  appearance: none;
  position: relative;
  width: 100%;
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 40px;
  padding: 0 14px 0 18px;
  border: none;
  background: transparent;
  color: var(--m3-on-surface-variant);
  font: var(--m3-label-large);
  cursor: pointer;
  text-align: left;
  box-sizing: border-box;

  &:hover:not(.is-active) {
    color: var(--m3-on-surface);
    background: color-mix(in srgb, var(--m3-on-surface) 6%, transparent);
  }

  &.is-active {
    color: var(--m3-primary);
    font-weight: 600;

    &::before {
      content: "";
      position: absolute;
      left: 0;
      top: 10px;
      bottom: 10px;
      width: 2px;
      background: var(--m3-primary);
      border-radius: 0 1px 1px 0;
    }
  }
}

.host-fn__label {
  flex: 1;
  min-width: 0;
}

.host-fn__badge {
  flex-shrink: 0;
  min-width: 18px;
  padding: 0 6px;
  font: var(--m3-label-small);
  font-variant-numeric: tabular-nums;
  color: var(--m3-on-primary);
  background: var(--m3-primary);
  border-radius: 999px;
  line-height: 18px;
  text-align: center;
}
</style>
