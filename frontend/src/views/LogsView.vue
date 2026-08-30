<template>
  <div class="tab-root">
    <EnlargableCard title="日志">
    <!-- 三级日志类型标签：照搬 1Panel LayoutContent search 卡 + LogRouter tag-button -->
    <div class="view-toolbar">
      <div class="view-toolbar__chips">
        <TagButton
          :model-value="currentLogType"
          :buttons="logTypeButtons"
          @update:model-value="(v: string) => { currentLogType = v; loadLog(); }"
        />
      </div>
      <div class="view-toolbar__tools">
          <el-select v-model="lines" style="width: 110px" @change="loadLog">
            <el-option :value="100" label="100 行" />
            <el-option :value="500" label="500 行" />
            <el-option :value="1000" label="1000 行" />
            <el-option :value="2000" label="2000 行" />
          </el-select>
          <el-input
            v-model="search"
            placeholder="搜索过滤"
            clearable
            style="width: 180px"
            :prefix-icon="Search"
          />
          <el-button
            type="primary"
            :icon="Refresh"
            :loading="loading"
            @click="loadLog"
          >
            刷新
          </el-button>
      </div>
    </div>
    <el-alert
      v-if="error"
      type="error"
      :title="error"
      show-icon
      :closable="false"
    />
    <div v-loading="loading && !result" class="log-body">
      <template v-if="result">
        <pre
          v-if="result.source"
          ref="preRef"
          class="log-pre"
        >{{ filteredContent || '(无匹配行)' }}</pre>
        <el-empty
          v-else
          description="未找到日志文件，该主机可能无此类日志"
        />
      </template>
    </div>
    <div v-if="result?.source" class="status-bar">
      <span>来源: {{ result.source }}</span>
      <span class="sep">|</span>
      <span>{{ contentLines }} 行</span>
    </div>
    </EnlargableCard>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick } from "vue";
import { Refresh, Search } from "@element-plus/icons-vue";
import { api } from "@/api";
import type { monitor } from "@/api";
import { formatErr } from "@/utils/format";
import { useAppStore } from "@/stores/app";
import EnlargableCard from "@/components/EnlargableCard.vue";
import TagButton from "@/components/TagButton.vue";

const props = defineProps<{ host: string }>();

const logTypes = [
  { key: "system", label: "系统日志" },
  { key: "auth", label: "认证日志" },
  { key: "kernel", label: "内核日志" },
  { key: "nginx_access", label: "Nginx 访问" },
  { key: "nginx_error", label: "Nginx 错误" },
] as const;
/** RouterButton 的按钮列表 */
const logTypeButtons = logTypes.map((t) => ({ value: t.key, label: t.label }));

const currentLogType = ref<string>("system");
const lines = ref(500);
const search = ref("");
const result = ref<monitor.LogResult | null>(null);
const loading = ref(false);
const error = ref<string | null>(null);
const preRef = ref<HTMLPreElement | null>(null);

// 搜索过滤：只显示匹配行
const filteredContent = computed(() => {
  if (!result.value?.content) return "";
  const kw = search.value.trim().toLowerCase();
  if (!kw) return result.value.content;
  return result.value.content
    .split("\n")
    .filter((l) => l.toLowerCase().includes(kw))
    .join("\n");
});

const contentLines = computed(() => {
  if (!result.value?.content) return 0;
  return result.value.content.split("\n").length;
});

async function loadLog() {
  loading.value = true;
  error.value = null;
  try {
    result.value = await api.collectLog(
      props.host,
      currentLogType.value,
      lines.value
    );
  } catch (e) {
    error.value = formatErr(e);
  } finally {
    loading.value = false;
    // 日志最新内容在末尾，自动滚到底部
    nextTick(() => {
      if (preRef.value) preRef.value.scrollTop = preRef.value.scrollHeight;
    });
  }
}

// 首次进入 / 切换主机时自动加载；子页常驻后切回时补刷一次（日志滚动到最新）
const app = useAppStore();
watch(
  () => props.host,
  () => {
    result.value = null;
    loadLog();
  },
  { immediate: true }
);
watch(
  () => app.isHostSubActive(props.host, "logs"),
  (now, prev) => {
    if (now && !prev) void loadLog();
  }
);
</script>

<style scoped>
.tab-root {
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
/* 三级标签卡：照搬 1Panel LayoutContent content-container__search */
.log-body {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  border: 1px solid var(--m3-outline-variant, #cac4d0);
  border-radius: var(--m3-shape-m, 12px);
  background: var(--m3-surface-container-lowest, #fff);
  display: flex;
}
.log-pre {
  flex: 1;
  margin: 0;
  padding: 10px 12px;
  overflow: auto;
  font-family: "JetBrains Mono", "Cascadia Code", "Fira Code", Consolas,
    "Liberation Mono", Menlo, monospace;
  font-size: 12.5px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-all;
  color: var(--el-text-color-regular);
}
.status-bar {
  margin-top: 8px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
  display: flex;
  align-items: center;
  gap: 6px;
}
.sep {
  opacity: 0.5;
}
</style>
