<template>
  <Teleport
    v-if="when !== false"
    :disabled="!target"
    :to="target || 'body'"
  >
    <slot />
  </Teleport>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useChromeActionsEl } from "@/composables/useChromeActions";

const props = withDefaults(
  defineProps<{
    /** 为 false 时不渲染（主机多子页常驻时只显示当前子页工具） */
    when?: boolean;
  }>(),
  { when: true }
);

const el = useChromeActionsEl();
const target = computed(() =>
  props.when === false ? null : el?.value ?? null
);
</script>
