<template>
  <div class="tab-root tab-table-page local-hosts">
    <div class="view-toolbar">
      <div class="view-toolbar__chips">
        <span class="panel-section-title">Hosts</span>
        <span class="page-toolbar__hint">/etc/hosts · 只读</span>
      </div>
      <div class="view-toolbar__tools">
        <el-button :disabled="!info?.raw" @click="rawOpen = true">查看原文</el-button>
        <el-button :icon="Refresh" :loading="loading" @click="refresh" />
      </div>
    </div>

    <PageSkeleton v-if="loading && !info" variant="table" :show-toolbar="false" />
    <el-alert
      v-else-if="error && !info"
      type="error"
      :title="error"
      show-icon
      :closable="false"
      class="hosts-alert"
    />

    <div v-else-if="info" class="table-wrap m3-table-surface">
      <el-table
        :data="info.entries || []"
        stripe
        style="width: 100%"
        class="data-table-unified"
        height="100%"
      >
        <el-table-column type="index" label="序" width="64" align="center" />
        <el-table-column label="主机名" min-width="180" show-overflow-tooltip>
          <template #default="{ row }">
            <span :class="{ disabled: row.disabled }">
              {{ (row.names || []).join(" ") }}
            </span>
          </template>
        </el-table-column>
        <el-table-column prop="ip" label="IP" width="150" show-overflow-tooltip>
          <template #default="{ row }">
            <span class="mono" :class="{ disabled: row.disabled }">{{ row.ip }}</span>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="88">
          <template #default="{ row }">
            {{ row.disabled ? "已注释" : "生效" }}
          </template>
        </el-table-column>
        <el-table-column prop="comment" label="注释" min-width="120" show-overflow-tooltip />
      </el-table>
    </div>

    <el-dialog
      v-model="rawOpen"
      title="/etc/hosts 原文"
      width="720px"
      append-to-body
      class="m3-form-dialog hosts-raw-dialog"
      destroy-on-close
    >
      <pre class="raw-pre">{{ info?.raw || "" }}</pre>
      <template #footer>
        <el-button @click="rawOpen = false">关闭</el-button>
        <el-button type="primary" :disabled="!info?.raw" @click="copyRaw">
          复制原文
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { Refresh } from "@element-plus/icons-vue";
import { ElMessage } from "element-plus";
import { api } from "@/api";
import type { localsys } from "@/api";
import PageSkeleton from "@/components/PageSkeleton.vue";
import { usePolling } from "@/composables/usePolling";
import { useAppStore } from "@/stores/app";
import { copyText } from "@/utils/clipboard";

const app = useAppStore();
const rawOpen = ref(false);

const { data: info, error, loading, refresh } = usePolling<localsys.HostsInfo>(
  () => api.localSysHosts(),
  0,
  () => "local-hosts",
  () =>
    app.workspace === "local" &&
    app.localSection === "hosts" &&
    !app.settingsOpen
);

async function copyRaw() {
  const text = info.value?.raw || "";
  if (!text) return;
  try {
    await copyText(text);
    ElMessage.success("已复制 /etc/hosts 原文");
  } catch {
    ElMessage.error("复制失败");
  }
}
</script>

<style scoped lang="scss">
.local-hosts {
  gap: 12px;
}

.page-toolbar__hint {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.hosts-alert {
  flex-shrink: 0;
}

.table-wrap {
  flex: 1;
  min-height: 0;
}

.mono {
  font-family: var(--m3-font-mono, ui-monospace, Menlo, monospace);
}

.disabled {
  opacity: 0.55;
  text-decoration: line-through;
}
</style>

<!-- append-to-body：弹窗内容需非 scoped -->
<style lang="scss">
.hosts-raw-dialog.el-dialog {
  .el-dialog__body {
    padding-top: 8px;
  }

  .raw-pre {
    margin: 0;
    max-height: min(60vh, 520px);
    padding: 12px 14px;
    overflow: auto;
    border: 1px solid var(--el-border-color-lighter);
    border-radius: var(--m3-shape-m, 12px);
    background: var(--el-fill-color-blank, var(--el-bg-color));
    font-family: var(--m3-font-mono, ui-monospace, Menlo, monospace);
    font-size: 12px;
    line-height: 1.55;
    white-space: pre-wrap;
    word-break: break-word;
  }
}
</style>
