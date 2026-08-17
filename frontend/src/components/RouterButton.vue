<template>
  <!-- 照搬 1Panel components/router-button/index.vue：
       白底页头卡包一排大号 radio 按钮，选中项白底 + 品牌蓝字 + 2px 品牌蓝边框 -->
  <el-card class="router_card">
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
defineProps<{
  modelValue: string;
  buttons: { value: string; label: string }[];
}>();
const emit = defineEmits<{ (e: "update:modelValue", v: string): void }>();
</script>

<style lang="scss" scoped>
/* 以下样式与 1Panel router-button/index.vue 一致（tailwind 类翻译为普通 CSS） */
.router_card {
  --el-card-padding: 0;

  :deep(.el-card__body) {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
}

.router-nav {
  display: flex;
  width: 100%;
  align-items: center;
  justify-content: space-between;
}

.router-actions {
  display: flex;
  gap: 8px;
}

.router_card_button {
  :deep(.el-radio-button__inner) {
    min-width: 100px;
    height: 100%;
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
    color: var(--panel-button-text-color) !important;
    background-color: var(--panel-button-bg-color) !important;
    border-color: var(--panel-color-primary) !important;
    border-radius: 4px;
  }
}
</style>
