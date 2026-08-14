<template>
  <div class="java-root">
    <!-- 顶部：VM 可用性 + Java 进程列表 -->
    <div class="top-bar">
      <div class="vm-status">
        <el-tag v-if="probe.available" type="success" size="small">
          VM 可用 · {{ probe.latencyMs }}ms
        </el-tag>
        <el-tag v-else-if="!probeLoading" type="info" size="small">
          VM 未部署（仅显示实时值）
        </el-tag>
      </div>
      <el-button size="small" @click="refreshAll" :loading="loading">
        刷新
      </el-button>
    </div>

    <div class="proc-list" v-loading="loading && !details.length">
      <el-alert v-if="error" type="error" :title="error" show-icon closable />
      <el-empty v-if="!loading && !details.length" description="未发现 Java 进程" />
      <el-radio-group v-model="selectedPid" size="small" v-if="details.length">
        <el-radio-button
          v-for="d in details"
          :key="d.pid"
          :value="d.pid"
        >
          {{ appLabel(d) }}
          <span v-if="scrapedApps.has(appLabel(d))" class="scrape-dot" title="已接入 VM">●</span>
        </el-radio-button>
      </el-radio-group>
    </div>

    <!-- 选中进程的详情 -->
    <div v-if="selected" class="detail">
      <div class="meta-cards">
        <div class="meta-card">
          <div class="meta-label">PID</div>
          <div class="meta-value">{{ selected.pid }}</div>
        </div>
        <div class="meta-card">
          <div class="meta-label">Xms / Xmx</div>
          <div class="meta-value">{{ selected.xms || "—" }} / {{ selected.xmx || "—" }}</div>
        </div>
        <div class="meta-card">
          <div class="meta-label">端口</div>
          <div class="meta-value">{{ selected.port || "—" }}</div>
        </div>
        <div class="meta-card">
          <div class="meta-label">screen</div>
          <div class="meta-value">{{ selected.screen || "—" }}</div>
        </div>
        <div class="meta-card">
          <div class="meta-label">GC 日志</div>
          <div class="meta-value">
            <el-tag :type="selected.hasGCLogging ? 'success' : 'info'" size="small">
              {{ selected.hasGCLogging ? "已开启" : "未开启" }}
            </el-tag>
          </div>
        </div>
        <div class="meta-card">
          <div class="meta-label">OOM 退出码</div>
          <div class="meta-value">
            <el-tag :type="selected.hasExitCode ? 'warning' : 'info'" size="small">
              {{ selected.hasExitCode ? "ExitOnOOM" : "未启用" }}
            </el-tag>
          </div>
        </div>
        <div class="meta-card wide">
          <div class="meta-label">JAR</div>
          <div class="meta-value path" :title="selected.jar">{{ selected.jar || "—" }}</div>
        </div>
      </div>

      <!-- 终止原因分析（选中进程的 screen 会话）-->
      <div class="exit-panel" v-if="exitReason">
        <div class="exit-label">终止原因分析</div>
        <el-tag :type="exitTagType" size="small">
          {{ exitReason.category }}
        </el-tag>
        <span class="exit-detail">{{ exitReason.detail }}</span>
        <span class="exit-meta" v-if="exitReason.exitCode >= 0">
          退出码 {{ exitReason.exitCode }}
        </span>
      </div>

      <!-- 三个子页签 -->
      <el-tabs v-model="subView" class="sub-tabs">
        <!-- 内存：堆使用曲线 + Xmx 上限 -->
        <el-tab-pane label="内存" name="memory">
          <div v-if="!probe.available" class="hint">
            VM 未部署，无法显示历史曲线。仅显示实时 Xms/Xmx（见上方卡片）。
          </div>
          <div v-else class="chart-wrap">
            <div class="chart-header">
              <span>堆内存使用（近 {{ rangeHours }} 小时）</span>
              <el-radio-group v-model="rangeHours" size="small" @change="loadMemChart">
                <el-radio-button :value="1">1h</el-radio-button>
                <el-radio-button :value="6">6h</el-radio-button>
                <el-radio-button :value="24">24h</el-radio-button>
              </el-radio-group>
            </div>
            <VChartLine
              v-if="memOption"
              :option="memOption"
              height="280px"
            />
            <el-empty v-else :description="memEmptyHint" />
          </div>
        </el-tab-pane>

        <!-- GC：条件显示（仅当 hasGCLogging） -->
        <el-tab-pane label="GC" name="gc" :disabled="!selected.hasGCLogging">
          <div v-if="!selected.hasGCLogging" class="hint">
            该进程未开启 -Xlog:gc，无法显示 GC 信息。
          </div>
          <div v-else class="gc-wrap">
            <div v-if="probe.available && selected.port" class="chart-wrap">
              <div class="chart-header">
                <span>GC 分配速率（近 {{ rangeHours }} 小时）</span>
              </div>
              <VChartLine
                v-if="gcOption"
                :option="gcOption"
                height="200px"
              />
            </div>
            <div class="gc-log">
              <div class="gc-log-header">
                <span>GC 日志末尾 200 行</span>
                <el-button size="small" @click="loadGcLog" :loading="gcLogLoading">
                  刷新日志
                </el-button>
              </div>
              <pre class="gc-log-body">{{ gcLog }}</pre>
            </div>
          </div>
        </el-tab-pane>

        <!-- 日志：screen 控制台 + GC 日志 -->
        <el-tab-pane label="日志" name="logs">
          <div class="log-wrap">
            <div class="log-section">
              <div class="log-header">
                <span>screen 控制台（{{ selected.screen || "未知会话" }}）</span>
                <el-button
                  size="small"
                  @click="openScreenTerminal"
                  :disabled="!selected.screen"
                >
                  在终端中打开
                </el-button>
              </div>
              <div class="log-hint" v-if="selected.screen">
                已为你切到终端页签，执行 <code>screen -r {{ selected.screen }}</code> 即可接入会话。
              </div>
              <div class="log-hint" v-else>
                该进程未关联 screen 会话（可能是 nohup / systemd 启动）。
              </div>
            </div>
            <div class="log-section" v-if="selected.hasGCLogging">
              <div class="log-header">
                <span>GC 日志原文</span>
                <el-button size="small" @click="loadGcLog" :loading="gcLogLoading">
                  加载末尾 200 行
                </el-button>
              </div>
              <pre class="log-body">{{ gcLog || "点击上方按钮加载…" }}</pre>
            </div>
          </div>
        </el-tab-pane>
      </el-tabs>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useAppStore } from "@/stores/app";
