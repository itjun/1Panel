<template>
  <!-- 详情页一级标签：选中主色实底白字；未选中纯文字，悬停才出主色描边 -->
  <el-card class="router_card" :class="{ compact }">
    <div class="router-nav">
      <el-radio-group
        :model-value="modelValue"
        @change="(v: string | number | boolean | undefined) => emit('update:modelValue', v as string)"
      >
        <el-radio-button
          v-for="b in buttons"
          :key="b.value"
          class="router_card_button"
          :value="b.value"
          size="large"
        >
          <span>{{ b.label }}</span>
        </el-radio-button>
      </el-radio-group>
      <div class="router-actions">
        <slot name="route-button"></slot>
      </div>
    </div>
  </el-card>
</template>

<script setup lang="ts">
/** 与 1Panel RouterButton 同构：buttons 驱动，v-model 双向绑定当前项 */
withDefaults(
  defineProps<{
    modelValue: string;
    buttons: { value: string; label: string }[];
    compact?: boolean;
  }>(),
  { compact: false }
);
const emit = defineEmits<{ (e: "update:modelValue", v: string): void }>();
</script>

<style lang="scss" scoped>
/* 以下样式与 1Panel router-button/index.vue 一致（tailwind 类翻译为普通 CSS） */
.router_card {
  --el-card-padding: 0;

  :deep(.el-card__body) {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
  }
}

.router-nav {
  display: flex;
  width: 100%;
  align-items: flex-start;
  justify-content: space-between;
}

.router-nav :deep(.el-radio-group) {
  display: flex;
  flex-wrap: wrap;
  width: 100%;
}

.router-actions {
  display: flex;
  gap: 8px;
}

.router_card_button {
  :deep(.el-radio-button__inner) {
    min-width: 100px;
    height: 40px;
    background-color: var(--panel-button-active) !important;
    box-shadow: none !important;
    outline: none !important;
    border: 2px solid transparent !important;
    color: var(--el-text-color-regular) !important;

    /* 微调：悬浮显示主色边框，提示可点击（2px 透明边框已占位，不抖动） */
    &:hover {
      border-color: var(--panel-color-primary) !important;
      color: var(--panel-color-primary) !important;
    }
  }

  :deep(.el-radio-button__original-radio:checked + .el-radio-button__inner) {
    color: #fff !important;
    background-color: var(--panel-color-primary) !important;
    border-color: var(--panel-color-primary) !important;
    border-radius: 4px;
    &:hover {
      color: #fff !important;
      background-color: var(--panel-color-primary) !important;
      border-color: var(--panel-color-primary) !important;
    }
  }
}

.router_card.compact {
  display: inline-flex;
  width: max-content;
  background: transparent !important;
  border: none !important;
  box-shadow: none !important;

  :deep(.el-card__body) {
    padding: 0;
  }

  .router-nav {
    width: max-content;
  }

  :deep(.el-radio-group) {
    display: flex;
    flex-wrap: nowrap;
  }

  .router_card_button :deep(.el-radio-button__inner) {
    min-width: 64px;
    height: 28px;
    padding: 0 12px;
    font-size: 13px;
    line-height: 24px;
    background-color: transparent !important;
  }
}
</style>
