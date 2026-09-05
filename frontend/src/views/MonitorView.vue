<template>
  <div ref="pageRef" class="monitor-page">
    <el-alert v-if="error && !overview" type="error" :title="error" show-icon />

    <el-card shadow="never" class="home-card panel-hover-card">
      <div class="card-header">
        <div class="card-title-group">
          <span class="panel-section-title">监控</span>
          <el-radio-group v-model="chartMode" size="small">
            <el-radio-button value="load">负载</el-radio-button>
            <el-radio-button value="cpu">CPU</el-radio-button>
            <el-radio-button value="mem">内存</el-radio-button>
            <el-radio-button value="network">流量</el-radio-button>
            <el-radio-button value="io">磁盘 IO</el-radio-button>
          </el-radio-group>
          <el-radio-group v-model="rangeMode" size="small" class="range-group">
            <el-radio-button value="live">实时</el-radio-button>
            <el-radio-button value="30m">30分</el-radio-button>
            <el-radio-button value="1h">1时</el-radio-button>
            <el-radio-button value="6h">6时</el-radio-button>
            <el-radio-button value="12h">12时</el-radio-button>
            <el-radio-button value="24h">24时</el-radio-button>
            <el-radio-button value="7d">7天</el-radio-button>
            <el-radio-button value="custom">自定义</el-radio-button>
          </el-radio-group>
          <el-button
            link
            class="card-icon-btn"
            :icon="Refresh"
            title="刷新"
            @click="refreshMonitor"
          />
        </div>
      </div>

      <div v-if="rangeMode === 'custom'" class="custom-range-row">
        <el-date-picker
          v-model="customRange"
          type="datetimerange"
          size="small"
          range-separator="至"
          start-placeholder="开始时间"
          end-placeholder="结束时间"
          format="MM-dd HH:mm"
          :clearable="false"
          @change="onCustomRangeChange"
        />
        <span class="custom-range-hint">
          最多 7 天；超过 3 小时自动降为 5 分钟粒度
        </span>
      </div>

      <div class="monitor-tags">
        <template v-if="rangeMode === 'live' && overview">
          <template v-if="chartMode === 'network'">
            <el-tag class="metric-tag" effect="plain">
              上行: {{ formatBytes(rates.upBps) }}/s
            </el-tag>
            <el-tag class="metric-tag" effect="plain">
              下行: {{ formatBytes(rates.downBps) }}/s
            </el-tag>
          </template>
          <template v-else-if="chartMode === 'io'">
            <el-tag class="metric-tag" effect="plain">
              读: {{ formatBytes(ioRates.readBps) }}/s
            </el-tag>
            <el-tag class="metric-tag" effect="plain">
              写: {{ formatBytes(ioRates.writeBps) }}/s
            </el-tag>
            <el-tag class="metric-tag metric-tag--warn" effect="plain">
              IOPS: {{ ioRates.iops }}/s
            </el-tag>
          </template>
          <template v-else-if="chartMode === 'cpu'">
            <el-tag class="metric-tag" effect="plain">
              使用率: {{ overview.cpuPercent.toFixed(2) }}%
            </el-tag>
            <el-tag class="metric-tag" effect="plain">
              {{ overview.cpuCount }} 核 {{ overview.cpuModel || "" }}
            </el-tag>
          </template>
          <template v-else-if="chartMode === 'mem'">
            <el-tag class="metric-tag" effect="plain">
              已用: {{ formatBytes(overview.memUsed) }} /
              {{ formatBytes(overview.memTotal) }}
            </el-tag>
            <el-tag class="metric-tag" effect="plain">
              使用率: {{ overview.memPercent.toFixed(1) }}%
            </el-tag>
          </template>
          <template v-else>
            <el-tag class="metric-tag" effect="plain">
              1分钟: {{ overview.load1.toFixed(2) }}
            </el-tag>
            <el-tag class="metric-tag" effect="plain">
              5分钟: {{ overview.load5.toFixed(2) }}
            </el-tag>
            <el-tag class="metric-tag" effect="plain">
              15分钟: {{ overview.load15.toFixed(2) }}
            </el-tag>
            <el-tag class="metric-tag" effect="plain">
              {{ loadLabel }}（{{ overview.cpuCount }} 核）
            </el-tag>
          </template>
        </template>
      </div>

      <div
        v-if="rangeMode !== 'live' && !historyLoading && !history.length"
        class="history-empty"
      >
        该区间暂无数据（agent 需运行一段时间，或未安装）
      </div>
      <VChartLine v-else height="300px" :option="monitorChartOption" />
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { Refresh } from "@element-plus/icons-vue";
import { ElMessage } from "element-plus";
import { api } from "@/api";
import type { agentcli, monitor } from "@/api";
import { formatErr, formatBytes, bytesToKBps } from "@/utils/format";
import { isAgentMissing } from "@/utils/format";
import VChartLine, { type LineOption } from "@/components/VChartLine.vue";

