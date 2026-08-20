<template>
  <div class="tab-root" v-loading="loading && !list.length">
    <EnlargableCard title="服务">
    <div class="toolbar">
      <el-input
        v-model="filter"
        size="large"
        clearable
        class="filter"
        placeholder="搜索服务名/描述..."
      />
      <el-button size="large" @click="refresh">刷新</el-button>
      <span class="muted">{{ filtered.length }} / {{ list.length }} 个</span>
    </div>
    <el-alert v-if="error && !list.length" type="error" :title="error" show-icon />

    <!-- 单行列表：悬浮整行弹出跟随鼠标的详情卡片 -->
    <div class="svc-list" @mouseleave="hideCard">
      <div
        v-for="s in filtered"
        :key="s.name"
        class="svc-row"
        @mouseenter="onRowEnter($event, s.name)"
        @mousemove="onRowMove"
      >
        <span class="dot" :class="dotClass(s)" />
        <span class="name" :title="s.name">{{ s.name }}</span>
        <span class="desc" :title="s.description">{{ s.description || "—" }}</span>
        <el-tag size="small" type="info" class="sub">{{ s.sub || s.active || "—" }}</el-tag>
      </div>
    </div>

    <!-- 跟随鼠标的详情卡片：固定定位 + 视口内自动避让，不参与鼠标事件 -->
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

    <el-empty
      v-if="!loading && list.length === 0 && !error"
      description="未采集到 systemd 服务（目标机可能不是 systemd）"
    />
    </EnlargableCard>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import { Loading } from "@element-plus/icons-vue";
import { api } from "@/api";
import { usePolling } from "@/composables/usePolling";
import { useAppStore } from "@/stores/app";
import EnlargableCard from "@/components/EnlargableCard.vue";

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

const props = defineProps<{ host: string }>();
const app = useAppStore();
const { data, error, loading, refresh } = usePolling<Service[]>(
  () => api.collectServices(props.host) as Promise<Service[]>,
  30_000,
  () => props.host,
  // 30s 间隔较长：切回子页时立即补刷
  () => app.isHostSubActive(props.host, "services")
);
const list = computed(() => data.value || []);

/** 搜索：按服务名/描述/子状态过滤 */
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

/** 详情按服务名缓存；首次悬浮时查询一次 */
const detailMap = reactive<Record<string, ServiceDetail | null>>({});
const pending = new Set<string>();

/** 跟随鼠标的悬浮卡片：固定定位在鼠标右下方，靠边时自动翻到左侧/上方 */
const card = reactive({ visible: false, name: "", x: 0, y: 0 });
const CARD_W = 380;
const CARD_EST_H = 340;

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
function onRowEnter(e: MouseEvent, name: string) {
  card.name = name;
  placeCard(e);
  card.visible = true;
  void detailOf(name); // 进入即触发详情查询
}
function onRowMove(e: MouseEvent) {
  if (card.visible) placeCard(e);
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

function dotClass(s: Service): string {
  if (s.active === "failed") return "is-failed";
  if (s.active === "inactive") return "is-inactive";
  return "";
}

/** MemoryCurrent 可能是 "[not set]" 或纯数字（字节） */
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

/** CPUTimeNSec 纳秒 → 可读时长 */
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
.filter {
  width: 240px;
}
.svc-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.svc-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 12px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 6px;
  background: var(--el-bg-color);
  cursor: default;
  transition: background-color 0.15s;
}
.svc-row:hover {
  background: var(--el-fill-color-light);
}
.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--el-color-success);
  flex-shrink: 0;
}
.dot.is-failed {
  background: var(--el-color-danger);
}
.dot.is-inactive {
  background: var(--el-color-info);
}
.name {
  flex-shrink: 0;
  max-width: 40%;
  font-size: 13px;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.desc {
  flex: 1;
  min-width: 0;
  font-size: 12px;
  color: var(--el-text-color-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sub {
  flex-shrink: 0;
}
</style>

<style>
/* 跟随鼠标的详情卡片（Teleport 到 body，scoped 不生效）；
   pointer-events:none 保证不挡鼠标、不闪烁 */
.svc-hover-card {
  position: fixed;
  z-index: 3000;
  width: 380px;
  max-height: 70vh;
  overflow-y: auto;
  padding: 12px 14px;
  border-radius: 8px;
  background: var(--el-bg-color-overlay, #fff);
  border: 1px solid var(--el-border-color-light, #e4e7ed);
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.12);
  font-size: 12px;
  color: var(--el-text-color-primary, #303133);
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
