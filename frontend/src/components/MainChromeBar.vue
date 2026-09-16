<template>
  <div
    class="main-chrome-bar drag-region"
    @dblclick="chrome.toggleMaximise()"
    @contextmenu.prevent="chrome.openMenu($event)"
  >
    <span v-if="title" class="chrome-title">{{ title }}</span>
    <div
      v-if="$slots.default"
      class="chrome-nav no-drag"
      @dblclick.stop
      @contextmenu.stop
    >
      <slot />
    </div>
    <div class="chrome-spacer" />
    <div
      ref="actionsRef"
      class="chrome-actions no-drag"
      @dblclick.stop
      @contextmenu.stop
    />
    <WinWindowControls v-if="!chrome.isMac" />
  </div>
</template>

<script setup lang="ts">
import { inject, ref } from "vue";
import WinWindowControls from "@/components/WinWindowControls.vue";
import { chromeActionsKey } from "@/composables/useChromeActions";
import { useChromeDrag } from "@/composables/useChromeDrag";

defineProps<{
  title?: string;
}>();

const chrome = useChromeDrag();
const injected = inject(chromeActionsKey, null);
const localRef = ref<HTMLElement | null>(null);
const actionsRef = injected ?? localRef;
</script>

<style scoped>
.main-chrome-bar {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  height: var(--m3-chrome-height);
  min-height: var(--m3-chrome-height);
  max-height: var(--m3-chrome-height);
  padding: 0 16px;
  box-sizing: border-box;
  overflow: hidden;
  background: var(--m3-content);
  border-bottom: 1px solid var(--m3-outline-variant);
}
.chrome-title {
  flex-shrink: 0;
  align-self: center;
  max-width: 40%;
  font: var(--m3-title-medium);
  font-weight: 600;
  color: var(--m3-on-surface);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  line-height: 24px;
  user-select: none;
}
.chrome-nav {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  overflow: hidden;
}
.chrome-spacer {
  flex: 1;
  min-width: 0;
}
.chrome-nav + .chrome-spacer {
  display: none;
}
.chrome-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 4px;
  flex-shrink: 0;
  min-width: 0;
  max-width: 58%;
}
</style>
