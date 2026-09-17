<template>
  <div class="tab-root tab-table-page">
    <EnlargableCard bare class="tab-enl">
      <div class="view-toolbar">
        <div class="view-toolbar__chips">
          <TagButton v-model="source" :buttons="sourceButtons" />
        </div>
        <div class="view-toolbar__tools">
          <el-input
            v-model="keyword"
            clearable
            class="filter-input"
            placeholder="搜索名称 / 路径…"
          />
          <el-button :icon="Refresh" :loading="loading" @click="refresh" />
        </div>
      </div>

      <PageSkeleton v-if="loading && !rows.length" variant="table" :show-toolbar="false" />
      <el-alert
        v-else-if="error && !rows.length"
        type="error"
        :title="error"
        show-icon
        :closable="false"
      />

      <div v-else-if="filtered.length" class="table-wrap m3-table-surface">
        <el-table
          :data="filtered"
          style="width: 100%"
          class="data-table-unified"
          height="100%"
        >
          <el-table-column type="index" label="序" width="64" align="center" />
          <el-table-column prop="name" label="名称" min-width="180" show-overflow-tooltip />
          <el-table-column prop="version" label="版本" min-width="120" show-overflow-tooltip>
            <template #default="{ row }">
              <span class="mono">{{ row.version || "—" }}</span>
            </template>
          </el-table-column>
          <el-table-column label="来源" min-width="100">
            <template #default="{ row }">
              {{ sourceLabel(row.source) }}
            </template>
          </el-table-column>
          <el-table-column prop="path" label="路径" min-width="280" show-overflow-tooltip>
            <template #default="{ row }">
              <span class="mono">{{ row.path || "—" }}</span>
            </template>
          </el-table-column>
        </el-table>
      </div>

      <el-empty
        v-if="!loading && !error && !filtered.length"
        description="未找到已安装软件"
      />
    </EnlargableCard>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { Refresh } from "@element-plus/icons-vue";
import { api } from "@/api";
import type { localsys } from "@/api";
import EnlargableCard from "@/components/EnlargableCard.vue";
import PageSkeleton from "@/components/PageSkeleton.vue";
import TagButton from "@/components/TagButton.vue";
import { usePolling } from "@/composables/usePolling";
import { useAppStore } from "@/stores/app";

const app = useAppStore();
const keyword = ref("");
const source = ref<"all" | "app" | "formula" | "cask">("all");

const { data, error, loading, refresh } = usePolling<localsys.Package[]>(
  () => api.localSysPackages(),
  0,
  () => "local-packages",
  () =>
    app.workspace === "local" &&
    app.localSection === "packages" &&
    !app.settingsOpen
);

const rows = computed(() => data.value || []);

const sourceButtons = computed(() => {
  const all = rows.value;
  const count = (s: string) => all.filter((p) => p.source === s).length;
  return [
    { value: "all", label: "全部", count: all.length || undefined },
    { value: "app", label: "应用程序", count: count("app") || undefined },
    { value: "formula", label: "Formula", count: count("formula") || undefined },
    { value: "cask", label: "Cask", count: count("cask") || undefined },
  ];
});

const filtered = computed(() => {
  let list = rows.value;
  if (source.value !== "all") {
    list = list.filter((p) => p.source === source.value);
  }
  const q = keyword.value.trim().toLowerCase();
  if (!q) return list;
  return list.filter(
    (p) =>
      (p.name || "").toLowerCase().includes(q) ||
      (p.path || "").toLowerCase().includes(q) ||
      (p.version || "").toLowerCase().includes(q)
  );
});

function sourceLabel(s: string) {
  if (s === "app") return "应用程序";
  if (s === "formula") return "Formula";
  if (s === "cask") return "Cask";
  return s || "—";
}
</script>

<style scoped lang="scss">
.mono {
  font-family: var(--m3-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
}
.table-wrap {
  flex: 1;
  min-height: 0;
}
</style>
