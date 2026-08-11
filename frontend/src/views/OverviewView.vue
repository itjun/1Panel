<template>
  <div v-loading="loading && !overview" class="overview-page">
    <el-alert v-if="error && !overview" type="error" :title="error" show-icon />
    <template v-if="overview">
      <el-row :gutter="7">
        <!-- 左栏 16 -->
        <el-col :xs="24" :md="16">
          <el-card shadow="never" class="home-card">
            <div class="card-header">
              <span class="panel-section-title">概览</span>
              <el-button link type="primary" :icon="Refresh" @click="refreshAll">
                刷新
              </el-button>
            </div>
            <el-row :gutter="12">
              <el-col :span="6" v-for="s in stats" :key="s.label">
                <div class="stat-cell">
                  <div class="stat-label">{{ s.label }}</div>
                  <div class="stat-value">{{ s.value }}</div>
                </div>
              </el-col>
            </el-row>
          </el-card>

          <el-card shadow="never" class="home-card card-interval">
            <div class="card-header">
              <span class="panel-section-title">状态</span>
            </div>
            <el-row :gutter="8">
              <el-col :span="6" align="center">
                <VChartPie
                  height="160px"
                  :option="{ title: '负载', data: loadPercent }"
                />
                <div class="input-help">{{ loadLabel }}</div>
              </el-col>
              <el-col :span="6" align="center">
                <VChartPie
                  height="160px"
                  :option="{ title: 'CPU', data: overview.cpuPercent }"
                />
                <div class="input-help">
                  ( {{ overview.cpuPercent.toFixed(2) }} /
                  {{ overview.cpuCount }} ) 核
                </div>
              </el-col>
              <el-col :span="6" align="center">
                <VChartPie
                  height="160px"
                  :option="{ title: '内存', data: overview.memPercent }"
                />
                <div class="input-help">
                  {{ formatBytes(overview.memUsed) }} /
                  {{ formatBytes(overview.memTotal) }}
                </div>
              </el-col>
              <el-col :span="6" align="center">
                <VChartPie
                  height="160px"
                  :option="{
                    title: rootDisk?.mount || '/',
                    data: rootDisk?.percent || 0,
                  }"
                />
                <div class="input-help" v-if="rootDisk">
                  {{ formatBytes(rootDisk.used) }} /
                  {{ formatBytes(rootDisk.total) }}
                </div>
              </el-col>
            </el-row>
          </el-card>

          <el-card shadow="never" class="home-card card-interval">
            <div class="card-header">
              <span class="panel-section-title">监控</span>
            </div>
            <div class="monitor-tags">
              <el-tag type="primary" effect="light">
                上行: {{ formatBytes(rates.upBps) }}/s
              </el-tag>
              <el-tag type="primary" effect="light">
                下行: {{ formatBytes(rates.downBps) }}/s
              </el-tag>
              <el-tooltip
                :content="netWindowTip(overview.net1d, '1 天')"
                placement="top"
              >
                <el-tag type="success" effect="light">
                  近1天↑ {{ formatNetWindow(overview.net1d, "tx") }}
                </el-tag>
              </el-tooltip>
              <el-tooltip
                :content="netWindowTip(overview.net1d, '1 天')"
                placement="top"
              >
                <el-tag type="success" effect="light">
                  近1天↓ {{ formatNetWindow(overview.net1d, "rx") }}
                </el-tag>
              </el-tooltip>
              <el-tooltip
                :content="netWindowTip(overview.net7d, '7 天')"
                placement="top"
              >
                <el-tag type="warning" effect="light">
                  近7天↑ {{ formatNetWindow(overview.net7d, "tx") }}
                </el-tag>
              </el-tooltip>
              <el-tooltip
                :content="netWindowTip(overview.net7d, '7 天')"
                placement="top"
              >
                <el-tag type="warning" effect="light">
                  近7天↓ {{ formatNetWindow(overview.net7d, "rx") }}
                </el-tag>
              </el-tooltip>
            </div>
            <VChartLine height="280px" :option="lineOption" />
          </el-card>

          <el-card shadow="never" class="home-card card-interval">
            <div class="card-header">
              <span class="panel-section-title">磁盘</span>
              <el-button link type="primary" @click="loadDisks">刷新</el-button>
            </div>
            <div v-if="!disks?.length" class="empty-tip">暂无磁盘数据</div>
            <div v-for="d in disks" :key="d.mount" class="disk-row">
              <span class="disk-mount">{{ d.mount }}</span>
              <el-progress
                :percentage="Math.min(100, d.percent)"
                :stroke-width="8"
                :status="d.percent > 90 ? 'exception' : undefined"
                style="flex: 1"
              />
              <span class="disk-size">
                {{ formatBytes(d.used) }} / {{ formatBytes(d.total) }}
              </span>
            </div>
          </el-card>
        </el-col>

        <!-- 右栏 8 -->
        <el-col :xs="24" :md="8">
          <el-card shadow="never" class="home-card">
            <div class="card-header">
              <span class="panel-section-title">系统信息</span>
            </div>
            <el-descriptions :column="1" border size="small" class="sys-desc">
              <el-descriptions-item label="主机名称">
                {{ overview.hostname || host }}
              </el-descriptions-item>
              <el-descriptions-item label="发行版本">
                {{ overview.osRelease || "—" }}
              </el-descriptions-item>
              <el-descriptions-item label="内核版本">
                {{ overview.kernel || "—" }}
              </el-descriptions-item>
              <el-descriptions-item label="系统类型">
                {{ overview.arch || "—" }}
              </el-descriptions-item>
              <el-descriptions-item label="主机地址">
                {{ overview.ipAddress || "—" }}
              </el-descriptions-item>
              <el-descriptions-item label="CPU 型号">
                {{ overview.cpuModel || "—" }}
              </el-descriptions-item>
              <el-descriptions-item label="运行时间">
                {{ formatDurationLong(overview.uptime) }}
              </el-descriptions-item>
            </el-descriptions>
          </el-card>

          <el-card shadow="never" class="home-card card-interval">
            <div class="card-header">
              <span class="panel-section-title">备忘录</span>
              <el-button
                link
                type="primary"
                :icon="memoEditing ? Check : Edit"
                @click="toggleMemo"
              >
                {{ memoEditing ? "保存" : "编辑" }}
              </el-button>
            </div>
            <el-input
              v-if="memoEditing"
              v-model="memoDraft"
              type="textarea"
              :rows="5"
              placeholder="记录此主机备注…"
            />
            <div v-else class="memo-body">
              {{ memo || "点击编辑按钮启用编辑" }}
            </div>
          </el-card>

          <!-- 应用：先 Java，再 Docker -->
          <el-card shadow="never" class="home-card card-interval">
            <div class="card-header">
              <span class="panel-section-title">应用</span>
              <span class="hint">Java · {{ javaList.length }}</span>
            </div>
            <div v-if="appsLoading" class="empty-tip">加载中…</div>
            <div v-else-if="!javaList.length" class="empty-tip">暂无 Java 进程</div>
            <div
              v-for="p in javaList.slice(0, 12)"
              :key="'j-' + p.pid"
              class="app-row"
            >
              <div class="app-meta">
                <div class="app-name" :title="p.cmd">
                  {{ javaAppTitle(p.cmd) }}
                </div>
                <div class="app-img">
                  PID {{ p.pid }} · CPU {{ (p.cpu || 0).toFixed(1) }}% ·
                  {{ formatBytes(Number(p.rss) || 0) }}
                </div>
              </div>
              <el-tag size="small" type="warning">Java</el-tag>
            </div>
            <div v-if="javaList.length > 12" class="app-more">
              另有 {{ javaList.length - 12 }} 个进程未展示
            </div>
          </el-card>

          <el-card shadow="never" class="home-card card-interval">
            <div class="card-header">
              <span class="panel-section-title">应用</span>
              <span class="hint">
                Docker ·
                {{ docker?.available ? dockerList.length : "—" }}
              </span>
            </div>
            <div v-if="appsLoading" class="empty-tip">加载中…</div>
            <div v-else-if="!docker?.available" class="empty-tip">
              未检测到 Docker
            </div>
            <div v-else-if="!dockerList.length" class="empty-tip">
              暂无容器
            </div>
            <div
              v-for="c in dockerList.slice(0, 12)"
              :key="c.id || c.name"
              class="app-row"
            >
              <div class="app-meta">
                <div class="app-name">{{ c.name || c.id }}</div>
                <div class="app-img">{{ c.image || c.status }}</div>
              </div>
              <el-tag
                size="small"
                :type="
                  (c.state || '').toLowerCase() === 'running'
                    ? 'success'
                    : 'info'
                "
              >
                {{ c.state || "—" }}
              </el-tag>
            </div>
            <div v-if="dockerList.length > 12" class="app-more">
              另有 {{ dockerList.length - 12 }} 个容器未展示
            </div>
          </el-card>
        </el-col>
      </el-row>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { Check, Edit, Refresh } from "@element-plus/icons-vue";
