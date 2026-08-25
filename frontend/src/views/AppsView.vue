<template>
  <div class="apps-page">
    <el-alert v-if="error" type="error" :title="error" show-icon :closable="false" />
    <div class="apps-toolbar">
      <span class="panel-section-title">应用监视</span>
      <span class="hint">对照曲线不是自动根因。Java 看堆/GC，Bun 看 RSS/CPU 与宿主压力。</span>
      <el-button size="small" @click="loadAll">刷新</el-button>
      <el-button size="small" @click="openCfg">监视配置</el-button>
    </div>
    <div class="cards">
      <button
        v-for="s in status"
        :key="s.service"
        type="button"
        class="svc-card"
        :class="{ active: selected === s.service }"
        @click="selected = s.service || ''"
      >
        <div class="svc-name">
          {{ s.service }}
          <span class="rt">{{ runtimeLabel(s.runtime) }}</span>
        </div>
        <div class="lamps">
          <span :class="['lamp', s.processUp ? 'on' : 'off']">进程</span>
          <span :class="['lamp', s.healthUp ? 'on' : 'off']">本机</span>
          <span v-if="s.ingressOn" :class="['lamp', s.ingressUp ? 'on' : 'off']">入口</span>
        </div>
      </button>
      <div v-if="!status.length && !error" class="empty">暂无监视清单（先下发 watch.yml，并确认 agent 已更新）</div>
    </div>

    <el-card v-if="selected" shadow="never" class="chart-card">
      <div class="card-header">
        <span>{{ selected }} · 对照（近 1 小时）</span>
      </div>
      <p class="caption">
        {{ isBun ? "Bun：RSS / CPU 与主机对照。红虚线是探活或进程事件。" : "堆 / RSS / GC pause 与主机 CPU、内存同一时间轴。红虚线是探活或进程事件。" }}
      </p>
      <VChartLine v-if="!isBun" height="220px" :option="heapOption" />
      <VChartLine v-else height="220px" :option="rssOption" />
      <VChartLine v-if="!isBun" height="180px" :option="gcOption" />
      <VChartLine v-else height="180px" :option="cpuOption" />
      <VChartLine height="180px" :option="hostOption" />
      <el-table v-if="events.length" :data="events" size="small" class="ev-table">
        <el-table-column prop="layer" label="层" width="90" />
        <el-table-column prop="kind" label="类型" width="80" />
        <el-table-column prop="msg" label="说明" />
      </el-table>
    </el-card>

    <el-dialog v-model="cfgOpen" title="下发 watch.yml" width="720px" append-to-body>
      <p class="sec-desc">企业微信 Webhook 写在 yaml 的 wecomWebhook，不会进 git。保存后 agent 热加载。</p>
      <el-input v-model="yamlText" type="textarea" :rows="18" class="yaml-box" />
      <template #footer>
        <el-button @click="cfgOpen = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="saveCfg">下发</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { ElMessage } from "element-plus";
import { api } from "@/api";
import type { agentcli } from "@/api";
import VChartLine, { type LineOption } from "@/components/VChartLine.vue";
import { useAppStore } from "@/stores/app";

const props = defineProps<{ host: string }>();
const app = useAppStore();

const error = ref("");
const status = ref<agentcli.WatchStatus[]>([]);
const selected = ref("");
const jarPts = ref<agentcli.JarRangePoint[]>([]);
const hostPts = ref<agentcli.RangePoint[]>([]);
const events = ref<agentcli.WatchEventRow[]>([]);
const cfgOpen = ref(false);
const yamlText = ref("");
const saving = ref(false);

let timer: ReturnType<typeof setInterval> | null = null;

