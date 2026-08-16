<template>
  <!-- 照搬 1Panel views/log/router/index.vue：
       一排 el-button，选中项 primary 实底白字，未选中无边框纯文字（.tag-button 样式在全局） -->
  <el-button
    v-for="b in buttons"
    :key="b.value"
    class="tag-button"
    :class="modelValue !== b.value ? 'no-active' : ''"
    :type="modelValue === b.value ? 'primary' : ''"
    @click="emit('update:modelValue', b.value)"
  >
    {{ b.label }}
  </el-button>
</template>

<script setup lang="ts">
defineProps<{
  modelValue: string;
  buttons: { value: string; label: string }[];
}>();
const emit = defineEmits<{ (e: "update:modelValue", v: string): void }>();
</script>
