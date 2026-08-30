<template>
  <div class="apps-root">
  <div class="apps-page page-panel">
    <el-alert v-if="error" type="error" :title="error" show-icon :closable="false" class="page-alert" />

    <div class="page-toolbar">
      <span class="panel-section-title">应用监视</span>
      <span class="page-toolbar__hint">实例表点行看曲线；下架前请到「Nginx」标签核对切流。</span>
      <div class="page-toolbar__actions">
        <el-button @click="loadAll">刷新</el-button>
        <el-button @click="openCfg">监视配置</el-button>
      </div>
    </div>

    <template v-for="(sec, secIdx) in instanceSections" :key="sec.key">
      <div class="apps-section">
        <div class="apps-section__head">
          <span class="apps-section__title">{{ sec.title }}</span>
          <span class="apps-section__count">{{ sec.rows.length }} 条</span>
        </div>
        <el-table
          :data="sec.rows"
          size="default"
          stripe
          highlight-current-row
          class="data-table-unified"
          :show-header="secIdx === 0"
          @row-click="onInstRowClick"
        >
          <el-table-column type="index" label="#" width="48" align="center" />
          <el-table-column prop="service" label="标识" width="128">
            <template #default="{ row }">
              <el-tag size="small" type="primary" effect="light" class="svc-tag">{{ row.service }}</el-tag>
              <el-tag v-if="row.runtime === 'bun'" size="small" type="info" effect="plain" class="rt-tag">Bun</el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="port" label="端口" width="72" align="center" />
          <el-table-column prop="deployVer" label="部署版本" width="100" />
          <el-table-column prop="startTime" label="启动时间" width="160" show-overflow-tooltip />
          <el-table-column prop="screen" label="screen" width="120" show-overflow-tooltip />
          <el-table-column prop="jarPath" label="路径" min-width="200" show-overflow-tooltip />
          <el-table-column prop="status" label="状态" width="180">
            <template #default="{ row }">
              <div class="lamps">
                <span :class="['lamp', row.processUp ? 'on' : 'off']">进程</span>
                <span :class="['lamp', row.healthUp ? 'on' : 'off']">本机</span>
                <span v-if="row.ingressOn" :class="['lamp', row.ingressUp ? 'on' : 'off']">入口</span>
              </div>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="80" align="center" fixed="right">
            <template #default="{ row }">
              <el-button
                v-if="canShutdown(row)"
                type="danger"
                size="small"
                link
                @click.stop="openShutdown(row)"
              >
                下架
              </el-button>
            </template>
          </el-table-column>
        </el-table>
      </div>
    </template>

    <div v-if="!instanceSections.length && !error" class="page-empty">暂无监视实例</div>
  </div>

  <el-dialog
      v-model="chartsOpen"
      :title="chartsTitle"
      width="860px"
      append-to-body
      class="charts-dialog"
      @closed="chartsOpen = false"
    >
      <p class="caption">
        {{ isBun ? "Bun：RSS / CPU 与主机对照。红虚线是探活或进程事件。" : "堆 / RSS / GC pause 与主机 CPU、内存同一时间轴。红虚线是探活或进程事件。" }}
      </p>
      <VChartLine v-if="!isBun" height="200px" :option="heapOption" />
      <VChartLine v-else height="200px" :option="rssOption" />
      <VChartLine v-if="!isBun" height="160px" :option="gcOption" />
      <VChartLine v-else height="160px" :option="cpuOption" />
      <VChartLine height="160px" :option="hostOption" />
      <el-table v-if="events.length" :data="events" size="small" class="ev-table">
        <el-table-column prop="layer" label="层" width="90" />
        <el-table-column prop="kind" label="类型" width="80" />
        <el-table-column prop="msg" label="说明" />
      </el-table>
    </el-dialog>

    <el-dialog v-model="shutdownOpen" title="确认下架" width="520px" append-to-body>
      <div v-if="shutdownTarget" class="shutdown-body">
        <p class="warn">nginx 切流须运维人工完成；面板不代为重载 nginx。</p>
        <div class="kv"><span>服务</span><b>{{ shutdownTarget.service }}</b></div>
        <div class="kv"><span>PID</span><b>{{ shutdownTarget.pid }}</b></div>
        <div class="kv"><span>端口</span><b>{{ shutdownTarget.port }}</b></div>
        <div class="kv"><span>部署版本</span><b>{{ shutdownTarget.deployVer || "-" }}</b></div>
        <div class="kv"><span>启动时间</span><b>{{ shutdownTarget.startTime || "-" }}</b></div>
        <div class="kv"><span>screen</span><b>{{ shutdownTarget.screen || "-" }}</b></div>
        <div class="kv path"><span>路径</span><b>{{ shutdownTarget.jarPath || "-" }}</b></div>
        <el-button type="primary" link @click="goNginxTab">查看 Nginx 配置</el-button>
        <el-checkbox v-model="nginxConfirmed" class="nginx-check">
          我已核对 nginx 上游/切流，确认可以下线该实例
        </el-checkbox>
      </div>
      <template #footer>
        <el-button @click="shutdownOpen = false">取消</el-button>
        <el-button type="danger" :loading="shutdownLoading" :disabled="!nginxConfirmed" @click="confirmShutdown">
          确认下架
        </el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="cfgOpen" title="下发 watch.yml" width="720px" append-to-body>
      <p class="sec-desc">
        服务清单与探活路径在此编辑。企微通知总开关 / 地址请到「设置 → 通知」配置并下发。
      </p>
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
import { useSettingsStore } from "@/stores/settings";
import { patchWatchNotify } from "@/utils/watchYaml";

