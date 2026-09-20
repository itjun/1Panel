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
import {
  useChromeActionsEl,
  useChromeCenterEl,
} from "@/composables/useChromeActions";

const props = withDefaults(
  defineProps<{
    /** 为 false 时不渲染（主机多子页常驻时只显示当前子页工具） */
    when?: boolean;
    /** actions=右侧操作区；center=通栏正中 */
    to?: "actions" | "center";
  }>(),
  { when: true, to: "actions" }
);

const actionsEl = useChromeActionsEl();
const centerEl = useChromeCenterEl();
const target = computed(() => {
  if (props.when === false) return null;
  if (props.to === "center") return centerEl?.value ?? null;
  return actionsEl?.value ?? null;
});
</script>