const props = defineProps<{ host: string }>();

const error = ref<string | null>(null);
const overview = ref<monitor.Overview | null>(null);

// ---------- 模式与时间范围 ----------
const chartMode = ref<"load" | "cpu" | "mem" | "network" | "io">("network");
const rangeMode = ref<
  "live" | "30m" | "1h" | "6h" | "12h" | "24h" | "7d" | "custom"
>("live");
const RANGE_SPAN: Record<string, number> = {
  "30m": 30 * 60,
  "1h": 3600,
  "6h": 6 * 3600,
  "12h": 12 * 3600,
  "24h": 24 * 3600,
  "7d": 7 * 86400,
};

/** 自定义时间范围：选择值与已应用区间（Unix 秒） */
const customRange = ref<[Date, Date] | null>(null);
const customApplied = ref<{ from: number; to: number } | null>(null);
/** 自定义跨度上限 7 天：与「7天」按钮一致，防止 agg 抽样过粗 */
const CUSTOM_MAX_SPAN = 7 * 86400;

const history = ref<agentcli.RangePoint[]>([]);
const historyLoading = ref(false);

// ---------- live 曲线（滑动窗口 100 点，与 traffic 同款） ----------
const traffic = ref<{ time: string; up: number; down: number }[]>([]);
const rates = ref({ upBps: 0, downBps: 0 });
const lastNet = ref<{ rx: number; tx: number; ts: number } | null>(null);
const ioTraffic = ref<{ time: string; read: number; write: number }[]>([]);
const ioRates = ref({ readBps: 0, writeBps: 0, iops: 0 });
const lastDisk = ref<{ read: number; write: number; count: number; ts: number } | null>(null);
const cpuSeries = ref<{ time: string; value: number }[]>([]);
const memSeries = ref<{ time: string; value: number }[]>([]);
const loadSeries = ref<{ time: string; value: number }[]>([]);

let timer: number | undefined;
let historyTimer: number | undefined;

const loadPercent = computed(() => {
  if (!overview.value?.cpuCount) return 0;
  return Math.min(100, (overview.value.load1 / overview.value.cpuCount) * 100);
});

const loadLabel = computed(() => {
  const v = loadPercent.value;
  if (v < 30) return "运行流畅";
  if (v < 70) return "运行正常";
  if (v < 80) return "运行缓慢";
  return "运行堵塞";
});

const agentMissing = computed(() => isAgentMissing(error.value));

// ---------- 数据加载 ----------
async function loadOverview() {
  try {
    const data = await api.collectOverview(props.host);
    overview.value = data;
    error.value = null;
    pushTraffic(data);
    pushDiskIO(data);
    pushMonitorSeries(data);
  } catch (e) {
    error.value = formatErr(e);
  }
}

async function loadHistory() {
  let from: number;
  let to: number;
  if (rangeMode.value === "custom") {
    const applied = customApplied.value;
    if (!applied) {
      history.value = [];
      return;
    }
    from = applied.from;
    to = applied.to;
  } else {
    const span = RANGE_SPAN[rangeMode.value];
    if (!span) return;
    to = Math.floor(Date.now() / 1000);
    from = to - span;
  }
  historyLoading.value = true;
  try {
    const r = await api.agentRange(props.host, from, to, "auto");
    history.value = r.points || [];
  } catch {
    history.value = [];
  } finally {
    historyLoading.value = false;
  }
}

watch(rangeMode, (mode) => {
  if (mode === "custom") {
    if (customApplied.value) void loadHistory();
    else history.value = [];
    return;
  }
  void loadHistory();
});

/** 自定义时间范围确认：校验跨度 ≤7 天后拉取 */
function onCustomRangeChange(val: [Date, Date] | null) {
  if (!val || !val[0] || !val[1]) return;
  const from = Math.floor(val[0].getTime() / 1000);
  const to = Math.floor(val[1].getTime() / 1000);
  if (to <= from) {
    ElMessage.warning("结束时间需晚于开始时间");
    return;
  }
  if (to - from > CUSTOM_MAX_SPAN) {
    ElMessage.warning("自定义时间范围最多 7 天");
    return;
  }
  customApplied.value = { from, to };
  void loadHistory();
}

