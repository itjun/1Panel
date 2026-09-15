<template>
  <div class="tab-root tab-table-page">
    <EnlargableCard bare class="tab-enl">
      <div class="view-toolbar enl-head-zone">
        <div class="view-toolbar__chips">
          <span class="toolbar-meta">{{ filtered.length }} / {{ list.length }}</span>
        </div>
        <div class="view-toolbar__tools">
          <el-input
            v-model="filter"
            clearable
            class="filter-input"
            placeholder="搜索服务名/描述..."
          />
          <el-button :loading="loading" @click="refresh">刷新</el-button>
        </div>
      </div>

      <PageSkeleton v-if="loading && !list.length" variant="table" :show-toolbar="false" />
      <el-alert v-else-if="error && !list.length" type="error" :title="error" show-icon />

      <div
        v-else-if="list.length"
        ref="tableWrap"
        class="table-wrap m3-table-surface m3-table-v2"
        @mouseleave="hideCard"
      >
        <el-table-v2
          v-if="size.width.value > 0"
          :columns="svcColumns"
          :data="filtered"
          :width="size.width.value"
          :height="size.height.value"
          :row-height="M3_TABLE_ROW_HEIGHT"
          :header-height="M3_TABLE_HEADER_HEIGHT"
          :row-class="zebraRowClass"
          :row-event-handlers="rowEventHandlers"
        >
          <template #empty>无匹配服务</template>
        </el-table-v2>
      </div>

      <el-empty
        v-if="!loading && list.length === 0 && !error"
        description="未采集到 systemd 服务（目标机可能不是 systemd）"
      />
    </EnlargableCard>

    <Teleport to="body">
      <div
        v-if="card.visible"
        class="svc-hover-card"
        :style="{ left: card.x + 'px', top: card.y + 'px' }"
      >
        <template v-if="detailOf(card.name)">
          <div class="detail-title">{{ detailOf(card.name)?.description || card.name }}</div>
          <div class="detail-rows">
            <div class="d-row">
              <span class="k">服务名</span>
              <span class="v mono">{{ detailOf(card.name)?.id || card.name }}</span>
            </div>
            <div class="d-row">
              <span class="k">状态</span>
              <span class="v">
                {{ detailOf(card.name)?.activeState || "—" }}
                ({{ detailOf(card.name)?.subState || "—" }})
              </span>
            </div>
            <div class="d-row">
              <span class="k">主 PID</span>
              <span class="v mono">{{ detailOf(card.name)?.mainPid || "—" }}</span>
            </div>
            <div class="d-row">
              <span class="k">运行用户</span>
              <span class="v mono">{{ detailOf(card.name)?.user || "—" }}</span>
            </div>
            <div class="d-row">
              <span class="k">启动时间</span>
              <span class="v">{{ detailOf(card.name)?.activeEnterTimestamp || "—" }}</span>
            </div>
            <div class="d-row">
              <span class="k">内存占用</span>
              <span class="v">{{ formatMem(detailOf(card.name)?.memoryCurrent) }}</span>
            </div>
            <div class="d-row">
              <span class="k">CPU 时间</span>
              <span class="v">{{ formatCpu(detailOf(card.name)?.cpuTimeNsec) }}</span>
            </div>
            <div class="d-row">
              <span class="k">重启策略</span>
              <span class="v">{{ detailOf(card.name)?.restart || "—" }}</span>
            </div>
            <div class="d-row">
              <span class="k">单元文件</span>
              <span class="v mono break">{{ detailOf(card.name)?.fragmentPath || "—" }}</span>
            </div>
            <div class="d-row">
              <span class="k">启动命令</span>
              <span class="v mono break">{{ detailOf(card.name)?.execStart || "—" }}</span>
            </div>
          </div>
        </template>
        <div v-else class="detail-loading">
          <el-icon class="is-loading"><Loading /></el-icon>
          正在查询服务详情…
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { computed, h, reactive, ref } from "vue";
import { ElTag } from "element-plus";
import type { Column, RowEventHandlers } from "element-plus";
import { Loading } from "@element-plus/icons-vue";
import { api } from "@/api";
import { usePolling } from "@/composables/usePolling";
import { useContainerSize } from "@/composables/useContainerSize";
import { useAppStore } from "@/stores/app";
import EnlargableCard from "@/components/EnlargableCard.vue";
import PageSkeleton from "@/components/PageSkeleton.vue";
import {
  M3_TABLE_HEADER_HEIGHT,
  M3_TABLE_ROW_HEIGHT,
  m3TableIndexColumn,
  zebraRowClass,
} from "@/constants/m3Table";
import { tipAttrs } from "@/directives/tip";

