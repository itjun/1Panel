<template>
  <div class="host-fn">
    <div class="host-fn__current" :title="host">
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
}

.host-fn__current {
  min-width: 0;
  padding: 10px 14px 8px;
}

.host-fn__current-name {
  display: block;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 17px;
  line-height: 1.35;
  font-weight: 650;
  color: var(--m3-on-surface);
}

.host-fn__list {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 4px 8px 8px;
}

.host-fn__item {
  appearance: none;
  position: relative;
  width: 100%;
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 40px;
  padding: 0 14px;
  border: none;
  border-radius: var(--m3-shape-s);
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
    background: var(--m3-nav-active-bg);
    color: var(--m3-nav-active-fg);
    font-weight: 600;
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
