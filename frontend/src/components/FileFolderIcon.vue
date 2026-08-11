<!-- 1Panel 风格文件夹/文件图标 -->
<template>
  <svg
    v-if="isDir"
    class="file-icon folder"
    viewBox="0 0 24 24"
    width="20"
    height="20"
    aria-hidden="true"
  >
    <path
      fill="#F7C948"
      d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"
    />
    <path
      fill="#E6A700"
      d="M10 4H4c-1.1 0-2 .9-2 2v1h8.5l1.5-1.5L10 4z"
      opacity="0.55"
    />
  </svg>
  <svg
    v-else
    class="file-icon file"
    viewBox="0 0 24 24"
    width="18"
    height="18"
    aria-hidden="true"
  >
    <path
      fill="#90A4AE"
      d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6z"
    />
    <path fill="#CFD8DC" d="M14 2v6h6" />
  </svg>
</template>

<script setup lang="ts">
defineProps<{ isDir: boolean }>();
</script>

<style scoped>
.file-icon {
  flex-shrink: 0;
  display: block;
}
</style>