import { api } from "@/api";
import type { monitor } from "@/api";
import {
  bytesToKBps,
  formatBytes,
  formatDurationLong,
} from "@/utils/format";
import VChartPie from "@/components/VChartPie.vue";
import VChartLine from "@/components/VChartLine.vue";

const props = defineProps<{ host: string }>();

const loading = ref(false);
const error = ref<string | null>(null);
const overview = ref<monitor.Overview | null>(null);
const disks = ref<monitor.DiskInfo[]>([]);
const docker = ref<monitor.DockerInfo | null>(null);
const javaList = ref<monitor.ProcInfo[]>([]);
const appsLoading = ref(false);

const dockerList = computed(
  () => (docker.value?.containers || []) as monitor.Container[]
);

const traffic = ref<{ time: string; up: number; down: number }[]>([]);
const rates = ref({ upBps: 0, downBps: 0 });
const lastNet = ref<{ rx: number; tx: number; ts: number } | null>(null);

const memoKey = computed(() => `ipannel.memo.${props.host}`);
const memo = ref("");
const memoDraft = ref("");
const memoEditing = ref(false);

let timer: number | undefined;

const rootDisk = computed(() => {
  if (!disks.value?.length) return null;
  return (
    disks.value.find((d) => d.mount === "/") ||
    [...disks.value].sort((a, b) => b.total - a.total)[0]
  );
});