interface Service {
  name: string;
  load?: string;
  active?: string;
  sub?: string;
  description?: string;
}

interface ServiceDetail {
  id?: string;
  description?: string;
  loadState?: string;
  activeState?: string;
  subState?: string;
  mainPid?: string;
  execStart?: string;
  fragmentPath?: string;
  activeEnterTimestamp?: string;
  memoryCurrent?: string;
  cpuTimeNsec?: string;
  restart?: string;
  user?: string;
}

const ELLIPSIS_STYLE: Record<string, string> = {
  display: "block",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  minWidth: "0",
  width: "100%",
  lineHeight: "22px",
};

const props = defineProps<{ host: string }>();
const app = useAppStore();
const { data, error, loading, refresh } = usePolling<Service[]>(
  () => api.collectServices(props.host) as Promise<Service[]>,
  30_000,
  () => props.host,
  () => app.isHostSubActive(props.host, "services")
);
const list = computed(() => data.value || []);

const filter = ref("");
const filtered = computed(() => {
  const q = filter.value.trim().toLowerCase();
  if (!q) return list.value;
  return list.value.filter(
    (s) =>
      (s.name || "").toLowerCase().includes(q) ||
      (s.description || "").toLowerCase().includes(q) ||
      (s.sub || "").toLowerCase().includes(q)
  );
});

const tableWrap = ref<HTMLDivElement | null>(null);
const size = useContainerSize(tableWrap);

const detailMap = reactive<Record<string, ServiceDetail | null>>({});
const pending = new Set<string>();

const card = reactive({ visible: false, name: "", x: 0, y: 0 });
const CARD_W = 380;
const CARD_EST_H = 340;

function ellipsisCell(text: string, tip?: string) {
  return h(
    "span",
    {
      class: "cell-ellipsis",
      style: ELLIPSIS_STYLE,
      ...tipAttrs(tip || text || ""),
    },
    text || ""
  );
}

function dotClass(s: Service): string {
  if (s.active === "failed") return "is-failed";
  if (s.active === "inactive") return "is-inactive";
  return "";
}

function stateTagType(s: Service): "success" | "danger" | "info" | "warning" {
  if (s.active === "failed") return "danger";
  if (s.active === "inactive") return "info";
  if (s.sub === "running" || s.active === "active") return "success";
  return "warning";
}

const svcColumns: Column<Service>[] = [
  m3TableIndexColumn(),
  {
    key: "dot",
    title: "",
    width: 48,
    align: "center",
    cellRenderer: ({ rowData }) =>
      h("span", { class: ["svc-dot", dotClass(rowData)] }),
  },
  {
    key: "name",
    dataKey: "name",
    title: "服务名",
    width: 220,
    flexGrow: 1,
    flexShrink: 1,
    cellRenderer: ({ cellData }) => ellipsisCell(cellData),
  },
  {
    key: "description",
    dataKey: "description",
    title: "描述",
    width: 280,
    flexGrow: 2,
    flexShrink: 1,
    cellRenderer: ({ cellData }) => ellipsisCell(cellData || "—", cellData || ""),
  },
  {
    key: "state",
    title: "状态",
    width: 120,
    align: "right",
    cellRenderer: ({ rowData }) =>
      h(
        ElTag,
        { size: "small", effect: "plain", type: stateTagType(rowData) },
        () => rowData.sub || rowData.active || "—"
      ),
  },
];

