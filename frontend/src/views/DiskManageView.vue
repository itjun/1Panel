<template>
  <div class="tab-root" v-loading="loading && !list.length">
    <div class="toolbar">
      <span class="title">磁盘分区</span>
      <span class="muted">{{ list.length }} 个分区</span>
      <el-button size="small" :icon="Refresh" @click="loadDisks">刷新</el-button>
    </div>
    <el-alert
      v-if="error && !list.length"
      type="error"
      :title="error"
      show-icon
      :closable="false"
    />
    <el-row v-if="list.length" :gutter="12">
      <el-col
        v-for="d in list"
        :key="d.filesystem + d.mount"
        :xs="24"
        :sm="12"
        :md="8"
        :lg="6"
      >
        <div class="disk-card">
          <div class="disk-card-head">
            <span class="disk-dev" :title="d.filesystem">
              {{ shortDev(d.filesystem) }}
            </span>
            <el-tag v-if="d.fsType" size="small" type="info">
              {{ d.fsType }}
            </el-tag>
          </div>
          <div class="disk-mount">
            <span class="mount-path" :title="d.mount">{{ d.mount }}</span>
            <el-tag v-if="d.mount === '/'" size="small" type="warning">
              系统盘
            </el-tag>
          </div>
          <el-progress
            :percentage="Math.min(100, Math.max(0, d.percent))"
            :status="d.percent >= 90 ? 'exception' : 'success'"
            :text-inside="true"
            :stroke-width="14"
            class="disk-progress"
          />
          <div class="disk-detail">
            <div class="detail-row">
              <span class="detail-label">已用</span>
              <span class="detail-value">{{ formatBytes(d.used) }}</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">可用</span>
              <span class="detail-value">{{ formatBytes(d.avail) }}</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">总量</span>
              <span class="detail-value total">{{ formatBytes(d.total) }}</span>
            </div>
          </div>
        </div>
      </el-col>
    </el-row>
    <el-empty
      v-if="!loading && list.length === 0 && !error"
      description="未采集到磁盘数据"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from "vue";
import { Refresh } from "@element-plus/icons-vue";
import { api } from "@/api";
import type { monitor } from "@/api";
import { formatBytes } from "@/utils/format";

const props = defineProps<{ host: string }>();

const list = ref<monitor.DiskInfo[]>([]);
const loading = ref(false);
const error = ref<string | null>(null);

// /dev/sda1 → sda1；无 / 前缀则原样返回
function shortDev(fs: string): string {
  const idx = fs.lastIndexOf("/");
  return idx >= 0 ? fs.slice(idx + 1) : fs;
}

async function loadDisks() {
  loading.value = true;
  error.value = null;
  try {
    list.value = (await api.collectDisks(props.host)) || [];
  } catch (e) {
    error.value = String(e);
  } finally {
    loading.value = false;
  }
}

watch(() => props.host, () => loadDisks(), { immediate: true });
</script>

<style scoped>
.tab-root {
  height: 100%;
  min-height: 0;
  overflow: auto;
}
.toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 14px;
}
.title {
  font-size: 14px;
  font-weight: 500;
}
.muted {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  flex: 1;
}
.disk-card {
  border: 1px solid var(--el-border-color-light, #e4e7ed);
  border-radius: 4px;
  padding: 14px;
  margin-bottom: 12px;
  background: var(--el-bg-color, #fff);
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}
.disk-card:hover {
  border-color: var(--el-color-primary);
  box-shadow: 0 0 0 1px var(--el-color-primary);
}
.disk-card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 8px;
}
.disk-dev {
  font-size: 14px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.disk-mount {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 12px;
}
.mount-path {
  font-size: 13px;
  color: var(--el-text-color-regular);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: "JetBrains Mono", "Cascadia Code", Consolas, monospace;
}
.disk-progress {
  margin-bottom: 12px;
}
.disk-detail {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.detail-row {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
}
.detail-label {
  color: var(--el-text-color-secondary);
}
.detail-value {
  color: var(--el-text-color-regular);
}
.detail-value.total {
  font-weight: 600;
  color: var(--el-color-primary);
}
</style>