const loadPercent = computed(() => {
  if (!overview.value?.cpuCount) return 0;
  return Math.min(
    100,
    (overview.value.load1 / overview.value.cpuCount) * 100
  );
});

/** 近 1/7 天流量展示 */
function formatNetWindow(
  w: { rxBytes?: number; txBytes?: number; spanHours?: number; complete?: boolean } | null | undefined,
  dir: "rx" | "tx"
): string {
  if (!w) return "—";
  const n = dir === "rx" ? Number(w.rxBytes) || 0 : Number(w.txBytes) || 0;
  const span = Number(w.spanHours) || 0;
  // 几乎无历史
  if (span < 0.02 && n === 0) return "积累中";
  const s = formatBytes(n);
  return w.complete ? s : `${s}*`;
}

function netWindowTip(
  w: { spanHours?: number; complete?: boolean } | null | undefined,
  label: string
): string {
  if (!w) {
    return `近${label}流量：打开主机会话后开始在本机采样累计，需持续观察才能出完整窗口。`;
  }
  const h = Number(w.spanHours) || 0;
  if (w.complete) {
    return `近${label}完整窗口：基于本机历史采样对 /proc/net/dev 累计值做差分（除 lo 外网卡合计，1024 进制）。`;
  }
  if (h < 0.05) {
    return `近${label}：数据积累中（约每分钟采样一次，请保持主机「运行中」）。`;
  }
  const pretty =
    h >= 24 ? `${(h / 24).toFixed(1)} 天` : `${h.toFixed(1)} 小时`;
  return `近${label}：当前仅有约 ${pretty} 样本（标记 *），满 ${label} 后显示完整值。重启会导致计数回绕并重新累计。`;
}

