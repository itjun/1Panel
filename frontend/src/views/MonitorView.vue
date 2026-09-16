<template>
  <div ref="pageRef" class="monitor-page">
    <el-alert v-if="error && !overview" type="error" :title="error" show-icon />

    <!-- 顶部工具条：不占大卡片，把纵向空间留给五张图 -->
    <div class="monitor-toolbar">
      <div class="card-title-group">
        <span class="panel-section-title">监控</span>
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
        <span class="grain-label">粒度</span>
        <el-select
          v-model="grainMode"
          size="small"
          class="grain-select"
          v-tip="'X 轴采样间隔；实时「自动」= agent 默认采集间隔（5 秒）'"
        >
          <el-option value="auto" label="自动" />
          <el-option value="5s" label="5 秒" />
          <el-option value="10s" label="10 秒" />
          <el-option value="15s" label="15 秒" />
          <el-option value="1m" label="1 分" />
          <el-option value="5m" label="5 分" />
          <el-option value="10m" label="10 分" />
        </el-select>
        <span v-if="grainHint" class="grain-hint">{{ grainHint }}</span>
        <el-button
          link
          class="card-icon-btn"
          :icon="Refresh"
          v-tip="'刷新'"
          @click="refreshMonitor"
        />
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
          :default-value="customDefaultValue"
          @change="onCustomRangeChange"
        />
        <span class="custom-range-hint">
          最多 7 天；细粒度（5/10/15 秒）依赖 raw，长区间可能自动抽稀
        </span>
      </div>
    </div>

    <!-- 两列网格：宽屏 2×2 + 底行通栏；窄屏自动单列；每卡可单独最大化 -->
    <PageSkeleton v-if="!overview && !error" variant="monitor" />
    <div v-else-if="overview" class="monitor-grid">
      <EnlargableCard
        v-for="card in monitorCards"
        :key="card.title"
        bare
        enlargeable
        :title="card.title"
        :class="['monitor-cell', card.wide ? 'monitor-cell--wide' : '']"
      >
        <el-card shadow="never" class="home-card panel-hover-card monitor-card">
          <div class="card-header enl-head-zone">
            <span class="panel-section-title">{{ card.title }}</span>
            <div v-if="rangeMode === 'live' && card.tags.value.length" class="monitor-tags">
              <el-tag
                v-for="(tag, i) in card.tags.value"
                :key="i"
                class="metric-tag"
                :class="{ 'metric-tag--warn': tag.warn }"
                effect="plain"
                size="small"
              >
                {{ tag.text }}
              </el-tag>
            </div>
          </div>
          <div class="chart-slot">
            <div v-if="historyEmpty" class="history-empty">该区间暂无数据</div>
            <VChartLine
              v-else
              height="100%"
              :option="card.option.value"
              :connect-group="connectGroup"
              zoomable
            />
          </div>
        </el-card>
      </EnlargableCard>
    </div>
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
import { useAppStore } from "@/stores/app";
import VChartLine, { type LineOption } from "@/components/VChartLine.vue";
import EnlargableCard from "@/components/EnlargableCard.vue";
import PageSkeleton from "@/components/PageSkeleton.vue";

const props = defineProps<{ host: string }>();
const app = useAppStore();

/** 空闲降频：页面不可见（切走/设置页）时拉长到 30s 一拍 */
const IDLE_MIN_INTERVAL_MS = 30_000;
let lastPollAt = 0;
const pageVisible = computed(() => app.isHostSubActive(props.host, "monitor"));

/** 五卡 connect 联动分组：按 host 隔离，多主机会话同屏也不互相干扰 */
const connectGroup = computed(() => `monitor-${props.host}`);

const error = ref<string | null>(null);
const overview = ref<monitor.Overview | null>(null);

// ---------- 模式与时间范围 ----------
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
/** 首次进入自定义：默认「此刻往前 24 小时」，避免空值时弹窗展示跨两月的空白面板 */
const CUSTOM_DEFAULT_SPAN_MS = 24 * 3600 * 1000;

/**
 * X 轴采样粒度：
 * - auto（实时）：agent 默认采集间隔 5 秒
 * - auto（历史）：沿用后端（≤3h raw ≈5s；更长走 5 分钟 agg，超长再抽稀）
 * - 5s/10s/15s/1m：强制 raw，再按目标秒数桶化
 * - 5m/10m：走 agg（5 分钟桶），10m 再隔桶取
 */