const rowEventHandlers: RowEventHandlers = {
  onMouseenter: ({ rowData, event }) => {
    card.name = rowData.name;
    placeCard(event as MouseEvent);
    card.visible = true;
    void detailOf(rowData.name);
  },
  onMouseleave: () => hideCard(),
};

function placeCard(e: MouseEvent) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let x = e.clientX + 16;
  let y = e.clientY + 16;
  if (x + CARD_W > vw - 8) x = Math.max(8, e.clientX - CARD_W - 16);
  if (y + CARD_EST_H > vh - 8) y = Math.max(8, e.clientY - CARD_EST_H - 16);
  card.x = x;
  card.y = y;
}

function hideCard() {
  card.visible = false;
}

function detailOf(name: string): ServiceDetail | null | undefined {
  if (detailMap[name] === undefined && !pending.has(name)) {
    pending.add(name);
    api
      .collectServiceDetail(props.host, name)
      .then((d) => (detailMap[name] = d))
      .catch(() => (detailMap[name] = null));
  }
  return detailMap[name];
}

function formatMem(v?: string): string {
  if (!v) return "—";
  const n = Number(v);
  if (!Number.isFinite(n) || v.includes("[")) return v;
  if (n <= 0) return v;
  const units = ["B", "KB", "MB", "GB", "TB"];
  let f = n;
  let i = 0;
  while (f >= 1024 && i < units.length - 1) {
    f /= 1024;
    i++;
  }
  return `${f.toFixed(i >= 2 ? 1 : 0)} ${units[i]}`;
}

function formatCpu(v?: string): string {
  if (!v) return "—";
  const ns = Number(v);
  if (!Number.isFinite(ns) || ns <= 0) return v;
  const s = ns / 1e9;
  if (s < 1) return `${(ns / 1e6).toFixed(0)} ms`;
  if (s < 60) return `${s.toFixed(1)} 秒`;
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  if (m < 60) return `${m} 分 ${r} 秒`;
  const h = Math.floor(m / 60);
  return `${h} 小时 ${m % 60} 分`;
}
</script>

<style scoped>
.svc-dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--el-color-success);
}
.svc-dot.is-failed {
  background: var(--el-color-danger);
}
.svc-dot.is-inactive {
  background: var(--el-color-info);
}
.cell-ellipsis {
  display: block;
  min-width: 0;
  width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>

<style>
.svc-hover-card {
  position: fixed;
  z-index: 3000;
  width: 380px;
  max-height: 70vh;
  overflow-y: auto;
  padding: 12px 14px;
  border-radius: var(--m3-shape-s, 8px);
  background: var(--m3-surface-container-lowest, #ecebf0);
  border: none;
  box-shadow: var(--m3-elevation-2);
  font-size: 12px;
  color: var(--m3-on-surface, #1a1a1d);
  pointer-events: none;
}
.svc-hover-card .detail-title {
  font-size: 13px;
  font-weight: 600;
  margin-bottom: 10px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--el-border-color-lighter);
}
.svc-hover-card .d-row {
  display: flex;
  gap: 12px;
  padding: 3px 0;
  line-height: 1.5;
}
.svc-hover-card .k {
  flex-shrink: 0;
  width: 62px;
  color: var(--el-text-color-secondary);
}
.svc-hover-card .v {
  flex: 1;
  min-width: 0;
  word-break: break-all;
}
.svc-hover-card .v.mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 11px;
}
.svc-hover-card .detail-loading {
  display: flex;
  align-items: center;
  gap: 8px;
  justify-content: center;
  padding: 16px 0;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
</style>
