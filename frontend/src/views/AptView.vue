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
        <el-button
          type="primary"
          :loading="probing"
          :disabled="!canWrite"
          @click="probeAndApply"
        >
          测速优选
        </el-button>
        <el-button
          type="primary"
          :loading="applying"
          :disabled="!canWrite || probing"
          @click="restoreOfficial"
        >
          恢复官方
        </el-button>
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
import { ElMessage, ElMessageBox } from "element-plus";
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
type ProbeHit = {
  id: string;
  name: string;
  host: string;
  ok: boolean;
  ms: number;
  error?: string;
};

const props = defineProps<{ host: string }>();

const snap = ref<AptSnap | null>(null);
const selected = ref("");
const loading = ref(false);
const probing = ref(false);
const applying = ref(false);
const error = ref("");

const files = computed(() => snap.value?.files || []);
const canWrite = computed(() => !!snap.value?.distro?.apt && files.value.length > 0);

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

function rankText(hits: ProbeHit[]): string {
  const rows = [...hits].sort((a, b) => {
    if (a.ok !== b.ok) return a.ok ? -1 : 1;
    return a.ms - b.ms;
  });
  return rows
    .map((h) =>
      h.ok ? `${h.name}  ${h.ms}ms` : `${h.name}  失败${h.error ? "（" + h.error + "）" : ""}`
    )
    .join("\n");
}

async function probeAndApply() {
  probing.value = true;
  try {
    const hits = (await api.probeAptMirrors(props.host)) as ProbeHit[];
    const ok = hits.filter((h) => h.ok);
    if (!ok.length) {
      ElMessage.error("所有镜像均不可达");
      return;
    }
    const best = ok.reduce((a, b) => (a.ms <= b.ms ? a : b));
    const distro = snap.value?.distro;
    const label = [distro?.name, distro?.codename].filter(Boolean).join(" ");
    try {
      await ElMessageBox.confirm(
        `测速结果：\n${rankText(hits)}\n\n将把 ${label || "归档源"} 改为「${best.name}」（${best.ms}ms），并执行 apt-get update。写前会备份现有源文件。`,
        "测速优选",
        {
          type: "warning",
          confirmButtonText: "应用",
          cancelButtonText: "取消",
          customClass: "apt-probe-confirm",
        }
      );
    } catch {
      return;
    }
    await doApply(best.id, false);
  } catch (e) {
    ElMessage.error(`测速失败: ${formatErr(e)}`);
  } finally {
    probing.value = false;
  }
}

async function restoreOfficial() {
  const distro = snap.value?.distro;
  const label = [distro?.name, distro?.codename].filter(Boolean).join(" ");
  try {
    await ElMessageBox.confirm(
      `将把 ${label || "归档源"} 恢复为官方源，并执行 apt-get update。写前会备份现有源文件。`,
      "恢复官方",
      { type: "warning", confirmButtonText: "恢复", cancelButtonText: "取消" }
    );
  } catch {
    return;
  }
  await doApply("", true);
}

async function doApply(mirror: string, official: boolean) {
  applying.value = true;
  try {
    const r = (await api.applyAptMirror(props.host, mirror, official)) as {
      backupDir?: string;
      name?: string;
      changed?: number;
    };
    if (!r.changed) {
      ElMessage.info("源文件无需改动");
    } else {
      ElMessage.success(
        `已应用「${r.name || (official ? "官方" : mirror)}」` +
          (r.backupDir ? `，备份 ${r.backupDir}` : "")
      );
    }
    await load();
  } catch (e) {
    ElMessage.error(`改写失败: ${formatErr(e)}`);
  } finally {
    applying.value = false;
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

<style>
.apt-probe-confirm .el-message-box__message {
  white-space: pre-wrap;
  line-height: 1.45;
}
</style>
