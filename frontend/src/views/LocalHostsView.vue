<template>
  <div class="nginx-page page-panel">
    <ChromeTeleport :when="app.isLocalSectionActive('hosts')">
      <span class="chrome-meta nginx-path">/etc/hosts</span>
      <el-button :icon="Refresh" :loading="loading" @click="refresh">刷新</el-button>
    </ChromeTeleport>

    <PageSkeleton v-if="loading && !info" variant="nginx" />
    <el-alert
      v-else-if="error && !info"
      type="error"
      :title="error"
      show-icon
      :closable="false"
      class="nginx-alert"
    />

    <div v-else class="nginx-split">
      <aside class="nginx-files" aria-label="hosts 文件">
        <button type="button" class="nf-item is-active">
          <span class="nf-name">hosts</span>
          <span class="nf-size">{{ formatSize(rawSize) }}</span>
        </button>
      </aside>

      <div class="nginx-codearea">
        <CodePane
          v-if="info?.raw"
          :html="rawHtml"
          :text="info.raw"
        />
        <pre v-else class="nginx-preview muted">暂无内容</pre>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { Refresh } from "@element-plus/icons-vue";
import { api } from "@/api";
import type { localsys } from "@/api";
import ChromeTeleport from "@/components/ChromeTeleport.vue";
import CodePane from "@/components/CodePane.vue";
import PageSkeleton from "@/components/PageSkeleton.vue";
import { usePolling } from "@/composables/usePolling";
import { useAppStore } from "@/stores/app";
import { hostsHighlightHtml } from "@/utils/hostsHighlight";

const app = useAppStore();

const { data: info, error, loading, refresh } = usePolling<localsys.HostsInfo>(
  () => api.localSysHosts(),
  0,
  () => "local-hosts",
  () =>
    app.workspace === "local" &&
    app.localSection === "hosts" &&
    !app.settingsOpen
);

const rawHtml = computed(() => hostsHighlightHtml(info.value?.raw || ""));
const rawSize = computed(() => (info.value?.raw || "").length);

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
  cursor: default;
  box-sizing: border-box;

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
</style>
