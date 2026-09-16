<template>
  <div class="view-toolbar enl-head-zone">
    <div class="view-toolbar__chips">
      <slot />
    </div>
    <div class="view-toolbar__tools">
      <slot name="tools" />
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * 整页表共用工具行：左筛选/元信息，右搜索与操作。
 * 不是产品通栏，只统一这 7 张表页的骨架。
 */
</script>

<style scoped lang="scss">
.view-toolbar {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 12px;
  height: var(--m3-chrome-height);
  min-height: var(--m3-chrome-height);
  max-height: var(--m3-chrome-height);
  padding: 0 16px;
  box-sizing: border-box;
  overflow: hidden;
  background: var(--m3-content);
  border-bottom: 1px solid var(--m3-outline-variant);
}

.view-toolbar__chips {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  overflow-x: auto;
  flex-wrap: nowrap;
  scrollbar-width: none;

  &::-webkit-scrollbar {
    display: none;
  }

  :deep(.tag-button.el-button) {
    flex-shrink: 0;
    margin-right: 8px;
  }

  :deep(.toolbar-meta),
  :deep(.pkg-stats),
  :deep(.page-toolbar__hint) {
    font: var(--m3-title-small);
    color: var(--m3-on-surface-variant);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
}

.view-toolbar__tools {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 8px;

  :deep(.el-button) {
    height: var(--m3-button-height);
    min-height: var(--m3-button-height);
  }

  :deep(.el-button + .el-button) {
    margin-left: 0;
  }

  :deep(.el-input__wrapper),
  :deep(.el-select__wrapper) {
    height: var(--m3-button-height);
    min-height: var(--m3-button-height);
  }

  :deep(.filter-input),
  :deep(.pkg-search) {
    width: 200px;
  }

  :deep(.count) {
    font: var(--m3-body-small);
    color: var(--m3-on-surface-variant);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
}
</style>