type GrainMode = "auto" | "5s" | "10s" | "15s" | "1m" | "5m" | "10m";
const grainMode = ref<GrainMode>("auto");
/** 与 spanel-agent -interval 默认值一致 */
const AGENT_DEFAULT_INTERVAL_SEC = 5;
const GRAIN_SEC: Record<Exclude<GrainMode, "auto">, number> = {
  "5s": 5,
  "10s": 10,
  "15s": 15,
  "1m": 60,
  "5m": 300,
  "10m": 600,
};
/** 单卡点数上限：五卡联动，过密会卡顿且横轴挤成一团 */
const MAX_CHART_POINTS = 2500;
/** 实际生效提示（抽稀 / 数据源 / 实时 agent 间隔） */
const grainHint = ref("");
/** 实时曲线上次落点时间：按粒度节流，避免 2s 轮询把 X 轴加密 */
let lastLiveChartAt = 0;

function defaultCustomRange(): [Date, Date] {
  const to = new Date();
  const from = new Date(to.getTime() - CUSTOM_DEFAULT_SPAN_MS);
  return [from, to];
}

/** 弹窗面板聚焦用：有选中值时跟选中，否则跟默认 24h 起点 */
const customDefaultValue = computed(() => {
  if (customRange.value?.[0]) return customRange.value[0];
  return new Date(Date.now() - CUSTOM_DEFAULT_SPAN_MS);
});

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
/** 内存总量（字节）：只在数值变化时更新，避免每 2s overview 轮询触发 memOption 重算 → 内存卡单独 setOption 清掉联动轴指针 */
const memTotalBytes = ref(0);

let timer: number | undefined;
let historyTimer: number | undefined;

const loadPercent = computed(() => {
  if (!overview.value?.cpuCount) return 0;
  return (overview.value.load1 / overview.value.cpuCount) * 100;
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
    // 总量只在数值变化时写入：历史模式下其它卡依赖 history（30s），
    // 若 memOption 跟着 overview 每 2s 换引用，内存卡会单独重绘并丢掉 connect 轴指针
    const total = Number(data.memTotal) || 0;
    if (total > 0 && total !== memTotalBytes.value) {
      memTotalBytes.value = total;
    }
    // 标签速率每 2s 更新；曲线落点按实时粒度节流（自动 = agent 默认 5s）
    const appendChart = takeLiveChartSlot();
    pushTraffic(data, appendChart);
    pushDiskIO(data, appendChart);
    if (appendChart) pushMonitorSeries(data);
  } catch (e) {
    error.value = formatErr(e);
  }
}

/** 实时「自动」→ agent 默认采集间隔；其它模式同选项秒数 */
function liveGrainSec(): number {
  if (grainMode.value === "auto") return AGENT_DEFAULT_INTERVAL_SEC;
  return GRAIN_SEC[grainMode.value];
}

function updateLiveGrainHint() {
  const sec = liveGrainSec();
  if (grainMode.value === "auto") {
    grainHint.value = `实际：${formatGrainSec(sec)}（agent 默认）`;
  } else {
    grainHint.value = `实际：${formatGrainSec(sec)}`;
  }
}

/** 是否往实时曲线追加一点；非实时始终追加（后台缓冲，切回实时还能用） */
function takeLiveChartSlot(now = Date.now()): boolean {
  if (rangeMode.value !== "live") return true;
  const need = liveGrainSec() * 1000;
  if (lastLiveChartAt > 0 && now - lastLiveChartAt < need) return false;
  lastLiveChartAt = now;
  return true;
}

/** 按目标间隔把点归桶：每桶保留最后一点，ts 对齐到桶起点 */
function downsampleBySec(
  pts: agentcli.RangePoint[],
  everySec: number
): agentcli.RangePoint[] {
  if (!pts.length || everySec <= 1) return pts;
  const out: agentcli.RangePoint[] = [];
  let bucket = Number.NaN;
  let last: agentcli.RangePoint | null = null;
  for (const p of pts) {
    const b = Math.floor(p.ts / everySec) * everySec;
    if (b !== bucket) {
      if (last) out.push(last);
      bucket = b;
    }
    last = { ...p, ts: b };
  }
  if (last) out.push(last);
  return out;
}

