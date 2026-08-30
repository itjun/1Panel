<template>
  <!-- 文本预览抽屉：行号 + 底部编码/换行符 + Linux 标准转换 -->
  <el-drawer
    v-model="previewOpen"
    :title="preview?.name || '预览'"
    size="50%"
    destroy-on-close
    class="preview-drawer"
  >
    <div v-loading="previewLoading || previewConverting" class="preview-shell">
      <el-alert
        v-if="previewNeedsNormalize"
        type="warning"
        :closable="false"
        show-icon
        class="preview-normalize-alert"
      >
        <template #title>
          <div class="normalize-alert-body">
            <span>
              当前不是 Linux 标准格式（期望
              <strong>UTF-8 + LF</strong>）：编码
              <strong>{{ previewEncoding }}</strong>，换行
              <strong>{{ previewLineEnding }}</strong>。
            </span>
            <el-button
              type="primary"
              size="small"
              :loading="previewConverting"
              @click="onNormalizeToLinux"
            >
              转换为 UTF-8 / LF
            </el-button>
          </div>
        </template>
      </el-alert>
      <div class="preview-code" role="region" aria-label="文件预览">
        <div
          v-for="(line, idx) in previewLines"
          :key="idx"
          class="preview-line"
        >
          <span class="line-no" aria-hidden="true">{{ idx + 1 }}</span>
          <span class="line-text">{{ line.length ? line : " " }}</span>
        </div>
        <div v-if="!previewLoading && previewLines.length === 0" class="preview-empty">
          (空文件)
        </div>
      </div>
      <div class="preview-status">
        <span class="status-left">{{ previewLineCountLabel }}</span>
        <span class="status-right">
          <span
            class="status-item"
            :class="{ 'is-warn': previewNeedsNormalize }"
            title="文件编码"
          >{{ previewEncoding }}</span>
          <span class="status-sep">|</span>
          <span
            class="status-item"
            :class="{ 'is-warn': previewNeedsNormalize }"
            title="换行符"
          >{{ previewLineEnding }}</span>
          <template v-if="previewNeedsNormalize">
            <span class="status-sep">|</span>
            <el-button
              link
              type="warning"
              size="small"
              :loading="previewConverting"
              @click="onNormalizeToLinux"
            >
              转 Linux 标准
            </el-button>
          </template>
        </span>
      </div>
    </div>
  </el-drawer>
</template>

<script setup lang="ts">
/**
 * 远程文本文件预览抽屉。
 * 父组件通过 openFile({path, name}) 打开；读取、转换 Linux 标准格式均在此完成。
 */
import { computed, ref } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { api } from "@/api";
import type { filetext } from "@/api";
import { splitTextLines } from "@/utils/format";

const props = defineProps<{ host: string }>();

const previewOpen = ref(false);
const preview = ref<filetext.Preview | null>(null);
const previewPath = ref("");
const previewLoading = ref(false);
const previewConverting = ref(false);

const previewLines = computed(() => {
  if (!preview.value) return [];
  return splitTextLines(preview.value.content ?? "");
});
const previewEncoding = computed(() => preview.value?.encoding || "—");
const previewLineEnding = computed(() => preview.value?.lineEnding || "—");
const previewNeedsNormalize = computed(
  () => !!preview.value?.needsNormalize && !!previewPath.value
);
const previewLineCountLabel = computed(() => {
  const n = previewLines.value.length;
  if (!preview.value) return "";
  return `${n} 行`;
});

async function openFile(row: { path: string; name: string }) {
  previewOpen.value = true;
  previewPath.value = row.path;
  preview.value = {
    path: row.path,
    name: row.name,
    content: "",
    encoding: "—",
    lineEnding: "—",
    needsNormalize: false,
    size: 0,
  } as filetext.Preview;
  previewLoading.value = true;
  try {
    const p = await api.readFilePreview(props.host, row.path);
    preview.value = p;
    previewPath.value = p.path || row.path;
  } catch (e) {
    preview.value = {
      path: row.path,
      name: row.name,
      content: `读取失败: ${e}`,
      encoding: "—",
      lineEnding: "—",
      needsNormalize: false,
      size: 0,
    } as filetext.Preview;
  } finally {
    previewLoading.value = false;
  }
}

async function onNormalizeToLinux() {
  if (!previewPath.value || previewConverting.value) return;
  try {
    await ElMessageBox.confirm(
      `将把远程文件转换为 UTF-8 编码 + LF 换行（Linux 标准）。\n写前会备份为「原文件名.bak.时间戳」。\n\n${previewPath.value}`,
      "转换为 Linux 标准格式",
      {
        type: "warning",
        confirmButtonText: "转换并保存",
        cancelButtonText: "取消",
      }
    );
  } catch {
    return;
  }
  previewConverting.value = true;
  try {
    const p = await api.normalizeFileToLinux(props.host, previewPath.value);
    preview.value = p;
    previewPath.value = p.path || previewPath.value;
    ElMessage.success("已转换为 UTF-8 / LF，原文件已备份");
  } catch (e) {
    ElMessage.error(`转换失败: ${e}`);
  } finally {
    previewConverting.value = false;
  }
}

defineExpose({ openFile });
</script>

<style scoped lang="scss">
/* 预览：行号 + 底部状态栏 */
.preview-shell {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  border-radius: var(--m3-shape-m, 12px);
  overflow: hidden;
  background: #131316;
  color: #e6e0e9;
}
.preview-code {
  flex: 1;
  min-height: 0;
  overflow: auto;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, monospace;
  font-size: 12px;
  line-height: 1.55;
  padding: 8px 0;
}
.preview-line {
  display: flex;
  align-items: flex-start;
  min-height: 1.55em;
  padding: 0;
}
.preview-line:hover {
  background: rgba(255, 255, 255, 0.04);
}
.line-no {
  flex: 0 0 52px;
  width: 52px;
  padding: 0 10px 0 8px;
  text-align: right;
  color: #6b7280;
  user-select: none;
  border-right: 1px solid #2a2a2a;
}
.line-text {
  flex: 1;
  min-width: 0;
  padding: 0 12px 0 12px;
  white-space: pre-wrap;
  word-break: break-all;
  color: #e4e4e7;
}
.preview-empty {
  padding: 24px;
  text-align: center;
  color: #9ca3af;
  font-size: 12px;
}
.preview-normalize-alert {
  flex-shrink: 0;
  margin-bottom: 8px;
}
.normalize-alert-body {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  width: 100%;
  font-size: 12px;
  line-height: 1.5;
}
.preview-status {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 28px;
  padding: 4px 12px;
  font-size: 11px;
  color: #9ca3af;
  background: #161616;
  border-top: 1px solid #2a2a2a;
}
.status-left {
  min-width: 0;
}
.status-right {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin-left: auto;
  font-variant-numeric: tabular-nums;
}
.status-item {
  color: #e6e0e9;
  &.is-warn {
    color: #ffd8e4;
    font-weight: 600;
  }
}
.status-sep {
  color: #938f99;
}
</style>

<style lang="scss">
/* drawer body 撑满以便预览区占高（drawer 为组件根节点，scoped :deep 不可靠，用全局按类名限定） */
.preview-drawer .el-drawer__body {
  display: flex;
  flex-direction: column;
  padding: 12px 16px 16px;
  overflow: hidden;
}
</style>
