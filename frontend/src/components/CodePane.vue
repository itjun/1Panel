<template>
  <div class="code-pane">
    <button
      v-if="text"
      type="button"
      class="code-copy"
      :class="{ 'is-copied': copied }"
      :title="copied ? '已复制' : '复制'"
      :aria-label="copied ? '已复制' : '复制'"
      @click="copyContent"
    >
      <el-icon :size="15"><Check v-if="copied" /><CopyDocument v-else /></el-icon>
    </button>
    <pre class="code-pre" tabindex="-1" v-html="html"></pre>
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { ElMessage } from "element-plus";
import { Check, CopyDocument } from "@element-plus/icons-vue";
import { copyText } from "@/utils/clipboard";

const props = defineProps<{
  /* 已处理好的安全 HTML（含行级 .ng-line 包装），直接 v-html */
  html: string;
  /* 复制用的原始文本（不含行号），为空则不显示复制按钮 */
  text: string;
}>();

/* 复制原始文本，成功后图标短暂变对勾 */
const copied = ref(false);
let copiedTimer: number | undefined;

async function copyContent() {
  try {
    await copyText(props.text);
    copied.value = true;
    window.clearTimeout(copiedTimer);
    copiedTimer = window.setTimeout(() => (copied.value = false), 1600);
  } catch {
    ElMessage.error("复制失败");
  }
}
</script>

<!-- v-html 内容不吃 scoped，需全局样式；统一以 .code-pane 前缀隔离 -->
<style lang="scss">
.code-pane {
  position: relative;
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  min-height: 0;

  .code-copy {
    position: absolute;
    top: 10px;
    right: 12px;
    z-index: 1;
    width: 30px;
    height: 30px;
    display: flex;
    align-items: center;
    justify-content: center;
    border: 1px solid rgba(248, 248, 242, 0.25);
    border-radius: var(--m3-shape-s);
    background: rgba(255, 255, 255, 0.08);
    color: #f8f8f2;
    opacity: 0.6;
    cursor: pointer;
    box-sizing: border-box;
    transition: opacity var(--m3-motion-state),
      background-color var(--m3-motion-state), color var(--m3-motion-state),
      border-color var(--m3-motion-state);

    &:hover {
      opacity: 1;
      background: rgba(255, 255, 255, 0.18);
    }

    &.is-copied {
      opacity: 1;
      color: #a6e22e;
      border-color: rgba(166, 226, 46, 0.45);
    }
  }

  .code-pre {
    margin: 0;
    flex: 1;
    height: 100%;
    min-height: 0;
    padding: 16px 20px;
    overflow: auto;
    box-sizing: border-box;
    font-family: var(--m3-font-mono);
    font-size: 15px;
    line-height: 1.5;
    white-space: pre;
    word-break: normal;
    background: #000000;
    color: #f8f8f2;
    user-select: text;
    cursor: text;
    outline: none;
    counter-reset: ngline;
  }

  .code-pre .ng-line {
    display: block;
    counter-increment: ngline;

    &::before {
      content: counter(ngline);
      display: inline-block;
      min-width: 3.5em;
      padding-right: 18px;
      margin-right: 10px;
      text-align: right;
      color: #49483e;
      font-weight: 400;
      font-variant-numeric: tabular-nums;
      user-select: none;
    }
  }

  /* 固定黑底 Monokai 色板（对齐终端，跨亮暗主题不变） */
  .code-pre .hljs-comment,
  .code-pre .raw-comment {
    color: #75715e;
    font-style: italic;
  }

  .code-pre .hljs-section {
    color: #66d9ef;
    font-weight: 600;
  }

  .code-pre .hljs-attribute,
  .code-pre .hljs-literal {
    color: #66d9ef;
  }

  .code-pre .hljs-string {
    color: #a6e22e;
  }

  .code-pre .hljs-number {
    color: #ae81ff;
  }

  .code-pre .hljs-variable {
    color: #f92672;
    font-style: italic;
  }

  .code-pre .hljs-regexp {
    color: #f92672;
  }
}
</style>