const loadLabel = computed(() => {
  const v = loadPercent.value;
  if (v < 30) return "运行流畅";
  if (v < 70) return "运行正常";
  if (v < 80) return "运行缓慢";
  return "运行堵塞";
});

const stats = computed(() => [
  { label: "CPU 核心", value: String(overview.value?.cpuCount ?? 0) },
  { label: "磁盘分区", value: String(disks.value?.length ?? 0) },
  {
    label: "Docker 容器",
    value: String(docker.value?.containers?.length ?? 0),
  },
  {
    label: "运行中容器",
    value: String(
      (docker.value?.containers || []).filter(
        (c) => (c.state || "").toLowerCase() === "running"
      ).length
    ),
  },
]);

const lineOption = computed(() => ({
  xData: traffic.value.map((t) => t.time),
  yData: [
    { name: "上行", data: traffic.value.map((t) => t.up) },
    { name: "下行", data: traffic.value.map((t) => t.down) },
  ],
  formatStr: "KB/s",
}));

async function loadOverview() {
  try {
    const data = await api.collectOverview(props.host);
    overview.value = data;
    error.value = null;
    pushTraffic(data);
  } catch (e) {
    error.value = String(e);
  }
}

function pushTraffic(data: monitor.Overview) {
  const now = Date.now();
  const rx = Number(data.netRxBytes) || 0;
  const tx = Number(data.netTxBytes) || 0;
  const prev = lastNet.value;
  lastNet.value = { rx, tx, ts: now };
  if (!prev || now <= prev.ts || rx < prev.rx || tx < prev.tx) return;
  const dt = now - prev.ts;
  const up = bytesToKBps(tx - prev.tx, dt);
  const down = bytesToKBps(rx - prev.rx, dt);
  rates.value = {
    upBps: ((tx - prev.tx) / dt) * 1000,
    downBps: ((rx - prev.rx) / dt) * 1000,
  };
  const time = new Date(now).toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  traffic.value = [...traffic.value, { time, up, down }].slice(-100);
}

async function loadDisks() {
  try {
    disks.value = (await api.collectDisks(props.host)) || [];
  } catch {
    disks.value = [];
  }
}

async function loadApps() {
  appsLoading.value = true;
  try {
    const [dj, dd] = await Promise.all([
      api.collectJava(props.host).catch(() => [] as monitor.ProcInfo[]),
      api.collectDocker(props.host).catch(() => null),
    ]);
    javaList.value = (dj || []) as monitor.ProcInfo[];
    docker.value = dd as monitor.DockerInfo | null;
  } finally {
    appsLoading.value = false;
  }
}

/** 从 java 命令行提取可读标题：优先 -jar 包名，其次疑似主类 */
function javaAppTitle(cmd: string): string {
  if (!cmd) return "java";
  const jar = cmd.match(/-jar\s+(\S+\.jar)/i);
  if (jar?.[1]) {
    const base = jar[1].split(/[/\\]/).pop() || jar[1];
    return base;
  }
  // 常见主类：com.xxx.Main / org.springframework.boot.loader...
  const tokens = cmd.split(/\s+/);
  for (let i = tokens.length - 1; i >= 0; i--) {
    const t = tokens[i];
    if (/^[a-zA-Z_][\w.]*\.[A-Z][\w$]*$/.test(t) && !t.includes("/")) {
      return t;
    }
  }
  // 截断过长命令行
  return cmd.length > 48 ? cmd.slice(0, 46) + "…" : cmd;
}

