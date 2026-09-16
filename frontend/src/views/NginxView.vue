<template>
  <div class="nginx-page page-panel">
    <div class="page-toolbar nginx-toolbar">
      <span class="page-toolbar__hint nginx-path">/etc/nginx/conf.d</span>
      <div class="page-toolbar__actions">
        <el-button :loading="nginxLoading" @click="loadNginx">刷新</el-button>
      </div>
    </div>

    <el-alert
      v-if="nginxError"
      type="warning"
      :title="nginxError"
      show-icon
      :closable="false"
      class="nginx-alert"
    />

    <div v-else class="nginx-split">
      <aside class="nginx-files" aria-label="配置文件列表">
        <button
          v-for="f in nginxFiles"
          :key="f.path"
          type="button"
          class="nf-item"
          :class="{ 'is-active': f.path === nginxSelected }"
          @click="nginxSelected = f.path"
        >
          <span class="nf-name">{{ f.name }}</span>
          <span v-if="f.error" class="nf-err">!</span>
          <span v-else class="nf-size">{{ formatSize(f.size) }}</span>
        </button>
        <div v-if="!nginxLoading && !nginxFiles.length" class="nf-empty">
          目录为空
        </div>
      </aside>

      <div class="nginx-codearea">
        <pre
          v-if="nginxLoading && !nginxPreviewText"
          class="nginx-preview"
        >加载中…</pre>
        <CodePane
          v-else-if="nginxPreviewHtml"
          :html="nginxPreviewHtml"
          :text="nginxCopyText"
        />
        <pre
          v-else-if="nginxPreviewText"
          class="nginx-preview"
          tabindex="-1"
        >{{ nginxPreviewText }}</pre>
        <pre v-else class="nginx-preview muted">选择左侧文件预览</pre>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { api } from "@/api";
import type { monitor } from "@/api";
import CodePane from "@/components/CodePane.vue";
import { nginxHighlightHtml } from "@/utils/nginxHighlight";

const NGINX_DIR = "/etc/nginx/conf.d";

const props = defineProps<{ host: string }>();

const nginxFiles = ref<
  { name: string; path: string; size: number; content: string; error?: string }[]
>([]);
const nginxSelected = ref("");
const nginxLoading = ref(false);
const nginxError = ref("");

const nginxPreviewText = computed(() => {
  const f = nginxFiles.value.find((x) => x.path === nginxSelected.value);
  if (!f) return "";
  if (f.error) return `# 读取失败: ${f.error}`;
  return f.content;
});

/* 读取失败原文不高亮（走普通 pre 分支展示） */
const nginxPreviewHtml = computed(() => {
  const f = nginxFiles.value.find((x) => x.path === nginxSelected.value);
  if (!f || f.error) return "";
  return nginxHighlightHtml(f.content);
});

/* 选中文件的原始内容用于复制（读取失败的文件不提供复制） */
const nginxCopyText = computed(() => {
  const f = nginxFiles.value.find((x) => x.path === nginxSelected.value);
  return f && !f.error ? f.content : "";
});

function formatSize(n: number) {
  if (n < 1024) return n + " B";
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
  return (n / (1024 * 1024)).toFixed(1) + " MB";
}

async function loadNginx() {
  nginxLoading.value = true;
  nginxError.value = "";
  try {
    const entries = await api.listDir(props.host, NGINX_DIR);
    const files = entries
      .filter((e: monitor.FileEntry) => !e.isDir && !e.name.startsWith("."))
      .sort((a: monitor.FileEntry, b: monitor.FileEntry) =>
        a.name.localeCompare(b.name)
      );
    const loaded = await Promise.all(
      files.map(async (e: monitor.FileEntry) => {
        const path = e.path || NGINX_DIR.replace(/\/$/, "") + "/" + e.name;
        try {
          const content = await api.readFileText(props.host, path);
          return {
            name: e.name,
            path,
            size: Number(e.size) || content.length,
            content,
          };
        } catch (err) {
          return {
            name: e.name,
            path,
            size: Number(e.size) || 0,
            content: "",
            error: err instanceof Error ? err.message : String(err),
          };
        }
      })
    );
    nginxFiles.value = loaded;
    if (loaded.length && !loaded.some((f) => f.path === nginxSelected.value)) {
      nginxSelected.value = loaded[0].path;
    }
  } catch (e) {
    nginxError.value = e instanceof Error ? e.message : String(e);
    nginxFiles.value = [];
  } finally {
    nginxLoading.value = false;
  }
}

watch(
  () => props.host,
  () => {
    nginxFiles.value = [];
    nginxSelected.value = "";
    loadNginx();
  },
  { immediate: true }
);
</script>

<style scoped lang="scss">
.nginx-page {
  display: flex;
  flex-direction: column;
  min-height: 0;
  height: 100%;
  overflow: hidden;
  padding: 0;
}

.nginx-path {
  font-family: var(--m3-font-mono);
}

.nginx-alert {
  margin: 0 20px 12px;
  flex-shrink: 0;
}

/* 分栏直接铺满面板，不再套第二层描边 */
.nginx-split {
  display: grid;
  grid-template-columns: 260px 1fr;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.nginx-files {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-height: 0;
  overflow: auto;
  padding: 10px;
  background: var(--m3-card);
  border-right: 1px solid var(--m3-outline-variant);
  box-sizing: border-box;
}

.nf-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  margin: 0;
  padding: 10px 12px;
  border: none;
  border-radius: var(--m3-shape-s);
  background: transparent;
  color: var(--m3-on-surface);
  font: var(--m3-body-medium);
  text-align: left;
  cursor: pointer;
  box-sizing: border-box;
  transition: background-color var(--m3-motion-state), color var(--m3-motion-state);

  &:hover {
    background: color-mix(in srgb, var(--m3-primary) 6%, transparent);
  }

  &.is-active {
    background: var(--m3-primary-container);
    color: var(--m3-on-primary-container);

    .nf-name {
      font-weight: 600;
    }

    .nf-size {
      color: inherit;
      opacity: 0.75;
    }
  }
}

.nf-name {
  flex: 1;
  min-width: 0;
  font-family: var(--m3-font-mono);
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.nf-size {
  flex-shrink: 0;
  font: var(--m3-label-small);
  color: var(--m3-on-surface-variant);
}

.nf-err {
  flex-shrink: 0;
  color: var(--m3-error);
  font-weight: 700;
}

.nf-empty {
  padding: 16px 12px;
  font: var(--m3-body-small);
  color: var(--m3-on-surface-variant);
}

/* 右栏代码区：grid 单元，CodePane 靠 flex:1 撑满 */
.nginx-codearea {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}

.nginx-preview {
  margin: 0;
  min-height: 0;
  height: 100%;
  padding: 16px 20px;
  overflow: auto;
  box-sizing: border-box;
  font-size: 15px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: var(--m3-font-mono);
  color: var(--m3-on-surface);
  background: var(--m3-surface-container-lowest);
  user-select: text;
  cursor: text;
  outline: none;

  &.muted {
    color: var(--m3-on-surface-variant);
    cursor: default;
  }
}

.nginx-toolbar {
  margin: 0;
}
</style>