function pad(n: number) {
  return n < 10 ? "0" + n : String(n);
}
function timeLabel(ts: number) {
  const d = new Date(ts * 1000);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

async function loadAll() {
  error.value = "";
  try {
    const st = (await api.agentWatchStatus(props.host)) || [];
    status.value = st;
    if (!selected.value && st.length) selected.value = st[0].service || "";
    await loadDetail();
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  }
}

async function loadDetail() {
  if (!selected.value) return;
  const to = Math.floor(Date.now() / 1000);
  const from = to - 3600;
  const [jr, hr, ev] = await Promise.all([
    api.agentWatchRange(props.host, selected.value, from, to),
    api.agentRange(props.host, from, to, "raw"),
    api.agentWatchEvents(props.host, selected.value, from, to),
  ]);
  jarPts.value = jr.points || [];
  hostPts.value = hr.points || [];
  events.value = ev || [];
}

const marks = computed(() => {
  const xs = new Set(jarPts.value.map((p) => timeLabel(p.ts)));
  const out: { name: string; x: string }[] = [];
  for (const e of events.value) {
    if (!e.ts) continue;
    const x = timeLabel(e.ts);
    if (!xs.has(x)) continue;
    out.push({ name: `${e.layer}/${e.kind}`, x });
  }
  return out.slice(0, 20);
});

function runtimeLabel(rt?: string) {
  if (rt === "bun") return "Bun";
  return "Spring Boot";
}

const selectedMeta = computed(() =>
  status.value.find((s) => s.service === selected.value)
);
const isBun = computed(() => selectedMeta.value?.runtime === "bun");

const rssOption = computed<LineOption>(() => ({
  xData: jarPts.value.map((p) => timeLabel(p.ts)),
  yData: [{ name: "RSS", data: jarPts.value.map((p) => p.rss || 0) }],
  formatStr: "B",
  unit: "bytes",
  markLines: marks.value,
}));

const cpuOption = computed<LineOption>(() => ({
  xData: jarPts.value.map((p) => timeLabel(p.ts)),
  yData: [{ name: "进程 CPU%", data: jarPts.value.map((p) => p.cpuPercent || 0) }],
  formatStr: "%",
  unit: "raw",
}));

const heapOption = computed<LineOption>(() => ({
  xData: jarPts.value.map((p) => timeLabel(p.ts)),
  yData: [
    { name: "堆已用", data: jarPts.value.map((p) => p.heapUsed || 0) },
    { name: "RSS", data: jarPts.value.map((p) => p.rss || 0) },
  ],
  formatStr: "B",
  unit: "bytes",
  markLines: marks.value,
}));

const gcOption = computed<LineOption>(() => ({
  xData: jarPts.value.map((p) => timeLabel(p.ts)),
  yData: [
    { name: "GC pause", data: jarPts.value.map((p) => p.gcPauseMs || 0) },
    { name: "进程 CPU%", data: jarPts.value.map((p) => p.cpuPercent || 0) },
  ],
  formatStr: "ms / %",
  unit: "raw",
}));

const hostOption = computed<LineOption>(() => ({
  xData: hostPts.value.map((p) => timeLabel(p.ts)),
  yData: [
    { name: "主机 CPU%", data: hostPts.value.map((p) => p.cpuPercent || 0) },
    {
      name: "主机内存",
      data: hostPts.value.map((p) => p.memUsed || 0),
    },
  ],
  formatStr: "对照",
  unit: "raw",
}));

async function openCfg() {
  cfgOpen.value = true;
  try {
    const r = await api.agentGetWatch(props.host);
    yamlText.value = r.yaml || "";
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : String(e));
  }
}

async function saveCfg() {
  saving.value = true;
  try {
    await api.agentPutWatch(props.host, yamlText.value);
    ElMessage.success("已下发");
    cfgOpen.value = false;
    await loadAll();
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : String(e));
  } finally {
    saving.value = false;
  }
}

function startTimer() {
  stopTimer();
  timer = setInterval(() => {
    if (app.isHostSubActive(props.host, "apps")) loadAll();
  }, 15000);
}
function stopTimer() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

watch(
  () => props.host,
  () => {
    selected.value = "";
    loadAll();
  }
);
watch(selected, () => {
  if (selected.value) loadDetail();
});

loadAll();
startTimer();
onBeforeUnmount(stopTimer);
</script>

<style scoped lang="scss">
.apps-page {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-height: 0;
}
.apps-toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.hint {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  flex: 1;
}
.cards {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.svc-card {
  border: 1px solid var(--el-border-color);
  border-radius: 8px;
  background: var(--el-bg-color);
  padding: 10px 12px;
  text-align: left;
  cursor: pointer;
  min-width: 140px;
  &.active {
    border-color: var(--el-color-primary);
  }
}
.svc-name {
  font-weight: 600;
  margin-bottom: 6px;
  display: flex;
  align-items: baseline;
  gap: 6px;
}
.rt {
  font-size: 11px;
  font-weight: 500;
  color: var(--el-text-color-secondary);
}
.lamps {
  display: flex;
  gap: 6px;
}
.lamp {
  font-size: 11px;
  padding: 1px 6px;
  border-radius: 99px;
  &.on {
    background: var(--el-color-success-light-9);
    color: var(--el-color-success);
  }
  &.off {
    background: var(--el-color-danger-light-9);
    color: var(--el-color-danger);
  }
}
.empty {
  color: var(--el-text-color-secondary);
  font-size: 13px;
}
.chart-card {
  min-width: 0;
}
.caption {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  margin: 0 0 8px;
}
.ev-table {
  margin-top: 12px;
}
.yaml-box :deep(textarea) {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
}
.sec-desc {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  margin: 0 0 8px;
}
</style>
