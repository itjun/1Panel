<template>
  <div class="router_card" :class="{ compact, fluid }">
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
          <el-badge
            v-if="b.badge"
            :value="b.badge"
            :max="99"
            :hidden="b.badge <= 0"
            class="router-tab__badge"
          >
            <span class="router-tab__label">{{ b.label }}</span>
          </el-badge>
          <template v-else>
            <span class="router-tab__label">{{ b.label }}</span>
            <span v-if="b.count" class="router-tab__count">{{ b.count }}</span>
          </template>
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
    buttons: { value: string; label: string; count?: number; badge?: number }[];
    compact?: boolean;
    /** 按文案自适应宽度（语言筛选等长标签） */
    fluid?: boolean;
  }>(),
  { compact: false, fluid: false }
);
const emit = defineEmits<{ (e: "update:modelValue", v: string): void }>();
</script>

<style lang="scss" scoped>
.router_card {
  width: 100%;
  min-width: 0;
  height: 100%;
}

.router-nav {
  display: flex;
  max-width: 100%;
  height: 100%;
  align-items: stretch;
  overflow: hidden;
  box-sizing: border-box;
}

.router-tab__badge {
  display: inline-flex;
  line-height: 1;
  overflow: visible;

  :deep(.el-badge__content) {
    border: none;
    transform: translateY(-2px) translateX(6px);
    pointer-events: none;
  }
}

.router-tabs-scroll {
  display: flex;
  align-items: stretch;
  min-width: 0;
  max-width: 100%;
  height: 100%;
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: none;

  &::-webkit-scrollbar {
    display: none;
  }
}

.router-tab {
  position: relative;
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  box-sizing: border-box;
  margin: 0;
  padding: 0 12px;
  height: 100%;
  overflow: visible;
  border: none;
  border-radius: 0;
  background: transparent;
  color: var(--m3-on-surface-variant);
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  transition: color var(--m3-motion-state);

  &:hover:not(.is-active) {
    color: var(--m3-on-surface);
  }

  &.is-active {
    color: var(--m3-primary);
    background: transparent;

    .router-tab__label {
      font-weight: 600;
    }

    .router-tab__count {
      color: var(--m3-primary);
      font-weight: 700;
    }

    &::after {
      content: "";
      position: absolute;
      left: 12px;
      right: 12px;
      bottom: 0;
      height: 2px;
      background: var(--m3-primary);
      border-radius: 1px 1px 0 0;
    }
  }
}

.router-tab__label {
  font: var(--m3-label-large);
  font-weight: 500;
  line-height: 20px;
  white-space: nowrap;
  letter-spacing: 0.01em;
}

.router-tab__count {
  flex-shrink: 0;
  font: var(--m3-label-medium);
  font-variant-numeric: tabular-nums;
  color: var(--m3-on-surface-variant);
  line-height: 1;
}

.router-actions {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  gap: 8px;
  padding: 0 8px 0 10px;
}

.router_card.compact {
  display: inline-flex;
  width: max-content;
  height: auto;

  .router-nav {
    width: max-content;
    height: auto;
  }

  .router-tab {
    height: 28px;
    padding: 0 8px;
  }

  .router-tab__label {
    font: var(--m3-label-medium);
  }
}

.router_card.fluid {
  .router-tab {
    min-width: 0;
    padding: 0 12px;
  }
}
</style>
