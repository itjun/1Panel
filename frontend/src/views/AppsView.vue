<template>
  <div class="tab-root" v-loading="loading && !data">
    <div class="toolbar">
      <el-button size="large" @click="refresh">刷新</el-button>
      <span class="muted">
        Java {{ javaList.length }} · Docker {{ dockerAvailable ? dockerList.length : "—" }}
      </span>
    </div>
    <el-alert v-if="error && !data" type="error" :title="error" show-icon />
    <div class="apps-grid">
      <EnlargableCard :title="'Java · ' + javaList.length">
        <div class="app-scroll">
          <div v-if="!javaList.length" class="empty-tip">暂无 Java 进程</div>
          <div v-for="p in javaList" :key="'j-' + p.pid" class="app-row">
            <div class="app-meta">
              <div class="app-name" :title="p.cmd">{{ javaAppTitle(p.cmd) }}</div>
              <div class="app-img">
                PID {{ p.pid }} · CPU {{ (p.cpu || 0).toFixed(1) }}% ·
                {{ formatBytes(Number(p.rss) || 0) }}
              </div>
            </div>
            <el-tag size="small" type="warning">Java</el-tag>
          </div>
        </div>
      </EnlargableCard>
      <EnlargableCard
        :title="'Docker · ' + (dockerAvailable ? String(dockerList.length) : '—')"
      >
        <div class="app-scroll">
          <div v-if="!dockerAvailable" class="empty-tip">未检测到 Docker</div>
          <div v-else-if="!dockerList.length" class="empty-tip">暂无容器</div>
          <div v-for="c in dockerList" :key="c.id || c.name" class="app-row">
            <div class="app-meta">
              <div class="app-name">{{ c.name || c.id }}</div>
              <div class="app-img">{{ c.image || c.status }}</div>
            </div>
            <el-tag
              size="small"
              :type="(c.state || '').toLowerCase() === 'running' ? 'success' : 'info'"
            >
              {{ c.state || "—" }}
            </el-tag>
          </div>
        </div>
      </EnlargableCard>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { api } from "@/api";
import type { monitor } from "@/api";
import { formatBytes } from "@/utils/format";
import { usePolling } from "@/composables/usePolling";
import { useAppStore } from "@/stores/app";
import EnlargableCard from "@/components/EnlargableCard.vue";

interface AppsData {
  java: monitor.ProcInfo[];
  docker: monitor.DockerInfo | null;
}

const props = defineProps<{ host: string }>();
const app = useAppStore();

const { data, error, loading, refresh } = usePolling<AppsData>(
  async () => {
    const [java, docker] = await Promise.all([
      api.collectJava(props.host).catch(() => [] as monitor.ProcInfo[]),
      api.collectDocker(props.host).catch(() => null),
    ]);
    return { java: java || [], docker };
  },
  5000,
  () => props.host,
  () => app.isHostSubActive(props.host, "apps")
);

const javaList = computed(() => data.value?.java || []);
const docker = computed(() => data.value?.docker || null);
const dockerAvailable = computed(() => !!docker.value?.available);
const dockerList = computed(
  () => (docker.value?.containers || []) as monitor.Container[]
);

/** 从 java 命令行提取可读标题：优先 -jar 包名，其次疑似主类 */
function javaAppTitle(cmd: string): string {
  if (!cmd) return "java";
  const jar = cmd.match(/-jar\s+(\S+\.jar)/i);
  if (jar?.[1]) {
    const base = jar[1].split(/[/\\]/).pop() || jar[1];
    return base;
  }
  const tokens = cmd.split(/\s+/);
  for (let i = tokens.length - 1; i >= 0; i--) {
    const t = tokens[i];
    if (/^[a-zA-Z_][\w.]*\.[A-Z][\w$]*$/.test(t) && !t.includes("/")) {
      return t;
    }
  }
  return cmd.length > 48 ? cmd.slice(0, 46) + "…" : cmd;
}
</script>

<style scoped lang="scss">
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
.muted {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.apps-grid {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}
@media (max-width: 992px) {
  .apps-grid {
    grid-template-columns: 1fr;
  }
}
.app-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}
.empty-tip {
  text-align: center;
  color: var(--el-text-color-secondary);
  font-size: 13px;
  padding: 20px 0;
}
.app-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 0;
  border-bottom: 1px solid var(--el-border-color-extra-light, #f2f6fc);
  &:last-of-type {
    border-bottom: none;
  }
}
.app-meta {
  flex: 1;
  min-width: 0;
}
.app-name {
  font-size: 13px;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.app-img {
  font-size: 11px;
  color: var(--el-text-color-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