function formatGrainSec(sec: number): string {
  if (sec < 60) return `${sec} 秒`;
  if (sec < 3600) return `${Math.round(sec / 60)} 分`;
  return `${Math.round(sec / 3600)} 时`;
}

/** 粒度 → 请求源 + 目标秒数；auto 不抽稀 */
function resolveGrainQuery(grain: GrainMode): {
  src: "auto" | "raw" | "agg";
  everySec: number | null;
} {
  if (grain === "auto") return { src: "auto", everySec: null };
  const everySec = GRAIN_SEC[grain];
  if (everySec < 300) return { src: "raw", everySec };
  return { src: "agg", everySec };
}

async function loadHistory() {
  let from: number;
  let to: number;
  if (rangeMode.value === "custom") {
    const applied = customApplied.value;
    if (!applied) {
      history.value = [];
      grainHint.value = "";
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
  const span = to - from;
  const { src, everySec } = resolveGrainQuery(grainMode.value);
  historyLoading.value = true;
  try {
    const r = await api.agentRange(props.host, from, to, src);
    let pts = r.points || [];
    let effective = everySec;
    if (effective != null) {
      pts = downsampleBySec(pts, effective);
    }
    // 超上限再抽稀：保证五卡可流畅联动
    if (pts.length > MAX_CHART_POINTS) {
      const forced = Math.max(effective || 1, Math.ceil(span / MAX_CHART_POINTS));
      pts = downsampleBySec(r.points || [], forced);
      effective = forced;
    }
    history.value = pts;
    const srcLabel = r.src === "raw" ? "细采样" : r.src === "agg" ? "5 分钟聚合" : r.src;
    if (grainMode.value === "auto") {
      grainHint.value = `实际：${srcLabel}`;
    } else if (effective != null && everySec != null && effective > everySec) {
      grainHint.value = `已抽稀至 ${formatGrainSec(effective)}（${srcLabel}）`;
    } else if (effective != null) {
      grainHint.value = `实际：${formatGrainSec(effective)} · ${srcLabel}`;
    } else {
      grainHint.value = `实际：${srcLabel}`;
    }
  } catch {
    history.value = [];
    grainHint.value = "";
  } finally {
    historyLoading.value = false;
  }
}

watch(rangeMode, (mode) => {
  if (mode === "custom") {
    // 首次点「自定义」：预填并应用最近 24 小时，弹窗也落在当天附近
    if (!customApplied.value) {
      const range = defaultCustomRange();
      customRange.value = range;
      customApplied.value = {
        from: Math.floor(range[0].getTime() / 1000),
        to: Math.floor(range[1].getTime() / 1000),
      };
    }
    void loadHistory();
    return;
  }
  if (mode === "live") {
    lastLiveChartAt = 0;
    updateLiveGrainHint();
    return;
  }
  void loadHistory();
});

watch(grainMode, () => {
  if (rangeMode.value === "live") {
    lastLiveChartAt = 0;
    updateLiveGrainHint();
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

function pushTraffic(data: monitor.Overview, appendChart = true) {
  const now = Date.now();
  const rx = Number(data.netRxBytes) || 0;
  const tx = Number(data.netTxBytes) || 0;
  const prev = lastNet.value;
  lastNet.value = { rx, tx, ts: now };
  // 首点无差分基准：推 0 占位，保证与 cpu/mem/load 卡点数一致
  //（connect 按百分比同步窗口，点数不齐会横向错位）
  if (!prev || now <= prev.ts || rx < prev.rx || tx < prev.tx) {
    if (appendChart) {
      traffic.value = [
        ...traffic.value,
        { time: liveTimeLabel(now), up: 0, down: 0 },
      ].slice(-100);
    }
    return;
  }
  const dt = now - prev.ts;
  const up = bytesToKBps(tx - prev.tx, dt);
  const down = bytesToKBps(rx - prev.rx, dt);
  rates.value = {
    upBps: ((tx - prev.tx) / dt) * 1000,
    downBps: ((rx - prev.rx) / dt) * 1000,
  };
  if (!appendChart) return;
  traffic.value = [...traffic.value, { time: liveTimeLabel(now), up, down }].slice(-100);
}

// 磁盘 IO 速率：对累计值做差分，和网络流量同模式（首点同样推 0 占位）
function pushDiskIO(data: monitor.Overview, appendChart = true) {
  const now = Date.now();
  const read = Number(data.diskReadBytes) || 0;
  const write = Number(data.diskWriteBytes) || 0;
  const count = Number(data.diskIOCount) || 0;
  const prev = lastDisk.value;
  lastDisk.value = { read, write, count, ts: now };
  if (!prev || now <= prev.ts || read < prev.read || write < prev.write) {
    if (appendChart) {
      ioTraffic.value = [
        ...ioTraffic.value,
        { time: liveTimeLabel(now), read: 0, write: 0 },
      ].slice(-100);
    }
    return;
  }
  const dt = now - prev.ts;
  ioRates.value = {
    readBps: ((read - prev.read) / dt) * 1000,
    writeBps: ((write - prev.write) / dt) * 1000,
    iops: Math.round(((count - prev.count) / dt) * 1000),
  };
  if (!appendChart) return;
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

// ---------- 图表 option：每卡独立 ----------
/** 历史模式无数据时的空态（live 预灌失败也可能为空，同样提示） */
const historyEmpty = computed(
  () => rangeMode.value !== "live" && !historyLoading.value && !history.value.length
);

const loadOption = computed<LineOption>(() => {
  const isLive = rangeMode.value === "live";
  return {
    xData: isLive
      ? loadSeries.value.map((p) => p.time)
      : history.value.map((p) => historyTimeLabel(p.ts)),
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
});

const cpuOption = computed<LineOption>(() => {
  const isLive = rangeMode.value === "live";
  return {
    xData: isLive
      ? cpuSeries.value.map((p) => p.time)
      : history.value.map((p) => historyTimeLabel(p.ts)),
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
});

const memOption = computed<LineOption>(() => {
  const isLive = rangeMode.value === "live";
  // 总量参考线：用稳定的 memTotalBytes，不直接读 overview（避免 2s 轮询连带重绘）
  const memTotal = memTotalBytes.value;
  return {
    xData: isLive
      ? memSeries.value.map((p) => p.time)
      : history.value.map((p) => historyTimeLabel(p.ts)),
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
});

const networkOption = computed<LineOption>(() => {
  const isLive = rangeMode.value === "live";
  return {
    xData: isLive
      ? traffic.value.map((p) => p.time)
      : history.value.map((p) => historyTimeLabel(p.ts)),
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

const ioOption = computed<LineOption>(() => {
  const isLive = rangeMode.value === "live";
  return {
    xData: isLive
      ? ioTraffic.value.map((p) => p.time)
      : history.value.map((p) => historyTimeLabel(p.ts)),
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
});

// ---------- 五卡配置：标题/标签/图表选项统一声明，模板 v-for 渲染 ----------

/** 单卡标签：text 文案；warn 走 metric-tag--warn 样式 */
interface MonitorTag {
  text: string;
  warn?: boolean;
}

const monitorCards = computed(() => [
  {
    title: "CPU",
    wide: false,
    tags: computed<MonitorTag[]>(() =>
      overview.value
        ? [
            { text: `${overview.value.cpuPercent.toFixed(2)}%` },
            { text: `${overview.value.cpuCount} 核` },
          ]
        : []
    ),
    option: cpuOption,
  },
  {
    title: "负载",
    wide: false,
    tags: computed<MonitorTag[]>(() =>
      overview.value
        ? [
            { text: `1m ${overview.value.load1.toFixed(2)}` },
            { text: `5m ${overview.value.load5.toFixed(2)}` },
            { text: `15m ${overview.value.load15.toFixed(2)}` },
            { text: `${loadLabel.value} · ${overview.value.cpuCount}核` },
          ]
        : []
    ),
    option: loadOption,
  },
  {
    title: "内存",
    wide: false,
    tags: computed<MonitorTag[]>(() =>
      overview.value
        ? [
            {
              text: `${formatBytes(overview.value.memUsed)} / ${formatBytes(
                overview.value.memTotal
              )}`,
            },
            { text: `${overview.value.memPercent.toFixed(1)}%` },
          ]
        : []
    ),
    option: memOption,
  },
  {
    title: "流量",
    wide: false,
    tags: computed<MonitorTag[]>(() => [
      { text: `↑ ${formatBytes(rates.value.upBps)}/s` },
      { text: `↓ ${formatBytes(rates.value.downBps)}/s` },
    ]),
    option: networkOption,
  },
  {
    title: "磁盘 IO",
    wide: true,
    tags: computed<MonitorTag[]>(() => [
      { text: `读 ${formatBytes(ioRates.value.readBps)}/s` },
      { text: `写 ${formatBytes(ioRates.value.writeBps)}/s` },
      { text: `IOPS ${ioRates.value.iops}/s`, warn: true },
    ]),
    option: ioOption,
  },
]);

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
  memTotalBytes.value = 0;
  history.value = [];
  customRange.value = null;
  customApplied.value = null;
  lastLiveChartAt = 0;
  rangeMode.value = "live";
  updateLiveGrainHint();
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
    // 空闲降频：页面不可见时跳过太近的拉取
    if (!pageVisible.value && Date.now() - lastPollAt < IDLE_MIN_INTERVAL_MS) return;
    lastPollAt = Date.now();
    void loadOverview();
  }, 2000);
  historyTimer = window.setInterval(() => {
    if (rangeMode.value !== "live") void loadHistory();
  }, 30000);
});

// 切回本页立即补刷：实时数据立刻续上
watch(pageVisible, (now, prev) => {
  if (now && !prev && !agentMissing.value) {
    void loadOverview();
  }
});

onBeforeUnmount(() => {
  if (timer) clearInterval(timer);
  if (historyTimer) clearInterval(historyTimer);
});
</script>

<style scoped lang="scss">
/* 监控页占满主区：工具条 + 网格均分剩余高度，尽量一屏看全 */
.monitor-page {
  box-sizing: border-box;
  min-width: 0;
  max-width: 100%;
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 0;
  overflow: hidden;
}

.monitor-toolbar {
  flex-shrink: 0;
  padding: 4px 2px 0;
}

.card-title-group {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  row-gap: 4px;
}

.range-group {
  margin-left: 4px;
}

.grain-label {
  margin-left: 8px;
  color: var(--m3-on-surface-variant, #49454f);
  font-size: 13px;
}

.grain-select {
  width: 96px;
}

.grain-hint {
  color: var(--m3-on-surface-variant, #49454f);
  font-size: 12px;
}

.custom-range-row {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  padding: 6px 0 0;
}
.custom-range-hint {
  color: var(--m3-on-surface-variant, #49454f);
  font-size: 12px;
}

.monitor-grid {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: 1fr 1fr;
  /* 三行均分：上两行各两卡，底行磁盘 IO 通栏 */
  grid-template-rows: 1fr 1fr 1fr;
  gap: 10px;
}

.monitor-cell {
  min-width: 0;
  min-height: 0;
  height: 100%;
  display: flex;
  flex-direction: column;

  :deep(.monitor-card) {
    flex: 1;
    min-height: 0;
    height: 100%;
    margin: 0 !important;
    display: flex;
    flex-direction: column;
  }

  :deep(.el-card__body) {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    padding: 10px 12px 8px;
    box-sizing: border-box;
  }
}

.monitor-cell--wide {
  grid-column: 1 / -1;
}

/* 最大化后整卡吃满视口，图表槽跟着拉高 */
.monitor-cell.is-enlarged {
  display: flex;
  flex-direction: column;

  :deep(.monitor-card),
  :deep(.el-card__body) {
    height: 100%;
  }
}

.card-header {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 12px;
  /* 给右上角最大化角标留空，避免压住标签 */
  padding-right: 28px;
}

.monitor-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  justify-content: flex-end;
}

.chart-slot {
  flex: 1;
  min-height: 0;
  position: relative;

  /* VChartLine 根节点吃满槽位，供 echarts 自动 resize */
  :deep(.v-chart-line) {
    position: absolute;
    inset: 0;
    height: 100% !important;
  }
}

.history-empty {
  height: 100%;
  min-height: 80px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--m3-on-surface-variant, #49454f);
  font-size: 13px;
  padding: 0;
}

/* 窄屏：单列纵向排，允许页面滚动 */
@media (max-width: 960px) {
  .monitor-page {
    height: auto;
    min-height: 100%;
    overflow: auto;
  }
  .monitor-grid {
    grid-template-columns: 1fr;
    grid-template-rows: none;
    flex: none;
  }
  .monitor-cell--wide {
    grid-column: auto;
  }
  .chart-slot {
    position: relative;
    height: 180px;
    flex: none;
  }
}
</style>