const props = defineProps<{ host: string }>();
const app = useAppStore();
const settings = useSettingsStore();

const error = ref("");
const status = ref<agentcli.WatchStatus[]>([]);
const instances = ref<agentcli.JavaAppInstance[]>([]);
const selected = ref("");
const jarPts = ref<agentcli.JarRangePoint[]>([]);
const hostPts = ref<agentcli.RangePoint[]>([]);
const events = ref<agentcli.WatchEventRow[]>([]);
const cfgOpen = ref(false);
const yamlText = ref("");
const saving = ref(false);

const shutdownOpen = ref(false);
const shutdownTarget = ref<agentcli.JavaAppInstance | null>(null);
const nginxConfirmed = ref(false);
const shutdownLoading = ref(false);

const chartsOpen = ref(false);
const chartsTitle = computed(() =>
  selected.value ? `${selected.value} · 对照（近 1 小时）` : ""
);

let timer: ReturnType<typeof setInterval> | null = null;

function pad(n: number) {
  return n < 10 ? "0" + n : String(n);
}
function timeLabel(ts: number) {
  const d = new Date(ts * 1000);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function canShutdown(row: agentcli.JavaAppInstance) {
  if (!row.processUp || !row.port || !row.screen) return false;
  const st = row.status || "";
  return st === "UP" || st === "UNHEALTHY";
}

const tableRows = computed(() => {
  const bySvc = new Map(status.value.map((s) => [s.service || "", s]));
  const seen = new Set<string>();
  const rows: agentcli.JavaAppInstance[] = instances.value.map((r) => {
    const name = r.service || "";
    seen.add(name);
    const st = bySvc.get(name);
    const group =
      name === "ai-agent" || name === "sapi-agent" ? "other" : r.group || "pro";
    if (!st) return { ...r, group };
    return {
      ...r,
      group,
      runtime: r.runtime || st.runtime,
      processUp: st.processUp,
      healthUp: st.healthUp,
      ingressOn: st.ingressOn,
      ingressUp: st.ingressUp,
      status: st.processUp ? (st.healthUp ? "UP" : "UNHEALTHY") : "DOWN",
    };
  });
  // watch.yml 有但 instances 未返回的（旧 agent 跳过 bun）：补行
  for (const s of status.value) {
    const name = s.service || "";
    if (!name || seen.has(name)) continue;
    const group =
      name === "ai-agent" || name === "sapi-agent"
        ? "other"
        : ["oss", "im", "csp", "std", "telemetry"].includes(name)
          ? "std"
          : "pro";
    rows.push({
      service: name,
      runtime: s.runtime || "java",
      pid: 0,
      port: 0,
      deployVer: "",
      startTime: "",
      screen: "",
      jarPath: "",
      processUp: !!s.processUp,
      healthUp: !!s.healthUp,
      ingressOn: !!s.ingressOn,
      ingressUp: !!s.ingressUp,
      status: s.processUp ? (s.healthUp ? "UP" : "UNHEALTHY") : "DOWN",
      group,
    });
  }
  return rows;
});

const stdInstances = computed(() => tableRows.value.filter((r) => r.group === "std"));
const proInstances = computed(() => tableRows.value.filter((r) => r.group === "pro"));
const otherInstances = computed(() => tableRows.value.filter((r) => r.group === "other"));

const instanceSections = computed(() =>
  [
    { key: "std", title: "标准版服务", rows: stdInstances.value },
    { key: "pro", title: "私有化服务", rows: proInstances.value },
    { key: "other", title: "探活服务", rows: otherInstances.value },
  ].filter((s) => s.rows.length > 0)
);
function onInstRowClick(row: agentcli.JavaAppInstance) {
  if (row.service) openCharts(row.service);
}

function openCharts(service: string) {
  if (!service) return;
  if (selected.value === service) {
    chartsOpen.value = true;
    loadDetail();
    return;
  }
  selected.value = service;
  chartsOpen.value = true;
}

function goNginxTab() {
  shutdownOpen.value = false;
  app.setSubTab(props.host, "nginx");
}

function openShutdown(row: agentcli.JavaAppInstance) {
  shutdownTarget.value = row;
  nginxConfirmed.value = false;
  shutdownOpen.value = true;
}

async function confirmShutdown() {
  const t = shutdownTarget.value;
  if (!t || !nginxConfirmed.value) return;
  shutdownLoading.value = true;
  try {
    const r = await api.agentAppShutdown(props.host, {
      service: t.service,
      pid: t.pid,
      port: t.port,
      screen: t.screen,
    });
    ElMessage.success(r.msg || "已发起下架");
    shutdownOpen.value = false;
    setTimeout(() => loadAll(), 1500);
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : String(e));
  } finally {
    shutdownLoading.value = false;
  }
}

