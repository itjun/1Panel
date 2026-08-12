<template>
  <div class="tab-root" v-loading="loading && !list.length">
    <div class="toolbar">
      <span class="title">数据库</span>
      <span class="muted">{{ list.length }} 个</span>
      <el-button size="small" :icon="Refresh" @click="loadDatabases">刷新</el-button>
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
        v-for="db in list"
        :key="db.name"
        :xs="24"
        :sm="12"
        :md="8"
        :lg="6"
      >
        <div class="db-card">
          <div class="db-card-head">
            <div class="db-name-group">
              <span
                class="db-dot"
                :class="db.running ? 'running' : 'stopped'"
              />
              <span class="db-name">{{ db.name }}</span>
            </div>
            <el-tag v-if="db.version" size="small" type="info">
              {{ shortVersion(db.version) }}
            </el-tag>
          </div>
          <div class="db-status">
            <el-tag
              size="small"
              :type="db.running ? 'success' : 'info'"
              effect="light"
            >
              {{ db.running ? "运行中" : "已停止" }}
            </el-tag>
            <span v-if="db.port" class="db-port">
              端口 {{ db.port }}
            </span>
          </div>
          <div v-if="db.version" class="db-version-full" :title="db.version">
            {{ db.version }}
          </div>
        </div>
      </el-col>
    </el-row>
    <el-empty
      v-if="!loading && list.length === 0 && !error"
      description="未检测到数据库"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from "vue";
import { Refresh } from "@element-plus/icons-vue";
import { api } from "@/api";
import type { monitor } from "@/api";

const props = defineProps<{ host: string }>();

const list = ref<monitor.DatabaseInfo[]>([]);
const loading = ref(false);
const error = ref<string | null>(null);

// 版本号通常很长（如 "mysql  Ver 8.0.36 for Linux on x86_64 (MySQL Community Server)"）
// 标签里只显示前 3 个词
function shortVersion(v: string): string {
  const parts = v.trim().split(/\s+/);
  if (parts.length <= 3) return v.trim();
  // 找版本号模式（含数字的词）
  const verPart = parts.find((p) => /\d/.test(p));
  return verPart || parts.slice(0, 3).join(" ");
}

async function loadDatabases() {
  loading.value = true;
  error.value = null;
  try {
    list.value = (await api.collectDatabases(props.host)) || [];
  } catch (e) {
    error.value = String(e);
  } finally {
    loading.value = false;
  }
}

watch(() => props.host, () => loadDatabases(), { immediate: true });
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
.db-card {
  border: 1px solid var(--el-border-color-light, #e4e7ed);
  border-radius: 4px;
  padding: 14px;
  margin-bottom: 12px;
  background: var(--el-bg-color, #fff);
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}
.db-card:hover {
  border-color: var(--el-color-primary);
  box-shadow: 0 0 0 1px var(--el-color-primary);
}
.db-card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 10px;
}
.db-name-group {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.db-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}
.db-dot.running {
  background: var(--el-color-success);
  box-shadow: 0 0 4px var(--el-color-success);
}
.db-dot.stopped {
  background: var(--el-text-color-disabled);
}
.db-name {
  font-size: 15px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.db-status {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
}
.db-port {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  font-family: "JetBrains Mono", "Cascadia Code", Consolas, monospace;
}
.db-version-full {
  font-size: 11px;
  color: var(--el-text-color-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: "JetBrains Mono", "Cascadia Code", Consolas, monospace;
}
</style>
