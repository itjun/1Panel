<template>
  <div class="tab-root" v-loading="loading && !list.length">
    <EnlargableCard title="定时任务">
    <div class="toolbar">
      <el-button size="large" @click="refresh">刷新</el-button>
    </div>
    <el-alert v-if="error && !list.length" type="error" :title="error" show-icon />
    <el-table :data="rows" height="100%" size="small" stripe empty-text="未发现定时任务">
      <el-table-column label="来源" width="110">
        <template #default="{ row }">
          <el-tag size="small">{{ sourceLabel(row.source) }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="user" label="用户" width="100">
        <template #default="{ row }">{{ row.user || "—" }}</template>
      </el-table-column>
      <el-table-column prop="schedule" label="调度" width="160">
        <template #default="{ row }">
          <span class="mono">{{ row.schedule }}</span>
        </template>
      </el-table-column>
      <el-table-column prop="cmd" label="命令" min-width="280" show-overflow-tooltip>
        <template #default="{ row }">
          <span class="mono">{{ row.cmd }}</span>
        </template>
      </el-table-column>
    </el-table>
    </EnlargableCard>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { api } from "@/api";
import { usePolling } from "@/composables/usePolling";
import { useAppStore } from "@/stores/app";
import EnlargableCard from "@/components/EnlargableCard.vue";

interface Cron {
  user: string;
  line: string;
  source: string;
}

const SOURCE_LABEL: Record<string, string> = {
  user: "用户",
  "etc-crontab": "系统主表",
  "etc-cron.d": "扩展",
};

const props = defineProps<{ host: string }>();
const app = useAppStore();
const { data, error, loading, refresh } = usePolling<Cron[]>(
  () => api.collectCrons(props.host) as Promise<Cron[]>,
  0,
  () => props.host,
  // 子页常驻后切回补刷一次
  () => app.isHostSubActive(props.host, "cron")
);

const list = computed(() => data.value || []);
const rows = computed(() =>
  list.value.map((c) => {
    const fields = (c.line || "").split(/\s+/).filter(Boolean);
    const isSystem = c.source !== "user";
    const schedule = fields.slice(0, 5).join(" ");
    const cmd = isSystem ? fields.slice(6).join(" ") : fields.slice(5).join(" ");
    return { ...c, schedule, cmd };
  })
);

function sourceLabel(s: string) {
  return SOURCE_LABEL[s] || s || "—";
}
</script>

<style scoped>
.tab-root {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  gap: 8px;
}
.toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
}
.title {
  font-weight: 600;
}
.mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, monospace;
  font-size: 12px;
}
:deep(.el-table) {
  flex: 1;
}
</style>
