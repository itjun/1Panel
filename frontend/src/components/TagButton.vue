<template>
  <!-- M3 Filter Chip：选中 secondary-container，未选中 outline 描边 -->
  <el-button
    v-for="b in buttons"
    :key="b.value"
    class="tag-button"
    :class="{ 'is-active': modelValue === b.value }"
    @click="emit('update:modelValue', b.value)"
  >
    {{ b.label }}
    <span v-if="b.count" class="tag-button__count">{{ b.count }}</span>
  </el-button>
</template>

<script setup lang="ts">
defineProps<{
  modelValue: string;
  buttons: { value: string; label: string; count?: number }[];
}>();
const emit = defineEmits<{ (e: "update:modelValue", v: string): void }>();
</script>

<style scoped>
.tag-button__count {
  margin-left: 5px;
  padding: 0 5px;
  border-radius: var(--m3-shape-s, 8px);
  font-size: 11px;
  line-height: 16px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  background: color-mix(in srgb, var(--m3-on-surface-variant) 12%, transparent);
  color: var(--m3-on-surface-variant);
  border: 1px solid var(--m3-outline-variant);
}
.tag-button.is-active .tag-button__count {
  background: color-mix(in srgb, var(--m3-on-secondary-container) 12%, transparent);
  color: var(--m3-on-secondary-container);
  border-color: transparent;
}
</style>
