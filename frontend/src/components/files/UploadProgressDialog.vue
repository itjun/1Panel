<template>
  <el-dialog
    :model-value="visible"
    title="正在上传"
    width="440px"
    :show-close="false"
    :close-on-click-modal="false"
    :close-on-press-escape="false"
    append-to-body
    class="upload-progress-dialog"
  >
    <div class="upload-current">{{ progress.current || "准备中…" }}</div>
    <el-progress
      :percentage="percent"
      :status="percent >= 100 ? 'success' : undefined"
    />
    <div class="upload-bytes">
      {{ formatBytes(progress.uploaded) }} / {{ formatBytes(progress.total) }}
    </div>
  </el-dialog>
</template>

<script setup lang="ts">
/** 上传进度弹窗：纯展示，进度由 useFileUpload 通过 props 驱动。 */
import { formatBytes } from "@/utils/format";

defineProps<{
  visible: boolean;
  progress: { uploaded: number; total: number; current: string };
  percent: number;
}>();
</script>

<style scoped lang="scss">
.upload-current {
  font-size: 13px;
  color: var(--el-text-color-regular);
  margin-bottom: 12px;
  font-family: ui-monospace, SFMono-Regular, monospace;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.upload-bytes {
  margin-top: 8px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
  text-align: right;
}
</style>