import { api } from "@/api";
import { usePolling } from "@/composables/usePolling";
import VChartLine, { type LineOption } from "@/components/VChartLine.vue";
import { ElMessage } from "element-plus";

interface JavaDetail {
  pid: number;
  xms: string;
  xmx: string;
  jar: string;
  gcLog: string;
  heapDumpPath: string;
  screen: string;
  hasGCLogging: boolean;
  hasExitCode: boolean;
  port: number;
}

interface ProbeResult {
  available: boolean;
  version: string;
  latencyMs: number;
}

interface ExitReason {
  session: string;
  pid: number;
  exitCode: number;
  rawReason: string;
  category: string;
  detail: string;
  hasDump: boolean;
  hasHsErr: boolean;
  dmesgHit: boolean;
}

const props = defineProps<{ host: string }>();
const appStore = useAppStore();

const subView = ref<"memory" | "gc" | "logs">("memory");
const selectedPid = ref<number>(0);
const rangeHours = ref(1);

// 进程详情：轮询
const { data, error, loading, refresh } = usePolling<JavaDetail[]>(
  () => api.collectJavaDetail(props.host) as Promise<JavaDetail[]>,
  5000,
  () => [props.host]
);
const details = computed(() => data.value || []);
const selected = computed(() =>
  details.value.find((d) => d.pid === selectedPid.value) || details.value[0]
);

// 自动选第一个
watch(details, (list) => {
  if (list.length && !list.find((d) => d.pid === selectedPid.value)) {
    selectedPid.value = list[0].pid;
  }
}, { immediate: true });

// VM 探测（不轮询，进入页签探一次 + 手动刷新）
const probe = ref<ProbeResult>({ available: false, version: "", latencyMs: 0 });
const probeLoading = ref(false);
const scrapedApps = ref<Set<string>>(new Set());
async function loadProbe() {
  probeLoading.value = true;
  try {
    probe.value = await api.probeMetrics(props.host);
    if (probe.value.available) {
      await loadScrapedApps();
    }
  } catch (e) {
    probe.value = { available: false, version: "", latencyMs: 0 };
  } finally {
    probeLoading.value = false;
  }
}

async function loadScrapedApps() {
  try {
    const raw = await api.queryMetric(
      props.host,
      'count by (app) (jvm_memory_used_bytes{area="heap"})'
    );
    const json = JSON.parse(decodeVmJson(raw));
    const apps = new Set<string>();
    for (const item of json?.data?.result || []) {
      const app = item.metric?.app;
      if (app) apps.add(app);
    }
    scrapedApps.value = apps;
  } catch {
    scrapedApps.value = new Set();
  }
}