async function refreshAll() {
  loading.value = true;
  await Promise.all([loadOverview(), loadDisks(), loadApps()]);
  loading.value = false;
}

function loadMemo() {
  try {
    memo.value = localStorage.getItem(memoKey.value) || "";
  } catch {
    memo.value = "";
  }
  memoDraft.value = memo.value;
  memoEditing.value = false;
}

function toggleMemo() {
  if (memoEditing.value) {
    memo.value = memoDraft.value;
    try {
      localStorage.setItem(memoKey.value, memo.value);
    } catch {
      /* ignore */
    }
    memoEditing.value = false;
  } else {
    memoDraft.value = memo.value;
    memoEditing.value = true;
  }
}

function resetHostState() {
  overview.value = null;
  disks.value = [];
  docker.value = null;
  javaList.value = [];
  traffic.value = [];
  rates.value = { upBps: 0, downBps: 0 };
  lastNet.value = null;
  loadMemo();
}

watch(
  () => props.host,
  async () => {
    resetHostState();
    loading.value = true;
    await refreshAll();
    loading.value = false;
  }
);

onMounted(async () => {
  resetHostState();
  loading.value = true;
  await refreshAll();
  loading.value = false;
  timer = window.setInterval(loadOverview, 3000);
});

onBeforeUnmount(() => {
  if (timer) clearInterval(timer);
});
</script>

<style scoped lang="scss">
/* 滚动交给外层 .content-pad；本页不设 height:100% + overflow:auto，避免双滚动条 */
.overview-page {
  min-width: 0;
  max-width: 100%;
  overflow: visible;
  padding: 0 0 12px;
  box-sizing: border-box;

  /* el-row gutter 用负 margin，会顶破父级宽度 → 横向滚动条 */
  :deep(> .el-row) {
    max-width: 100%;
    box-sizing: border-box;
  }
  :deep(.el-col) {
    min-width: 0;
    max-width: 100%;
  }
}
.home-card {
  border: 1px solid var(--el-border-color-light, #e4e7ed) !important;
  border-radius: 4px;
  max-width: 100%;
  overflow: hidden; /* 卡片内图表/描述表不得撑破横向 */
  box-sizing: border-box;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
  /* 1Panel：悬停主色描边 */
  &:hover {
    border-color: var(--el-color-primary) !important;
    box-shadow: 0 0 0 1px var(--el-color-primary);
  }
  :deep(.el-card__body) {
    padding: 14px 16px;
    max-width: 100%;
    box-sizing: border-box;
  }
}
.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}
.stat-cell {
  text-align: center;
  padding: 12px 8px;
  border: 1px solid var(--el-border-color-lighter, #ebeef5);
  border-radius: 4px;
  background: rgba(0, 94, 235, 0.03);
}
.stat-label {
  font-size: 12px;
  color: var(--el-text-color-regular);
}
.stat-value {
  margin-top: 6px;
  font-size: 18px;
  font-weight: 500;
  color: var(--el-color-primary);
}
.input-help {
  font-size: 12px;
  color: #646a73;
  margin-top: 2px;
}
.disk-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
  font-size: 12px;
}
.disk-mount {
  width: 72px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 500;
}
.disk-size {
  width: 140px;
  text-align: right;
  color: var(--el-text-color-regular);
  flex-shrink: 0;
}
.empty-tip {
  text-align: center;
  color: var(--el-text-color-secondary);
  font-size: 13px;
  padding: 20px 0;
}
.memo-body {
  min-height: 80px;
  font-size: 13px;
  color: var(--el-text-color-regular);
  white-space: pre-wrap;
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
.app-more {
  margin-top: 6px;
  font-size: 11px;
  color: var(--el-text-color-secondary);
  text-align: center;
}
.app-img {
  font-size: 11px;
  color: var(--el-text-color-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.hint {
  font-size: 11px;
  color: var(--el-text-color-secondary);
}
.sys-desc {
  :deep(.el-descriptions__label) {
    width: 88px;
  }
}
</style>
