<template>
  <div class="tab-root tab-table-page local-hosts">
    <div class="view-toolbar">
      <div class="view-toolbar__chips">
        <span class="panel-section-title">Hosts</span>
        <span class="page-toolbar__hint">/etc/hosts · 只读</span>
      </div>
      <div class="view-toolbar__tools">
        <el-input
          v-model="keyword"
          clearable
          class="filter-input"
          placeholder="搜索域名 / IP…"
        />
        <el-button
          :disabled="!info?.raw"
          :type="rawMode ? 'primary' : 'default'"
          @click="rawMode = !rawMode"
        >
          {{ rawMode ? "收起原文" : "查看原文" }}
        </el-button>
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

    <div
      v-else-if="info"
      ref="bodyRef"
      class="hosts-body"
      :class="{ 'is-raw': rawMode, 'is-resizing': resizing }"
      :style="
        rawMode
          ? {
              gridTemplateColumns: `${tablePercent}fr 5px ${100 - tablePercent}fr`,
            }
          : undefined
      "
    >
      <div class="table-wrap m3-table-surface">
        <el-table
          :data="filteredEntries"
          stripe
          :fit="false"
          class="data-table-unified hosts-entries-table"
          height="100%"
          style="width: 100%"
        >
          <el-table-column type="index" label="序" width="52" align="center" />
          <!-- 主机名 / IP / 状态固定宽，注释吃剩余 -->
          <el-table-column label="主机名" width="200" show-overflow-tooltip>
            <template #default="{ row }">
              <span :class="{ disabled: row.disabled }">
                {{ (row.names || []).join(" ") }}
              </span>
            </template>
          </el-table-column>
          <el-table-column prop="ip" label="IP" width="152" show-overflow-tooltip>
            <template #default="{ row }">
              <span class="mono" :class="{ disabled: row.disabled }">{{ row.ip }}</span>
            </template>
          </el-table-column>
          <el-table-column label="状态" width="88">
            <template #default="{ row }">
              {{ row.disabled ? "已注释" : "生效" }}
            </template>
          </el-table-column>
          <el-table-column prop="comment" label="注释" show-overflow-tooltip />
        </el-table>
      </div>

      <div
        v-if="rawMode"
        class="hosts-split-handle"
        v-tip="'拖动调整比例；双击恢复各半'"
        @pointerdown="onResizeStart"
        @dblclick="onResizeDblClick"
      />

      <CodePane
        v-if="rawMode"
        class="hosts-raw"
        :html="rawHtml"
        :text="info.raw || ''"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { Refresh } from "@element-plus/icons-vue";
import { api } from "@/api";
import type { localsys } from "@/api";
import CodePane from "@/components/CodePane.vue";
import PageSkeleton from "@/components/PageSkeleton.vue";
import { useHostsSplit } from "@/composables/useHostsSplit";
import { usePolling } from "@/composables/usePolling";
import { useAppStore } from "@/stores/app";
import { plainCodeHtml } from "@/utils/plainCode";

const app = useAppStore();
const rawMode = ref(false);
const keyword = ref("");
const { tablePercent, resizing, bodyRef, onResizeStart, onResizeDblClick } =
  useHostsSplit();

const { data: info, error, loading, refresh } = usePolling<localsys.HostsInfo>(
  () => api.localSysHosts(),
  0,
  () => "local-hosts",
  () =>
    app.workspace === "local" &&
    app.localSection === "hosts" &&
    !app.settingsOpen
);

const filteredEntries = computed(() => {
  const list = info.value?.entries || [];
  const q = keyword.value.trim().toLowerCase();
  if (!q) return list;
  return list.filter((e) => {
    if ((e.ip || "").toLowerCase().includes(q)) return true;
    return (e.names || []).some((n) => (n || "").toLowerCase().includes(q));
  });
});

const rawHtml = computed(() => plainCodeHtml(info.value?.raw || ""));
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

.hosts-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: row;
  gap: 0;
  overflow: hidden;

  &.is-raw {
    display: grid;
    border: 1px solid var(--m3-outline-variant);
    border-radius: var(--m3-shape-s);
  }

  &.is-resizing {
    user-select: none;
    cursor: col-resize;
  }
}

.table-wrap {
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  overflow-x: auto;
}

/* 序+主机名+IP+状态保底；注释无固定宽，吃掉剩余 */
.hosts-entries-table {
  width: 100% !important;
  min-width: 492px;
}

.table-wrap :deep(.hosts-entries-table) {
  table {
    width: 100% !important;
    table-layout: fixed;
  }

  .el-table__header-wrapper,
  .el-table__body-wrapper {
    .el-scrollbar__wrap {
      overflow-x: auto !important;
    }
  }

  .el-scrollbar__bar.is-horizontal {
    display: block !important;
  }
}

.hosts-split-handle {
  position: relative;
  z-index: 2;
  cursor: col-resize;
  touch-action: none;
  background: transparent;

  &::after {
    content: "";
    position: absolute;
    top: 0;
    left: 1px;
    width: 2px;
    height: 100%;
    border-radius: 1px;
    background: var(--m3-outline-variant);
    transition: background var(--m3-motion-state);
  }

  &:hover::after,
  .hosts-body.is-resizing &::after {
    background: var(--m3-primary);
  }
}

.hosts-raw {
  min-width: 0;
  min-height: 0;
}

.mono {
  font-family: var(--m3-font-mono, ui-monospace, Menlo, monospace);
}

.disabled {
  opacity: 0.55;
  text-decoration: line-through;
}

@media (max-width: 900px) {
  .hosts-body.is-raw {
    grid-template-columns: 1fr !important;
    grid-template-rows: minmax(0, 58%) 0 minmax(0, 42%);
  }

  .hosts-split-handle {
    display: none;
  }

  .hosts-raw {
    border-top: 1px solid var(--m3-outline-variant);
  }
}
</style>
