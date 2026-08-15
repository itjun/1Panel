<template>
  <el-button text class="sidebar-toggle-btn" title="展开侧栏" @click="emit('expand')">
    <el-icon>
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.75"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <path d="M9 3v18" />
      </svg>
    </el-icon>
  </el-button>
</template>

<script setup lang="ts">
const emit = defineEmits<{ expand: [] }>();
</script>

<style scoped>
.sidebar-toggle-btn {
  width: 24px;
  height: 24px;
  min-height: 24px;
  padding: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--el-text-color-regular);

  :deep(.el-icon) {
    font-size: 18px;
  }
}
</style>
