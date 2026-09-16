<template>
  <div
    class="sidebar-drag-cap drag-region"
    aria-hidden="true"
    @dblclick="chrome.toggleMaximise()"
    @contextmenu.prevent="chrome.openMenu($event)"
  />
</template>

<script setup lang="ts">
import { useChromeDrag } from "@/composables/useChromeDrag";

const chrome = useChromeDrag();
</script>

<style scoped>
.sidebar-drag-cap {
  flex-shrink: 0;
  width: 100%;
  height: 10px;
  box-sizing: border-box;
}
</style>
