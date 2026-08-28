<template>
  <div class="nginx-page">
    <div class="nginx-toolbar">
      <span class="panel-section-title">Nginx 配置</span>
      <span class="nginx-path">/etc/nginx/conf.d</span>
      <el-tag size="small" type="info" effect="plain">只读预览</el-tag>
      <el-button size="small" :loading="nginxLoading" @click="loadNginx">刷新</el-button>
    </div>
    <el-alert
      v-if="nginxError"
      type="warning"
      :title="nginxError"
      show-icon
      :closable="false"
    />
    <div v-else class="nginx-split">
      <ul class="nginx-files">
        <li
          v-for="f in nginxFiles"
          :key="f.path"
          :class="{ active: f.path === nginxSelected }"
          @click="nginxSelected = f.path"
        >
          <span class="nf-name">{{ f.name }}</span>
          <span v-if="f.error" class="nf-err">!</span>
          <span v-else class="nf-size">{{ formatSize(f.size) }}</span>
        </li>
        <li v-if="!nginxLoading && !nginxFiles.length" class="nf-empty">目录为空</li>
      </ul>
      <pre v-if="nginxLoading && !nginxPreviewText" class="nginx-preview">加载中…</pre>
      <pre v-else-if="nginxPreviewText" class="nginx-preview" tabindex="-1">{{ nginxPreviewText }}</pre>
      <pre v-else class="nginx-preview muted">选择左侧文件预览</pre>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { api } from "@/api";
import type { monitor } from "@/api";

const NGINX_DIR = "/etc/nginx/conf.d";

const props = defineProps<{ host: string }>();

const nginxFiles = ref<{ name: string; path: string; size: number; content: string; error?: string }[]>([]);
const nginxSelected = ref("");
const nginxLoading = ref(false);
const nginxError = ref("");

const nginxPreviewText = computed(() => {
  const f = nginxFiles.value.find((x) => x.path === nginxSelected.value);
  if (!f) return "";
  if (f.error) return `# 读取失败: ${f.error}`;
  return f.content;
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
      .sort((a: monitor.FileEntry, b: monitor.FileEntry) => a.name.localeCompare(b.name));
    const loaded = await Promise.all(
      files.map(async (e: monitor.FileEntry) => {
        const path = (e.path || NGINX_DIR.replace(/\/$/, "") + "/" + e.name);
        try {
          const content = await api.readFileText(props.host, path);
          return { name: e.name, path, size: Number(e.size) || content.length, content };
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
  gap: 12px;
  min-height: 0;
  height: 100%;
}
.nginx-toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.nginx-path {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  font-family: ui-monospace, monospace;
  flex: 1;
}
.nginx-split {
  display: grid;
  grid-template-columns: 240px 1fr;
  gap: 12px;
  min-height: 0;
  flex: 1;
}
.nginx-files {
  list-style: none;
  margin: 0;
  padding: 0;
  border: 1px solid var(--el-border-color);
  border-radius: 6px;
  overflow: auto;
  max-height: calc(100vh - 220px);
  li {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px 10px;
    font-size: 13px;
    cursor: pointer;
    border-bottom: 1px solid var(--el-border-color-lighter);
    &.active {
      background: var(--el-color-primary-light-9);
    }
    &:hover {
      background: var(--el-fill-color-light);
    }
  }
  .nf-name {
    flex: 1;
    font-family: ui-monospace, monospace;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .nf-size {
    color: var(--el-text-color-secondary);
    font-size: 12px;
  }
  .nf-err {
    color: var(--el-color-danger);
    font-weight: 700;
  }
  .nf-empty {
    color: var(--el-text-color-secondary);
    cursor: default;
  }
}
.nginx-preview {
  margin: 0;
  padding: 14px 16px;
  border: 1px solid var(--el-border-color);
  border-radius: 6px;
  font-size: 14px;
  line-height: 1.6;
  overflow: auto;
  max-height: calc(100vh - 220px);
  white-space: pre-wrap;
  word-break: break-word;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  user-select: text;
  cursor: text;
  outline: none;
  &.muted {
    color: var(--el-text-color-secondary);
    cursor: default;
  }
}
</style>
