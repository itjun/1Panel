<template>
  <div
    class="main-chrome-bar drag-region"
    @dblclick="chrome.toggleMaximise()"
    @contextmenu.prevent="chrome.openMenu($event)"
  >
    <span v-if="title" class="main-chrome-title">{{ title }}</span>
    <div v-if="$slots.default" class="main-chrome-slot no-drag" @dblclick.stop @contextmenu.stop>
      <slot />
    </div>
    <div class="main-chrome-spacer" />
    <WinWindowControls v-if="!chrome.isMac" />
  </div>
</template>

<script setup lang="ts">
import WinWindowControls from "@/components/WinWindowControls.vue";
import { useChromeDrag } from "@/composables/useChromeDrag";

defineProps<{
  title?: string;
}>();

const chrome = useChromeDrag();
</script>

<style scoped>
.main-chrome-bar {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 36px;
  padding: 2px 8px 2px 8px;
  box-sizing: border-box;
}
.main-chrome-title {
  flex-shrink: 0;
  max-width: 40%;
  font: var(--m3-title-small);
  font-weight: 500;
  color: var(--m3-on-surface);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  line-height: 20px;
  user-select: none;
}
.main-chrome-slot {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
}
.main-chrome-spacer {
  flex: 1;
  min-width: 0;
}
.main-chrome-slot + .main-chrome-spacer {
  display: none;
}
</style>
