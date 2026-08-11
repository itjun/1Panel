<template>
  <div class="tab-root" v-loading="loading && !list.length">
    <div class="toolbar">
      <span class="title">正在运行的 systemd 服务</span>
      <el-button size="small" @click="refresh">刷新</el-button>
      <span class="muted">{{ list.length }} 个</span>
    </div>
    <el-alert v-if="error && !list.length" type="error" :title="error" show-icon />
    <div class="grid">
      <div v-for="s in list" :key="s.name" class="item">
        <span class="dot" />
        <span class="name" :title="s.name">{{ s.name }}</span>
        <el-tag size="small" type="info">{{ s.sub || s.active || "—" }}</el-tag>
      </div>
    </div>
    <el-empty
      v-if="!loading && list.length === 0 && !error"
      description="未采集到 systemd 服务（目标机可能不是 systemd）"
    />
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { api } from "@/api";
import { usePolling } from "@/composables/usePolling";

interface Service {
  name: string;
  load?: string;
  active?: string;
  sub?: string;
}

const props = defineProps<{ host: string }>();
const { data, error, loading, refresh } = usePolling<Service[]>(
  () => api.collectServices(props.host) as Promise<Service[]>,
  30_000,
  () => props.host
);
const list = computed(() => data.value || []);
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
  margin-bottom: 12px;
}
.title {
  font-weight: 600;
  font-size: 14px;
}
.muted {
  margin-left: auto;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}
.item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border: 1px solid var(--el-border-color);
  border-radius: 8px;
  background: var(--el-bg-color);
}
.dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--el-color-success);
  flex-shrink: 0;
}
.name {
  flex: 1;
  min-width: 0;
  font-size: 12px;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
@media (max-width: 1100px) {
  .grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
