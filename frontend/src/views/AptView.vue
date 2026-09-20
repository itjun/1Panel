<template>
  <div class="nginx-page page-panel">
    <div class="page-toolbar nginx-toolbar">
      <span class="page-toolbar__hint">
        <template v-if="snap?.distro?.name">
          {{ snap.distro.name }}
          <span v-if="snap.distro.codename" class="apt-codename">{{ snap.distro.codename }}</span>
        </template>
        <template v-else>/etc/apt</template>
      </span>
      <div class="page-toolbar__actions">
        <el-button :icon="Refresh" :loading="loading" @click="load">刷新</el-button>
      </div>
    </div>

    <el-alert
      v-if="error"
      type="error"
      :title="error"
      show-icon
      :closable="false"
      class="nginx-alert"
    />
    <el-alert
      v-else-if="snap && !snap.distro?.apt"
      type="info"
      title="仅支持 apt（Debian / Ubuntu）"
      show-icon
      :closable="false"
      class="nginx-alert"
    />

    <div v-else class="nginx-split">
      <aside class="nginx-files" aria-label="apt 源文件">
        <button
          v-for="f in files"
          :key="f.path"
          type="button"
          class="nf-item"
          :class="{ 'is-active': f.path === selected }"
          @click="selected = f.path"
        >
          <span class="nf-name">{{ f.name }}</span>
          <span class="nf-size">{{ formatSize(f.size) }}</span>
        </button>
        <div v-if="!loading && !files.length" class="nf-empty">没有源文件</div>
      </aside>
      <div class="nginx-codearea">
        <pre v-if="loading && !files.length" class="nginx-preview">加载中…</pre>
        <CodePane
          v-else-if="previewHtml"
          :html="previewHtml"
          :text="previewText"
        />
        <pre v-else class="nginx-preview muted">选择左侧文件预览</pre>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { Refresh } from "@element-plus/icons-vue";
import { api } from "@/api";
import CodePane from "@/components/CodePane.vue";
import { aptHighlightHtml } from "@/utils/aptHighlight";
import { formatErr } from "@/utils/format";

type AptFile = { name: string; path: string; size: number; content: string };
type AptSnap = {
  distro?: {
    id?: string;
    name?: string;
    version?: string;
    codename?: string;
    apt?: boolean;
  };
  files?: AptFile[];
};

const props = defineProps<{ host: string }>();

const snap = ref<AptSnap | null>(null);
const selected = ref("");
const loading = ref(false);
const error = ref("");

const files = computed(() => snap.value?.files || []);

const current = computed(() => files.value.find((f) => f.path === selected.value));
const previewText = computed(() => current.value?.content || "");
const previewHtml = computed(() =>
  previewText.value ? aptHighlightHtml(previewText.value) : ""
);

function formatSize(n: number) {
  if (n < 1024) return n + " B";
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
  return (n / (1024 * 1024)).toFixed(1) + " MB";
}

async function load() {
  loading.value = true;
  error.value = "";
  try {
    const v = (await api.collectAptSources(props.host)) as AptSnap;
    snap.value = v;
    const list = v.files || [];
    if (list.length && !list.some((f) => f.path === selected.value)) {
      selected.value = list[0].path;
    }
  } catch (e) {
    error.value = formatErr(e);
    snap.value = null;
  } finally {
    loading.value = false;
  }
}

watch(
  () => props.host,
  () => {
    selected.value = "";
    snap.value = null;
    void load();
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
.apt-codename {
  margin-left: 8px;
  font-family: var(--m3-font-mono);
  color: var(--m3-on-surface-variant);
}
.nginx-alert {
  margin: 0 16px 12px;
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
  cursor: pointer;
  box-sizing: border-box;
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
.nginx-codearea {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}
.nginx-preview {
  margin: 0;
  padding: 16px;
  flex: 1;
  overflow: auto;
  font-family: var(--m3-font-mono);
  font-size: 13px;
  color: var(--m3-on-surface);
  &.muted {
    color: var(--m3-on-surface-variant);
  }
}
</style>