const memEmptyHint = computed(() => {
  const app = selected.value ? appLabel(selected.value) : "";
  const joined = Array.from(scrapedApps.value).join("、") || "暂无";
  if (app && !scrapedApps.value.has(app)) {
    return `「${app}」尚未暴露 /actuator/prometheus，VM 里没有堆曲线。当前已接入：${joined}。请点选带 ● 的进程查看。`;
  }
  return "暂无堆内存数据。";
});

// 内存曲线
const memOption = ref<LineOption | null>(null);
async function loadMemChart() {
  if (!probe.value.available || !selected.value) {
    memOption.value = null;
    return;
  }
  const app = appLabel(selected.value);
  // 必须带 {area="heap"}，否则会把非堆加进来。优先按 app 标签查，pid 作兜底。
  const query = app
    ? `sum(jvm_memory_used_bytes{area="heap",app="${app}"})`
    : `sum(jvm_memory_used_bytes{area="heap",pid="${selected.value.pid}"})`;
  const end = Math.floor(Date.now() / 1000);
  const start = end - rangeHours.value * 3600;
  const step = rangeHours.value <= 1 ? 15 : 60;
  try {
    const raw = await api.queryMetricRange(props.host, query, start, end, step);
    memOption.value = parseRangeResponse(raw, "堆使用", "bytes");
  } catch (e) {
    ElMessage.error("加载内存曲线失败: " + (e as Error).message);
    memOption.value = null;
  }
}

// GC 曲线（分配速率）
const gcOption = ref<LineOption | null>(null);
async function loadGcChart() {
  if (!probe.value.available || !selected.value) return;
  const app = appLabel(selected.value);
  const query = app
    ? `rate(jvm_gc_memory_allocated_bytes_total{app="${app}"}[5m])`
    : `rate(jvm_gc_memory_allocated_bytes_total{pid="${selected.value.pid}"}[5m])`;
  const end = Math.floor(Date.now() / 1000);
  const start = end - rangeHours.value * 3600;
  const step = rangeHours.value <= 1 ? 15 : 60;
  try {
    const raw = await api.queryMetricRange(props.host, query, start, end, step);
    gcOption.value = parseRangeResponse(raw, "分配速率", "rate");
  } catch (e) {
    gcOption.value = null;
  }
}

// GC 日志原文
const gcLog = ref("");
const gcLogLoading = ref(false);
async function loadGcLog() {
  if (!selected.value?.gcLog) {
    ElMessage.warning("该进程未指定 GC 日志路径");
    return;
  }
  gcLogLoading.value = true;
  try {
    gcLog.value = await api.collectJvmEvents(props.host, selected.value.gcLog, 200);
  } catch (e) {
    ElMessage.error("加载 GC 日志失败: " + (e as Error).message);
  } finally {
    gcLogLoading.value = false;
  }
}

// 终止原因分析
const exitReason = ref<ExitReason | null>(null);
async function loadExitReason() {
  if (!selected.value) {
    exitReason.value = null;
    return;
  }
  const jarDir = selected.value.jar?.substring(0, selected.value.jar.lastIndexOf("/")) || "";
  if (!selected.value.screen || !jarDir) {
    exitReason.value = null;
    return;
  }
  try {
    exitReason.value = await api.analyzeExitReason(props.host, selected.value.screen, jarDir);
  } catch (e) {
    // 分析失败不阻塞主界面
    exitReason.value = null;
  }
}
const exitTagType = computed(() => {
  const cat = exitReason.value?.category || "";
  if (cat === "running") return "success";
  if (cat === "normal-shutdown") return "info";
  if (cat === "heap-oom" || cat === "system-oom" || cat === "jvm-crash") return "danger";
  if (cat === "killed-sigkill") return "warning";
  return "info";
});

// 切到终端页签并提示用户接入 screen
function openScreenTerminal() {
  if (!selected.value?.screen) return;
  appStore.setSubTab(props.host, "terminal");
  ElMessage.info(`请在终端执行: screen -r ${selected.value.screen}`);
}

// 切换进程或时间范围时重载图表
watch([selected, () => probe.value.available], () => {
  loadExitReason();
  if (subView.value === "memory") loadMemChart();
  if (subView.value === "gc") {
    loadGcChart();
    loadGcLog();
  }
});
watch(subView, (v) => {
  if (v === "memory") loadMemChart();
  if (v === "gc") {
    loadGcChart();
    loadGcLog();
  }
});
watch(rangeHours, () => {
  if (subView.value === "memory") loadMemChart();
  if (subView.value === "gc") loadGcChart();
});

async function refreshAll() {
  await Promise.all([refresh(), loadProbe()]);
  if (subView.value === "memory") loadMemChart();
  if (subView.value === "gc") loadGcChart();
}

