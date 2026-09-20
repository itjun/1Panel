<template>
  <div class="notify-subs">
    <div class="subs-bar">
      <RouterButton v-model="groupFilter" compact :buttons="groupButtons" />
      <span class="subs-hint">设置里关掉的类型或通道，这里订了也不会发</span>
    </div>

    <div class="subs-table">
      <el-empty
        v-if="!visibleHosts.length"
        description="没有匹配的主机"
        :image-size="64"
      />

      <el-table
        v-else-if="kind === 'metric'"
        :data="visibleHosts"
        row-key="name"
        height="100%"
        class="subs-grid"
        empty-text="没有匹配的主机"
      >
        <el-table-column
          prop="name"
          label="主机"
          min-width="160"
          fixed
          show-overflow-tooltip
        />
        <el-table-column
          v-for="rule in ALERT_RULES"
          :key="rule.kind"
          :label="rule.name"
          min-width="88"
          align="center"
        >
          <template #default="{ row }">
            <el-switch
              :model-value="
                settings.isResourceNotifySubscribed(row.name, rule.kind)
              "
              @change="
                (v: string | number | boolean) =>
                  settings.setResourceNotifySubscribed(
                    row.name,
                    rule.kind,
                    Boolean(v)
                  )
              "
            />
          </template>
        </el-table-column>
      </el-table>

      <el-table
        v-else
        :data="visibleHosts"
        row-key="name"
        height="100%"
        class="subs-grid"
        empty-text="没有匹配的主机"
      >
        <el-table-column
          prop="name"
          label="主机"
          min-width="160"
          fixed
          show-overflow-tooltip
        />
        <el-table-column
          v-for="svcName in WATCH_SERVICE_ORDER"
          :key="svcName"
          :label="serviceLabel(svcName)"
          min-width="96"
          align="center"
        >
          <template #default="{ row }">
            <el-switch
              :model-value="settings.isAppNotifySubscribed(row.name, svcName)"
              @change="
                (v: string | number | boolean) =>
                  settings.setAppNotifySubscribed(row.name, svcName, Boolean(v))
              "
            />
          </template>
        </el-table-column>
      </el-table>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import RouterButton from "@/components/RouterButton.vue";
import { useAppStore } from "@/stores/app";
import { useSettingsStore } from "@/stores/settings";
import { ALERT_RULES } from "@/utils/alerts";
import {
  WATCH_SERVICE_META,
  WATCH_SERVICE_ORDER,
  type WatchServiceName,
} from "@/utils/watchServices";

const UNGROUPED = "未分组";

const props = defineProps<{
  kind: "metric" | "app";
}>();

const app = useAppStore();
const settings = useSettingsStore();
const groupFilter = ref("all");

function serviceLabel(name: WatchServiceName): string {
  const meta = WATCH_SERVICE_META.find((s) => s.name === name);
  if (meta) return meta.label;
  return name;
}

const hostGroupMap = computed(() => {
  const map = new Map<string, string>();
  for (const node of app.groupNodes) {
    const label = node.group?.name?.trim() || UNGROUPED;
    for (const h of node.hosts) {
      if (!map.has(h.name)) map.set(h.name, label);
    }
  }
  for (const h of app.hosts) {
    if (!map.has(h.name)) map.set(h.name, UNGROUPED);
  }
  return map;
});

const groupButtons = computed(() => {
  const names = new Set<string>();
  for (const label of hostGroupMap.value.values()) {
    names.add(label);
  }
  const sorted = [...names].sort((a, b) => {
    if (a === UNGROUPED) return 1;
    if (b === UNGROUPED) return -1;
    return a.localeCompare(b, "zh-CN");
  });
  return [
    { value: "all", label: "全部" },
    ...sorted.map((g) => ({ value: g, label: g })),
  ];
});

const visibleHosts = computed(() => {
  const gf = groupFilter.value;
  const groupMap = hostGroupMap.value;
  const rows: { name: string }[] = [];
  for (const h of app.hosts) {
    const name = h.name || "";
    if (!name) continue;
    const groupLabel = groupMap.get(name) || UNGROUPED;
    if (gf !== "all" && groupLabel !== gf) continue;
    rows.push({ name });
  }
  rows.sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
  return rows;
});
</script>

<style scoped lang="scss">
.notify-subs {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  min-width: 0;
  background: var(--m3-content);
}

.subs-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
  padding: 8px 12px;
  overflow: hidden;
}

.subs-hint {
  margin-left: auto;
  min-width: 0;
  font: var(--m3-body-small);
  color: var(--m3-on-surface-variant);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.subs-table {
  flex: 1;
  min-height: 0;
  padding: 0 12px 12px;
  display: flex;
  flex-direction: column;
}

.subs-grid {
  width: 100%;
  flex: 1;
  min-height: 0;

  :deep(.el-table__header th) {
    font: var(--m3-label-medium);
    font-weight: 600;
    color: var(--m3-on-surface-variant);
    background: color-mix(in srgb, var(--m3-on-surface) 3%, var(--m3-surface));
  }

  :deep(.el-table__cell) {
    padding: 4px 8px;
  }

  :deep(.el-table__body td) {
    font: var(--m3-body-small);
    color: var(--m3-on-surface);
  }

  :deep(.el-table__body-wrapper),
  :deep(.el-table__header-wrapper) {
    overflow-x: auto;
  }
}

@media (max-width: 860px) {
  .subs-hint {
    display: none;
  }
}
</style>
