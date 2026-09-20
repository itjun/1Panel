<template>
  <div class="chrome-scope">
    <slot />
  </div>
</template>

<script setup lang="ts">
import { provide, ref } from "vue";
import {
  chromeActionsKey,
  chromeCenterKey,
} from "@/composables/useChromeActions";

/** 包住通栏 + 内容，让各页能把工具传送到通栏右侧 / 正中 */
const actionsEl = ref<HTMLElement | null>(null);
const centerEl = ref<HTMLElement | null>(null);
provide(chromeActionsKey, actionsEl);
provide(chromeCenterKey, centerEl);
</script>

<style scoped>
.chrome-scope {
  display: contents;
}
</style>