function appLabel(d: JavaDetail): string {
  // 从 jar 路径抽应用名，如 diteng-csp-xxx.jar → diteng-csp
  const base = (d.jar || "").split("/").pop() || "";
  const m = base.match(/^([a-zA-Z][a-zA-Z0-9-]*?)-\d/);
  return m ? m[1] : (base.replace(/\.jar$/, "") || `pid:${d.pid}`);
}

function decodeVmJson(raw: unknown): string {
  if (raw == null) return "";
  if (typeof raw === "string") return raw;
  if (raw instanceof Uint8Array) return new TextDecoder().decode(raw);
  if (Array.isArray(raw)) return new TextDecoder().decode(new Uint8Array(raw as number[]));
  if (typeof raw === "object") return JSON.stringify(raw);
  return String(raw);
}

// 解析 VM range 响应为 VChartLine 的 option
function parseRangeResponse(
  raw: unknown,
  seriesName: string,
  unit: "bytes" | "rate"
): LineOption | null {
  const text = decodeVmJson(raw);
  let json: any;
  try {
    json = typeof raw === "object" && raw !== null && !Array.isArray(raw) && !(raw instanceof Uint8Array)
      ? raw
      : JSON.parse(text);
  } catch {
    return null;
  }
  const result = json?.data?.result;
  if (!Array.isArray(result) || result.length === 0) return null;

  // 合并多个 series（一般只有一条 sum）
  const allTs = new Set<number>();
  const seriesData: Record<string, Record<number, number | null>> = {};
  for (const item of result) {
    const name = item.metric?.__name__ || item.metric?.id || seriesName;
    seriesData[name] = {};
    const pairs = item.values || [];
    for (const [ts, val] of pairs) {
      const n = parseFloat(val);
      seriesData[name][ts] = isNaN(n) ? null : n;
      allTs.add(ts);
    }
  }
  const sortedTs = Array.from(allTs).sort((a, b) => a - b);
  const xData = sortedTs.map((ts) => {
    const d = new Date(ts * 1000);
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  });
  const yData = Object.entries(seriesData).map(([name, map]) => ({
    name,
    data: sortedTs.map((ts) => (ts in map ? map[ts] : null)),
  }));
  return {
    xData,
    yData,
    formatStr: unit === "bytes" ? "MB" : "KB/s",
    unit,
  };
}

// 进入页面初始化
loadProbe();
</script>

<style scoped lang="scss">
.java-root {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 12px 16px 20px;
}
.top-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}
.vm-status {
  display: flex;
  gap: 8px;
  align-items: center;
}
.scrape-dot {
  color: #67c23a;
  font-size: 10px;
  margin-left: 2px;
}
.detail {
  background: var(--el-bg-color);
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 6px;
  padding: 14px;
}
.meta-cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
  gap: 10px;
  margin-bottom: 16px;
}
.meta-card {
  padding: 8px 10px;
  background: var(--el-fill-color-light);
  border-radius: 4px;
  &.wide {
    grid-column: span 2;
  }
  .meta-label {
    font-size: 11px;
    color: var(--el-text-color-secondary);
    margin-bottom: 4px;
  }
  .meta-value {
    font-size: 13px;
    font-weight: 500;
    &.path {
      font-family: monospace;
      font-size: 12px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
  }
}
.sub-tabs {
  :deep(.el-tabs__content) {
    overflow: visible;
  }
}
.exit-panel {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  margin-bottom: 16px;
  background: var(--el-fill-color-light);
  border-radius: 4px;
  font-size: 12px;
  .exit-label {
    color: var(--el-text-color-secondary);
  }
  .exit-detail {
    color: var(--el-text-color-regular);
  }
  .exit-meta {
    color: var(--el-text-color-secondary);
    margin-left: auto;
  }
}
.hint {
  padding: 20px;
  color: var(--el-text-color-secondary);
  text-align: center;
  font-size: 13px;
}
.chart-wrap {
  margin-top: 10px;
}
.chart-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
  font-size: 13px;
  color: var(--el-text-color-regular);
}
.gc-wrap,
.log-wrap {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.gc-log,
.log-section {
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 4px;
  overflow: hidden;
}
.gc-log-header,
.log-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 10px;
  background: var(--el-fill-color-light);
  font-size: 12px;
  color: var(--el-text-color-regular);
}
.gc-log-body,
.log-body {
  margin: 0;
  padding: 10px;
  max-height: 320px;
  overflow: auto;
  font-size: 12px;
  font-family: monospace;
  background: var(--el-bg-color);
  color: var(--el-text-color-regular);
  white-space: pre-wrap;
  word-break: break-all;
}
.log-hint {
  padding: 10px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
  code {
    background: var(--el-fill-color);
    padding: 1px 4px;
    border-radius: 2px;
    font-family: monospace;
  }
}
</style>
