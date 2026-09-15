<template>
  <div class="nginx-page page-panel">
    <PageSkeleton v-if="loading && !info" variant="nginx" />
    <template v-else>
      <div class="page-toolbar nginx-toolbar">
        <span class="panel-section-title">Nginx 配置</span>
        <span
          v-if="info"
          class="nginx-badge"
          :class="info.running ? 'is-on' : 'is-off'"
        >
          {{ info.running ? "运行中" : "未运行" }}
        </span>
        <span v-if="info?.version" class="nginx-meta">v{{ info.version }}</span>
        <span
          v-if="info?.confPath"
          class="page-toolbar__hint nginx-path"
          v-tip="info.confPath"
        >
          {{ info.confPath }}
        </span>
        <div class="page-toolbar__actions">
          <el-button :loading="loading" @click="refresh">刷新</el-button>
        </div>
      </div>

      <el-alert
        v-if="error"
        type="warning"
        :title="error"
        show-icon
        :closable="false"
        class="nginx-alert"
      />
      <el-alert
        v-else-if="info && !info.installed"
        type="info"
        title="未检测到 nginx 可执行文件"
        show-icon
        :closable="false"
        class="nginx-alert"
      />

      <div v-else-if="info" class="nginx-split">
        <aside class="nginx-files" aria-label="配置文件列表">
          <button
            v-for="f in info.files || []"
            :key="f.path"
            type="button"
            class="nf-item"
            :class="{ 'is-active': f.path === selected }"
            @click="selectFile(f.path)"
          >
            <span class="nf-name" v-tip="f.name">{{ f.name }}</span>
            <span class="nf-size">{{ formatSize(f.size) }}</span>
          </button>
          <div v-if="!loading && !(info.files || []).length" class="nf-empty">
            无配置文件
          </div>
        </aside>

        <div class="nginx-codearea">
          <pre v-if="previewLoading" class="nginx-preview">加载中…</pre>
          <CodePane
            v-else-if="previewHtml"
            :html="previewHtml"
            :text="previewText"
          />
          <pre
            v-else-if="previewText"
            class="nginx-preview"
            tabindex="-1"
          >{{ previewText }}</pre>
          <pre v-else class="nginx-preview muted">选择左侧文件预览</pre>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { api } from "@/api";
import type { localsys } from "@/api";
import CodePane from "@/components/CodePane.vue";
import PageSkeleton from "@/components/PageSkeleton.vue";
import { usePolling } from "@/composables/usePolling";
import { useAppStore } from "@/stores/app";
import { nginxHighlightHtml } from "@/utils/nginxHighlight";

const app = useAppStore();
const selected = ref("");
const previewText = ref("");
const previewLoading = ref(false);
const previewError = ref(false);

/* 读取失败原文不高亮（走普通 pre 分支展示） */
const previewHtml = computed(() =>
  previewError.value ? "" : nginxHighlightHtml(previewText.value)
);

const { data: info, error, loading, refresh } = usePolling<localsys.NginxInfo>(
  () => api.localSysNginx(),
  0,
  () => "local-nginx",
  () =>
    app.workspace === "local" &&
    app.localSection === "nginx" &&
    !app.settingsOpen
);

watch(
  info,
  (v) => {
    const files = v?.files || [];
    if (!files.length) {
      selected.value = "";
      previewText.value = "";
      return;
    }
    if (!files.some((f) => f.path === selected.value)) {
      selectFile(files[0].path);
    }
  },
  { immediate: true }
);

async function selectFile(path: string) {
  selected.value = path;
  previewLoading.value = true;
  previewError.value = false;
  try {
    previewText.value = await api.localSysNginxRead(path);
  } catch (e) {
    previewError.value = true;
    previewText.value = `# 读取失败: ${e instanceof Error ? e.message : String(e)}`;
  } finally {
    previewLoading.value = false;
  }
}

function formatSize(n: number) {
  if (n < 1024) return n + " B";
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
  return (n / (1024 * 1024)).toFixed(1) + " MB";
}
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
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.nginx-meta {
  flex-shrink: 0;
  font: var(--m3-label-small, 12px / 1.4 system-ui);
  color: var(--m3-on-surface-variant, var(--el-text-color-secondary));
}

.nginx-badge {
  flex-shrink: 0;
  font-size: 11px;
  font-weight: 700;
  padding: 2px 8px;
  border-radius: 999px;
  &.is-on {
    color: var(--el-color-success);
    background: color-mix(in srgb, var(--el-color-success) 14%, transparent);
  }
  &.is-off {
    color: var(--el-text-color-secondary);
    background: color-mix(in srgb, var(--el-text-color-secondary) 12%, transparent);
  }
}

.nginx-alert {
  margin: 0 20px 12px;
  flex-shrink: 0;
}

.nginx-split {
  display: grid;
  grid-template-columns: 260px 1fr;
  flex: 1;
  min-height: 0;
  overflow: hidden;
  border-top: 1px solid var(--m3-outline-variant);
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
  padding: 14px 20px;
  border-bottom: none;
  flex-wrap: wrap;
  row-gap: 8px;
}

@media (max-width: 900px) {
  .nginx-split {
    grid-template-columns: 1fr;
    grid-template-rows: minmax(140px, 30%) 1fr;
  }

  .nginx-files {
    border-right: none;
    border-bottom: 1px solid var(--m3-outline-variant);
  }
}
</style>
