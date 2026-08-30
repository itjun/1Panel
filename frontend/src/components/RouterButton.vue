<template>
  <!-- M3 Segmented：灰底上描边胶囊，选中 primary-container -->
  <div class="router_card" :class="{ compact }">
    <div class="router-nav" role="tablist">
      <div class="router-tabs-scroll">
        <button
          v-for="b in buttons"
          :key="b.value"
          type="button"
          role="tab"
          class="router-tab"
          :class="{ 'is-active': modelValue === b.value }"
          :aria-selected="modelValue === b.value"
          @click="emit('update:modelValue', b.value)"
        >
          <span class="router-tab__label">{{ b.label }}</span>
        </button>
      </div>
      <div v-if="$slots['route-button']" class="router-actions">
        <slot name="route-button"></slot>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
withDefaults(
  defineProps<{
    modelValue: string;
    buttons: { value: string; label: string }[];
    compact?: boolean;
  }>(),
  { compact: false }
);
const emit = defineEmits<{ (e: "update:modelValue", v: string): void }>();
</script>

<style lang="scss" scoped>
.router_card {
  width: 100%;
  min-width: 0;
}

.router-nav {
  display: inline-flex;
  max-width: 100%;
  align-items: stretch;
  border: 1px solid var(--m3-outline-variant);
  border-radius: var(--m3-shape-full);
  background: var(--m3-surface-container-lowest);
  overflow: hidden;
  box-sizing: border-box;
}

.router-tabs-scroll {
  display: flex;
  align-items: stretch;
  min-width: 0;
  max-width: 100%;
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: none;

  &::-webkit-scrollbar {
    display: none;
  }
}

.router-tab {
  /* 等宽段：按最长文案「定时任务」定宽，文字居中，视觉整齐 */
  flex: 0 0 80px;
  width: 80px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  margin: 0;
  padding: 0 6px;
  height: 36px;
  border: none;
  border-radius: 0;
  border-left: 1px solid var(--m3-outline-variant);
  background: transparent;
  color: var(--m3-on-surface);
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  transition: background-color var(--m3-motion-state), color var(--m3-motion-state);

  &:first-child {
    border-left: none;
  }

  &:hover:not(.is-active) {
    background: color-mix(in srgb, var(--m3-on-surface) 6%, transparent);
  }

  &.is-active {
    color: var(--m3-primary);
    background: var(--m3-primary-container);

    .router-tab__label {
      font-weight: 600;
    }
  }
}

.router-tab__label {
  font: var(--m3-label-large);
  font-weight: 500;
  line-height: 20px;
  white-space: nowrap;
  letter-spacing: 0.01em;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
  text-align: center;
}

.router-actions {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  gap: 8px;
  padding: 0 8px 0 10px;
  border-left: 1px solid var(--m3-outline-variant);
}

.router_card.compact {
  display: inline-flex;
  width: max-content;

  .router-nav {
    width: max-content;
  }

  .router-tab {
    flex: 0 0 64px;
    width: 64px;
    padding: 0 4px;
    height: 28px;
  }

  .router-tab__label {
    font: var(--m3-label-medium);
  }
}
</style>
