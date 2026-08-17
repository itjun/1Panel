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
    <!-- 运行中数量徽标：count 为 0 或未统计时不显示 -->
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
/* 数量徽标：小圆角数字，高对比（浅底深字 + 加粗），随按钮选中/未选中切换配色 */
.tag-button__count {
  margin-left: 5px;
  padding: 0 5px;
  border-radius: 8px;
  font-size: 11px;
  line-height: 16px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  background: var(--el-color-primary-light-9);
  color: var(--el-color-primary);
  border: 1px solid var(--el-color-primary-light-7);
}
/* 选中态（primary 实底）徽标改为白底蓝字，保证对比度 */
.el-button--primary .tag-button__count {
  background: #fff;
  color: var(--el-color-primary);
  border-color: transparent;
}
</style>
