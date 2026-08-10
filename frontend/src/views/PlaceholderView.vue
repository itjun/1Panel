<template>
  <el-card shadow="never">
    <el-empty
      :description="`${title}（主机：${host}）— 功能逻辑与后端 API 已就绪，UI 已切换到 Element Plus，可按业务优先级继续迁移`"
    />
  </el-card>
</template>

<script setup lang="ts">
defineProps<{ title: string; host: string }>();
</script>