/** 首开预取：agent SQLite 有 5s 粒度历史点，直接灌入 live 曲线 */
async function seedLiveCurves() {
  if (traffic.value.length > 1) return;
  try {
    const to = Math.floor(Date.now() / 1000);
    const r = await api.agentRange(props.host, to - 15 * 60, to, "auto");
    const pts = r.points || [];
    if (!pts.length || traffic.value.length > 1) return;
    // 只取最近 100 点：与滑动窗口一致，避免首次 push 突然裁掉一段
    const win = pts.slice(-100);
    traffic.value = win.map((p) => ({
      time: liveTimeLabel(p.ts * 1000),
      up: p.netTxKBps,
      down: p.netRxKBps,
    }));
    ioTraffic.value = win.map((p) => ({
      time: liveTimeLabel(p.ts * 1000),
      read: p.diskReadKBps,
      write: p.diskWriteKBps,
    }));
    cpuSeries.value = win.map((p) => ({
      time: liveTimeLabel(p.ts * 1000),
      value: p.cpuPercent,
    }));
    memSeries.value = win.map((p) => ({
      time: liveTimeLabel(p.ts * 1000),
      value: p.memUsed,
    }));
    loadSeries.value = win.map((p) => ({
      time: liveTimeLabel(p.ts * 1000),
      value: p.load1,
    }));
  } catch {
    /* agent 不可达或无历史：live 曲线退回逐点积累 */
  }
}

