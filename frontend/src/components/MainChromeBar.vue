<template>
  <div
    class="main-chrome-bar drag-region"
    @dblclick="chrome.toggleMaximise()"
    @contextmenu.prevent="chrome.openMenu($event)"
  >
    <div class="chrome-left">
      <div v-if="title || subtitle" class="chrome-titles">
        <span v-if="title" class="chrome-title">{{ title }}</span>
        <span v-if="subtitle" class="chrome-subtitle">{{ subtitle }}</span>
      </div>
      <div
        v-if="$slots.default"
        class="chrome-nav no-drag"
        @dblclick.stop
        @contextmenu.stop
      >
        <slot />
      </div>
    </div>
    <div
      ref="centerRef"
      class="chrome-center no-drag"
      @dblclick.stop
      @contextmenu.stop
    />
    <div class="chrome-right">
      <div
        ref="actionsRef"
        class="chrome-actions no-drag"
        @dblclick.stop
        @contextmenu.stop
      />
      <WinWindowControls v-if="!chrome.isMac" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { inject, ref } from "vue";
import WinWindowControls from "@/components/WinWindowControls.vue";
import {
  chromeActionsKey,
  chromeCenterKey,
} from "@/composables/useChromeActions";
import { useChromeDrag } from "@/composables/useChromeDrag";

defineProps<{
  title?: string;
  subtitle?: string;
}>();

const chrome = useChromeDrag();
const injectedActions = inject(chromeActionsKey, null);
const injectedCenter = inject(chromeCenterKey, null);
const localActions = ref<HTMLElement | null>(null);
const localCenter = ref<HTMLElement | null>(null);
const actionsRef = injectedActions ?? localActions;
const centerRef = injectedCenter ?? localCenter;
</script>

<style scoped>
.main-chrome-bar {
  position: relative;
  flex-shrink: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
  align-items: center;
  column-gap: 12px;
  height: var(--m3-chrome-height);
  min-height: var(--m3-chrome-height);
  max-height: var(--m3-chrome-height);
  padding: 0 16px;
  box-sizing: border-box;
  overflow: hidden;
  background: var(--m3-content);
  border-bottom: 1px solid var(--m3-outline-variant);
}

.chrome-left {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  justify-self: start;
}

.chrome-titles {
  display: flex;
  flex-direction: column;
  justify-content: center;
  min-width: 0;
  max-width: 100%;
}

.chrome-title {
  flex-shrink: 1;
  min-width: 0;
  max-width: 100%;
  font: var(--m3-title-medium);
  font-weight: 600;
  color: var(--m3-on-surface);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  line-height: 24px;
  user-select: none;
}

.chrome-subtitle {
  min-width: 0;
  max-width: 100%;
  font: var(--m3-label-small);
  color: var(--m3-on-surface-variant);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  line-height: 16px;
  user-select: none;
}

.chrome-nav {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  overflow: hidden;
}

.chrome-center {
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 0;
  max-width: min(420px, 46vw);
}

.chrome-center:empty {
  display: none;
}

.chrome-right {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 4px;
  min-width: 0;
  justify-self: end;
}

.chrome-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 4px;
  flex-shrink: 1;
  min-width: 0;
  max-width: none;
}
</style>