async function loadAll() {
  error.value = "";
  try {
    const [st, inst] = await Promise.all([
      api.agentWatchStatus(props.host),
      api.agentWatchInstances(props.host),
    ]);
    status.value = st;
    instances.value = inst;
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

const selectedMeta = computed(() => status.value.find((s) => s.service === selected.value));
const isBun = computed(() => {
  const row = tableRows.value.find((r) => r.service === selected.value);
  if (row?.runtime === "bun") return true;
  return selectedMeta.value?.runtime === "bun";
});

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
    { name: "主机内存", data: hostPts.value.map((p) => p.memUsed || 0) },
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
    const merged = patchWatchNotify(yamlText.value, {
      wecomWebhook: settings.effectiveWecomWebhook(),
    });
    yamlText.value = merged;
    await api.agentPutWatch(props.host, merged);
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
.apps-root {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-height: 0;
}
.apps-page {
  flex: 1;
  min-height: 0;
  overflow: auto;
}
.page-alert {
  margin-bottom: 4px;
}
.svc-tag {
  vertical-align: middle;
}
.rt-tag {
  margin-left: 6px;
  vertical-align: middle;
}
.lamps {
  display: flex;
  gap: 6px;
  flex-wrap: nowrap;
}
.lamp {
  font: var(--m3-label-medium);
  padding: 2px 8px;
  border-radius: var(--m3-shape-full);
  border: 1px solid transparent;
  white-space: nowrap;
  &.on {
    background: var(--m3-primary-container);
    color: var(--m3-primary);
    border-color: color-mix(in srgb, var(--m3-primary) 24%, transparent);
  }
  &.off {
    background: var(--m3-error-container);
    color: var(--m3-error);
    border-color: color-mix(in srgb, var(--m3-error) 24%, transparent);
  }
}
.shutdown-body {
  display: flex;
  flex-direction: column;
  gap: 8px;
  font-size: 13px;
}
.warn {
  margin: 0;
  color: var(--el-color-warning);
  font-size: 12px;
}
.kv {
  display: grid;
  grid-template-columns: 88px 1fr;
  gap: 8px;
  span {
    color: var(--el-text-color-secondary);
  }
  b {
    font-family: ui-monospace, monospace;
    font-size: 12px;
    word-break: break-all;
  }
  &.path b {
    font-size: 11px;
  }
}
.nginx-check {
  margin-top: 8px;
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