/** live 曲线横轴标签（HH:mm:ss） */
function liveTimeLabel(ms: number): string {
  return new Date(ms).toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

/** 历史点横轴标签：跨度 ≤24h 用 HH:mm，更长用 MM-dd HH:mm */
function historyTimeLabel(ts: number): string {
  const d = new Date(ts * 1000);
  const mmdd = `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const hhmm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  const span = historySpanSec();
  if (span > 24 * 3600) return `${mmdd} ${hhmm}`;
  return hhmm;
}

/** 当前历史查询跨度（秒）；live 返回 0 */
function historySpanSec(): number {
  if (rangeMode.value === "live") return 0;
  if (rangeMode.value === "custom") {
    const a = customApplied.value;
    return a ? a.to - a.from : 0;
  }
  return RANGE_SPAN[rangeMode.value] || 0;
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
  traffic.value = [...traffic.value, { time: liveTimeLabel(now), up, down }].slice(-100);
}

// 磁盘 IO 速率：对累计值做差分，和网络流量同模式
function pushDiskIO(data: monitor.Overview) {
  const now = Date.now();
  const read = Number(data.diskReadBytes) || 0;
  const write = Number(data.diskWriteBytes) || 0;
  const count = Number(data.diskIOCount) || 0;
  const prev = lastDisk.value;
  lastDisk.value = { read, write, count, ts: now };
  if (!prev || now <= prev.ts || read < prev.read || write < prev.write) return;
  const dt = now - prev.ts;
  ioRates.value = {
    readBps: ((read - prev.read) / dt) * 1000,
    writeBps: ((write - prev.write) / dt) * 1000,
    iops: Math.round(((count - prev.count) / dt) * 1000),
  };
  ioTraffic.value = [
    ...ioTraffic.value,
    { time: liveTimeLabel(now), read: bytesToKBps(read - prev.read, dt), write: bytesToKBps(write - prev.write, dt) },
  ].slice(-100);
}

// CPU% / 已用内存 / load1：快照直读推入 live 曲线
function pushMonitorSeries(data: monitor.Overview) {
  const time = liveTimeLabel(Date.now());
  cpuSeries.value = [
    ...cpuSeries.value,
    { time, value: Number(data.cpuPercent) || 0 },
  ].slice(-100);
  memSeries.value = [
    ...memSeries.value,
    { time, value: Number(data.memUsed) || 0 },
  ].slice(-100);
  loadSeries.value = [
    ...loadSeries.value,
    { time, value: Number(data.load1) || 0 },
  ].slice(-100);
}

/** 手动刷新：live 重取预灌，历史重拉区间 */
function refreshMonitor() {
  if (rangeMode.value === "live") {
    traffic.value = [];
    ioTraffic.value = [];
    cpuSeries.value = [];
    memSeries.value = [];
    loadSeries.value = [];
    void seedLiveCurves();
    void loadOverview();
    return;
  }
  void loadHistory();
}

// ---------- 图表 option：按 chartMode 分流 ----------
const monitorChartOption = computed<LineOption>(() => {
  const isLive = rangeMode.value === "live";
  const hx = history.value.map((p) => historyTimeLabel(p.ts));
  const liveX = (arr: { time: string }[]) => arr.map((p) => p.time);

  if (chartMode.value === "load") {
    return {
      xData: isLive ? liveX(loadSeries.value) : hx,
      yData: [
        {
          name: "1 分钟负载",
          data: isLive
            ? loadSeries.value.map((p) => p.value)
            : history.value.map((p) => p.load1),
        },
      ],
      formatStr: "load",
      unit: "raw",
    };
  }
  if (chartMode.value === "cpu") {
    return {
      xData: isLive ? liveX(cpuSeries.value) : hx,
      yData: [
        {
          name: "CPU 使用率",
          data: isLive
            ? cpuSeries.value.map((p) => p.value)
            : history.value.map((p) => p.cpuPercent),
        },
      ],
      formatStr: "%",
      unit: "raw",
      yMax: 100,
    };
  }
  if (chartMode.value === "mem") {
    const memTotal = overview.value?.memTotal || 0;
    return {
      xData: isLive ? liveX(memSeries.value) : hx,
      yData: [
        {
          name: "已用内存",
          data: isLive
            ? memSeries.value.map((p) => p.value)
            : history.value.map((p) => p.memUsed),
          unit: "bytes",
        },
      ],
      unit: "bytes",
      ...(memTotal
        ? { yMarkLine: { name: `总量 ${formatBytes(memTotal)}`, value: memTotal } }
        : {}),
    };
  }
  if (chartMode.value === "io") {
    return {
      xData: isLive ? liveX(ioTraffic.value) : hx,
      yData: [
        {
          name: "读",
          data: isLive
            ? ioTraffic.value.map((p) => p.read)
            : history.value.map((p) => p.diskReadKBps),
        },
        {
          name: "写",
          data: isLive
            ? ioTraffic.value.map((p) => p.write)
            : history.value.map((p) => p.diskWriteKBps),
        },
      ],
      formatStr: "KB/s",
    };
  }
  // network（默认）
  return {
    xData: isLive ? liveX(traffic.value) : hx,
    yData: [
      {
        name: "上行",
        data: isLive
          ? traffic.value.map((p) => p.up)
          : history.value.map((p) => p.netTxKBps),
      },
      {
        name: "下行",
        data: isLive
          ? traffic.value.map((p) => p.down)
          : history.value.map((p) => p.netRxKBps),
      },
    ],
    formatStr: "KB/s",
  };
});

// ---------- 生命周期 ----------
function resetState() {
  overview.value = null;
  error.value = null;
  traffic.value = [];
  rates.value = { upBps: 0, downBps: 0 };
  lastNet.value = null;
  ioTraffic.value = [];
  ioRates.value = { readBps: 0, writeBps: 0, iops: 0 };
  lastDisk.value = null;
  cpuSeries.value = [];
  memSeries.value = [];
  loadSeries.value = [];
  history.value = [];
  customRange.value = null;
  customApplied.value = null;
  rangeMode.value = "live";
}

watch(
  () => props.host,
  () => {
    resetState();
    void loadOverview();
    void seedLiveCurves();
  }
);

onMounted(() => {
  resetState();
  void loadOverview();
  void seedLiveCurves();
  timer = window.setInterval(() => {
    if (agentMissing.value) return;
    void loadOverview();
  }, 2000);
  historyTimer = window.setInterval(() => {
    if (rangeMode.value !== "live") void loadHistory();
  }, 30000);
});

onBeforeUnmount(() => {
  if (timer) clearInterval(timer);
  if (historyTimer) clearInterval(historyTimer);
});
</script>

<style scoped lang="scss">
/* 独立监控页：滚动交给外层 .content-pad */
.monitor-page {
  min-width: 0;
  max-width: 100%;
  overflow: visible;
  padding: 0 0 16px;
  box-sizing: border-box;
}

.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.card-title-group {
  display: flex;
  align-items: center;
  gap: 12px;
  /* 模式 + 范围按钮多，窄窗口允许换行避免溢出 */
  flex-wrap: wrap;
  row-gap: 4px;
}

.range-group {
  margin-left: 8px;
}

.custom-range-row {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  padding: 2px 0 8px;
}
.custom-range-hint {
  color: var(--m3-on-surface-variant, #49454f);
  font-size: 12px;
}

.monitor-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 4px 0 8px;
  min-height: 26px;
}

.history-empty {
  color: var(--m3-on-surface-variant, #49454f);
  font-size: 13px;
  text-align: center;
  padding: 48px 0;
}
</style>
