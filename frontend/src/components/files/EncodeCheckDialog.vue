<template>
  <!-- 编码检查弹窗：逐文件勾选 + 展开预览原始/转换后 -->
  <el-dialog
    :model-value="modelValue"
    title="检测到非标准 Linux 文本"
    width="680px"
    :close-on-click-modal="false"
    append-to-body
    @update:model-value="(v: boolean) => emit('update:modelValue', v)"
  >
    <div class="encode-tip">
      以下文件非 <b>UTF-8（无 BOM）+ LF</b>。勾选的文件上传时自动规范为标准格式，未勾选的原样上传。
    </div>
    <div class="encode-list">
      <div v-for="item in items" :key="item.path" class="encode-item">
        <div class="encode-head">
          <el-checkbox
            :model-value="checked.has(item.path)"
            @change="(v) => toggleChecked(item.path, Boolean(v))"
          >
            <span class="encode-name">{{ item.relPath }}</span>
          </el-checkbox>
          <span class="encode-badge">{{ item.encoding }} / {{ item.lineEnding }}</span>
          <span class="encode-arrow">→</span>
          <span class="encode-badge encode-badge--ok">UTF-8 / LF</span>
          <el-button
            link
            type="primary"
            size="small"
            class="encode-preview-btn"
            @click="toggleExpanded(item.path)"
          >
            {{ expanded.has(item.path) ? "收起" : "预览" }}
          </el-button>
        </div>
        <div v-if="expanded.has(item.path)" class="encode-preview">
          <div class="encode-col">
            <div class="encode-col-label">原始（{{ item.encoding }} / {{ item.lineEnding }}）</div>
            <pre class="encode-pre">{{ item.content }}</pre>
          </div>
          <div class="encode-col">
            <div class="encode-col-label">转换后（UTF-8 / LF）</div>
            <pre class="encode-pre">{{ item.normalized }}</pre>
          </div>
        </div>
      </div>
    </div>
    <template #footer>
      <el-button @click="emit('cancel')">取消</el-button>
      <el-button @click="emit('upload-raw')">全部原样上传</el-button>
      <el-button type="primary" @click="emit('upload-convert', Array.from(checked))">
        上传（勾选转 UTF-8/LF）
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
/**
 * 上传前编码检查弹窗。
 * 勾选/展开状态在组件内部维护；确认时把勾选转换的路径通过 upload-convert 事件回抛。
 */
import { ref, watch } from "vue";
import type { LocalTextCheck } from "@/api";

const props = defineProps<{
  modelValue: boolean;
  items: LocalTextCheck[];
}>();

const emit = defineEmits<{
  (e: "update:modelValue", v: boolean): void;
  (e: "cancel"): void;
  (e: "upload-raw"): void;
  (e: "upload-convert", convertPaths: string[]): void;
}>();

const checked = ref<Set<string>>(new Set()); // 勾选「转换」的文件路径
const expanded = ref<Set<string>>(new Set()); // 展开预览的文件

// 每次弹窗携带新文件列表时重置：默认全选转换、收起预览
watch(
  () => props.items,
  (items) => {
    checked.value = new Set(items.map((i) => i.path));
    expanded.value = new Set();
  },
  { immediate: true }
);

function toggleChecked(path: string, on: boolean) {
  const next = new Set(checked.value);
  if (on) next.add(path);
  else next.delete(path);
  checked.value = next;
}

function toggleExpanded(path: string) {
  const next = new Set(expanded.value);
  if (next.has(path)) next.delete(path);
  else next.add(path);
  expanded.value = next;
}
</script>

<style scoped lang="scss">
.encode-tip {
  margin-bottom: 12px;
  font-size: 13px;
  color: var(--el-text-color-regular);
  line-height: 1.6;
}
.encode-list {
  max-height: 360px;
  overflow-y: auto;
}
.encode-item {
  padding: 8px 0;
  border-bottom: 1px solid var(--el-border-color-extra-light);
}
.encode-head {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.encode-name {
  font-size: 13px;
  font-family: ui-monospace, SFMono-Regular, monospace;
}
.encode-badge {
  padding: 1px 6px;
  border-radius: 3px;
  font-size: 11px;
  background: var(--el-fill-color);
  color: var(--el-text-color-secondary);
}
.encode-badge--ok {
  background: var(--el-color-success-light-9);
  color: var(--el-color-success);
}
.encode-arrow {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}
.encode-preview-btn {
  margin-left: auto;
}
.encode-preview {
  display: flex;
  gap: 10px;
  margin-top: 8px;
}
.encode-col {
  flex: 1;
  min-width: 0;
}
.encode-col-label {
  font-size: 11px;
  color: var(--el-text-color-secondary);
  margin-bottom: 4px;
}
.encode-pre {
  margin: 0;
  padding: 8px;
  max-height: 180px;
  overflow: auto;
  font-size: 12px;
  line-height: 1.5;
  background: var(--m3-surface-container, #f2f1f4);
  border-radius: var(--m3-shape-s, 8px);
  white-space: pre-wrap;
  word-break: break-all;
  font-family: ui-monospace, SFMono-Regular, monospace;
}
</style>
