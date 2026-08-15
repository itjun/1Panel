<template>
  <el-dialog
    :model-value="modelValue"
    :title="`最大文件 · ${mount}`"
    width="720px"
    append-to-body
    @update:model-value="(v: boolean) => emit('update:modelValue', v)"
    @open="scan"
  >
    <el-alert
      v-if="error"
      type="error"
      :title="error"
      show-icon
      :closable="false"
      style="margin-bottom: 10px"
    />
    <el-alert
      v-else-if="result?.incomplete"
      type="warning"
      :title="result?.message || '扫描超时，结果可能不完整'"
      show-icon
      :closable="false"
      style="margin-bottom: 10px"
    />
    <el-table
      v-loading="loading"
      :data="files"
      max-height="480"
      stripe
      :empty-text="loading ? '正在扫描（可能需要几十秒）…' : '暂无数据'"
    >
      <el-table-column label="#" type="index" width="44" />
      <el-table-column label="大小" width="110">
        <template #default="{ row }">
          <span class="mono">{{ formatBytes(row.size) }}</span>
        </template>
      </el-table-column>
      <el-table-column prop="name" label="文件" min-width="200" show-overflow-tooltip />
      <el-table-column prop="dir" label="位置" min-width="240" show-overflow-tooltip>
        <template #default="{ row }">
          <span class="mono">{{ row.dir }}</span>
        </template>
      </el-table-column>
    </el-table>
    <template #footer>
      <span v-if="result" class="largest-meta">
        共 {{ files.length }} 个 · 耗时 {{ (result.elapsedMs / 1000).toFixed(1) }}s
      </span>
      <el-button :loading="loading" @click="scan">重新扫描</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { api } from "@/api";
import type { monitor } from "@/api";
import { formatBytes } from "@/utils/format";

const props = defineProps<{
  modelValue: boolean;
  host: string;
  /** 挂载点，如 / 或 /data */
  mount: string;
}>();
const emit = defineEmits<{ "update:modelValue": [boolean] }>();

const loading = ref(false);
const result = ref<monitor.LargeFilesResult | null>(null);
const error = ref<string | null>(null);

/** 再按大小倒序兜底排一次，确保展示顺序 */
const files = computed(() =>
  [...(result.value?.files || [])].sort((a, b) => b.size - a.size)
);

async function scan() {
  loading.value = true;
  error.value = null;
  result.value = null;
  try {
    result.value = await api.collectLargestFiles(props.host, props.mount, 15);
  } catch (e) {
    error.value = `扫描失败: ${e}`;
  } finally {
    loading.value = false;
  }
}
</script>

<style scoped>
.mono {
  font-family: "JetBrains Mono", "Cascadia Code", Consolas, monospace;
  font-size: 12px;
}
.largest-meta {
  margin-right: 12px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
</style>
