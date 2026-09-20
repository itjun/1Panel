<template>
  <Teleport to="body">
    <div
      v-if="node"
      class="local-app-detail-card"
      :style="{ left: x + 'px', top: y + 'px' }"
      @mousedown.stop
    >
      <div class="detail-title">
        <div class="title-main">
          <span class="title-name">{{ node.name || "—" }}</span>
          <span v-if="node.kind === 'proc' && node.pid" class="pid-tag mono">
            PID {{ node.pid }}
          </span>
          <span
            v-else-if="node.kind === 'thr' && node.tid != null"
            class="pid-tag mono"
          >
            TID {{ node.tid }}
          </span>
          <span v-else-if="node.runtime" class="pid-tag">
            {{ runtimeLabel(node.runtime) }}
          </span>
        </div>
        <el-button size="small" text class="close-btn" v-tip="'关闭'" @click="emit('close')">
          ×
        </el-button>
      </div>

      <div class="detail-rows">
        <template v-if="node.kind === 'thr'">
          <div class="d-row">
            <span class="k">说明</span>
            <span class="v">线程不单独统计内存 / 磁盘 / 网络</span>
          </div>
          <div class="d-row">
            <span class="k">CPU</span>
            <span class="v mono">{{ fmtCpu(node.cpu) }}%</span>
          </div>
          <div class="d-row">
            <span class="k">状态</span>
            <span class="v mono">{{ node.state || "—" }}</span>
          </div>
          <div class="d-row" v-if="node.pid">
            <span class="k">所属 PID</span>
            <span class="v mono">{{ node.pid }}</span>
          </div>
        </template>

        <template v-else>
          <div class="d-row" v-if="node.runtime">
            <span class="k">运行时</span>
            <span class="v">{{ runtimeLabel(node.runtime) }}</span>
          </div>
          <div class="d-row" v-if="node.kind === 'proc'">
            <span class="k">PID / PPID</span>
            <span class="v mono">{{ node.pid ?? "—" }} / {{ node.ppid ?? "—" }}</span>
          </div>
          <div class="d-row" v-if="node.kind === 'app'">
            <span class="k">进程 / 线程</span>
            <span class="v mono">
              {{ node.procCount ?? 0 }} / {{ node.threadCount ?? 0 }}
            </span>
          </div>
          <div class="d-row" v-if="node.user">
            <span class="k">用户</span>
            <span class="v mono">{{ node.user }}</span>
          </div>
          <div class="d-row">
            <span class="k">CPU / 内存</span>
            <span class="v mono">
              {{ fmtCpu(node.cpu) }}% / {{ formatBytes(node.rss || 0) }}
            </span>
          </div>
          <div class="d-row" v-if="node.kind === 'proc' && node.threadCount != null">
            <span class="k">线程数</span>
            <span class="v mono">{{ node.threadCount }}</span>
          </div>
          <div class="d-row" v-if="node.elapsed != null && node.elapsed > 0">
            <span class="k">已运行</span>
            <span class="v">{{ formatDurationLong(node.elapsed) }}</span>
          </div>
          <div class="d-row" v-if="node.exe">
            <span class="k">可执行</span>
            <span class="v mono break">{{ node.exe }}</span>
          </div>
          <div class="d-row" v-if="node.cwd">
            <span class="k">工作目录</span>
            <span class="v mono break">{{ node.cwd }}</span>
          </div>
          <div class="d-row" v-if="node.ports && node.ports.length">
            <span class="k">端口</span>
            <span class="v mono">{{ node.ports.join("、") }}</span>
          </div>
          <div class="d-row" v-if="node.cmd">
            <span class="k">命令</span>
            <span class="v mono break">{{ node.cmd }}</span>
          </div>
          <div v-for="[k, v] in extraEntries" :key="k" class="d-row">
            <span class="k">{{ k }}</span>
            <span class="v mono break">{{ v }}</span>
          </div>
        </template>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
/**
 * 本机应用详情浮动卡片：由右键「查看详情」打开，只读展示。
 */
import { computed } from "vue";
import type { LocalCardNode } from "@/components/LocalAppContextMenu.vue";
import { formatBytes, formatDurationLong } from "@/utils/format";
import { localLangLabel } from "@/utils/localLang";

const props = defineProps<{
  node: LocalCardNode | null;
  x: number;
  y: number;
}>();

const emit = defineEmits<{ close: [] }>();

const extraEntries = computed(() => {
  const ex = props.node?.extra;
  if (!ex) return [] as [string, string][];
  return Object.entries(ex).filter(([, v]) => v != null && String(v).length > 0) as [
    string,
    string,
  ][];
});

function fmtCpu(n: number | undefined) {
  return Number(n || 0).toFixed(2);
}

function runtimeLabel(rt: string) {
  return localLangLabel(rt);
}
</script>

<style>
.local-app-detail-card {
  position: fixed;
  z-index: 3002;
  width: 560px;
  max-width: calc(100vw - 16px);
  max-height: min(70vh, 520px);
  overflow-y: auto;
  padding: 16px;
  box-sizing: border-box;
  border-radius: var(--m3-shape-m, 12px);
  background: var(--m3-surface-container-lowest, #fff);
  border: 1px solid var(--m3-outline-variant, #e4e7ed);
  box-shadow: var(--m3-elevation-3);
  font: var(--m3-body-small);
  color: var(--m3-on-surface, #1a1a1d);
}

.local-app-detail-card .detail-title {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin-bottom: 12px;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--el-border-color-lighter);
}

.local-app-detail-card .title-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 8px;
}

.local-app-detail-card .title-name {
  font-size: 14px;
  font-weight: 600;
  line-height: 1.4;
  word-break: break-word;
}

.local-app-detail-card .pid-tag {
  font-weight: 400;
  font-size: 11px;
  color: var(--el-text-color-secondary);
}

.local-app-detail-card .close-btn {
  flex-shrink: 0;
  padding: 0 4px;
  font-size: 18px;
  font-weight: 600;
  color: var(--el-color-danger) !important;
}

.local-app-detail-card .detail-rows {
  display: flex;
  flex-direction: column;
}

.local-app-detail-card .d-row {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 5px 0;
  line-height: 1.5;
}

.local-app-detail-card .k {
  flex-shrink: 0;
  width: 72px;
  color: var(--el-text-color-secondary);
}

.local-app-detail-card .v {
  flex: 1;
  min-width: 0;
  overflow-wrap: anywhere;
  word-break: break-word;
}

.local-app-detail-card .v.mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 11px;
}
</style>
