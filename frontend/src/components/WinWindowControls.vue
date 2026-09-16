<template>
  <div class="win-controls no-drag" @dblclick.stop @contextmenu.stop>
    <button type="button" class="win-btn" v-tip="'最小化'" @click="chrome.minimiseWin()">
      <svg viewBox="0 0 12 12">
        <path d="M2 6h8" />
      </svg>
    </button>
    <button
      type="button"
      class="win-btn"
      v-tip="maximised ? '还原' : '最大化'"
      @click="chrome.toggleMaximise()"
    >
      <svg v-if="!maximised" viewBox="0 0 12 12">
        <rect x="2.5" y="2.5" width="7" height="7" rx="0.5" />
      </svg>
      <svg v-else viewBox="0 0 12 12">
        <path d="M4 3.5h4.5V8" />
        <rect x="2.5" y="4.5" width="5.5" height="4.5" rx="0.4" />
      </svg>
    </button>
    <button
      type="button"
      class="win-btn win-btn-close"
      v-tip="`挂到后台 (${chrome.kbd('Q')})`"
      @click="chrome.hideToBackground()"
    >
      <svg viewBox="0 0 12 12">
        <path d="M3 3l6 6M9 3l-6 6" />
      </svg>
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useChromeDrag } from "@/composables/useChromeDrag";

const chrome = useChromeDrag();
const maximised = computed(() => chrome.maximised.value);
</script>

<style scoped>
.win-controls {
  display: flex;
  align-items: stretch;
  height: 36px;
  margin-right: -4px;
  flex-shrink: 0;
}
.win-btn {
  width: 46px;
  height: 36px;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--m3-on-surface-variant);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}
.win-btn svg {
  width: 12px;
  height: 12px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.25;
  stroke-linecap: round;
}
.win-btn:hover {
  background: color-mix(in srgb, var(--m3-on-surface) 8%, transparent);
  color: var(--m3-on-surface);
}
.win-btn-close:hover {
  background: var(--m3-error);
  color: var(--m3-on-error);
}
</style>
