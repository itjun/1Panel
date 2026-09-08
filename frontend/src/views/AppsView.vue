<template>
  <div class="apps-root">
  <div class="apps-page page-panel">
    <el-alert v-if="error" type="error" :title="error" show-icon :closable="false" class="page-alert" />

    <div class="page-toolbar">
      <span class="panel-section-title">应用监视</span>
      <span class="page-toolbar__hint">实例表点行看曲线；通知默认关闭，按行订阅探活告警。下架前请到「Nginx」标签核对切流。</span>
      <div class="page-toolbar__actions">
        <el-button @click="loadAll">刷新</el-button>
        <el-button @click="openCfg">监视配置</el-button>
      </div>
    </div>

    <template v-for="(sec, secIdx) in instanceSections" :key="sec.key">
      <div class="apps-section">
        <div class="m3-table-surface">
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
          :row-class-name="(p) => instRowClass(latestDeployVer, p.row)"
          @row-click="onInstRowClick"
        >
          <el-table-column type="index" label="#" width="48" align="center" />
          <el-table-column prop="service" label="标识" width="148">
            <template #default="{ row }">
              <div class="svc-id-cell">
                <span :class="['svc-id', svcIdClass(row.service)]">{{ row.service }}</span>
                <span v-if="row.runtime === 'bun'" class="rt-badge">Bun</span>
              </div>
            </template>
          </el-table-column>
          <el-table-column prop="port" label="端口" width="72" align="center">
            <template #default="{ row }">
              <span
                v-if="row.port && isLatestDeploy(row.deployVer || '', latestDeployVer)"
                class="latest-highlight"
              >
                {{ row.port }}
              </span>
              <span v-else>{{ row.port || "—" }}</span>
            </template>
          </el-table-column>
          <el-table-column prop="deployVer" label="部署版本" width="110" show-overflow-tooltip>
            <template #default="{ row }">
              <span
                v-if="row.deployVer && isLatestDeploy(row.deployVer, latestDeployVer)"
                class="latest-highlight"
              >
                {{ row.deployVer }}
              </span>
              <span v-else>{{ row.deployVer || "—" }}</span>
            </template>
          </el-table-column>
          <el-table-column prop="startTime" label="启动时间" width="160" show-overflow-tooltip />
          <el-table-column prop="screen" label="screen" width="120" show-overflow-tooltip />
          <el-table-column prop="jarPath" label="路径" min-width="200" show-overflow-tooltip />
          <el-table-column prop="status" label="状态" width="72" align="center">
            <template #default="{ row }">
              <span :class="isOnline(row) ? 'status-online' : 'status-offline'">
                {{ isOnline(row) ? "在线" : "离线" }}
              </span>
            </template>
          </el-table-column>
          <el-table-column label="通知" width="88" align="center">
            <template #default="{ row }">
              <span class="notify-cell" @click.stop>
                <el-switch
                  v-if="canSubscribeNotify(row.service)"
                  size="small"
                  :model-value="
                    settings.isAppNotifySubscribed(host, row.service)
                  "
                  @change="
                    (v: string | number | boolean) =>
                      settings.setAppNotifySubscribed(
                        host,
                        row.service,
                        Boolean(v)
                      )
                  "
                />
                <span v-else class="notify-na">—</span>
              </span>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="80" align="center" fixed="right">
            <template #default="{ row }">
              <span
                v-if="canShutdown(row)"
                class="shutdown-action"
                role="button"
                tabindex="0"
                @click.stop="openShutdown(row)"
                @keydown.enter.stop="openShutdown(row)"
              >
                下架
              </span>
            </template>
          </el-table-column>
        </el-table>
        </div>
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

    <el-dialog v-model="shutdownOpen" title="确认下架" width="480px" append-to-body>
      <div v-if="shutdownTarget" class="shutdown-body">
        <p class="shutdown-tip">将直接终止进程并退出 screen 会话，此操作不可撤销。</p>
        <div class="kv"><span>服务</span><b>{{ shutdownTarget.service }}</b></div>
        <div class="kv"><span>PID</span><b>{{ shutdownTarget.pid || "—" }}</b></div>
        <div class="kv"><span>端口</span><b>{{ shutdownTarget.port || "—" }}</b></div>
        <div class="kv"><span>screen</span><b>{{ shutdownTarget.screen || "—" }}</b></div>
        <div class="kv"><span>部署版本</span><b>{{ shutdownTarget.deployVer || "—" }}</b></div>
      </div>
      <template #footer>
        <el-button @click="shutdownOpen = false">取消</el-button>
        <el-button type="danger" :loading="shutdownLoading" @click="confirmShutdown">
          确认下架
        </el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="cfgOpen" title="下发 watch.yml" width="720px" append-to-body>
      <p class="sec-desc">
        服务清单与探活路径在此编辑。企微总开关 / 地址在「设置 → 通知」；应用探活默认不通知，请在本表「通知」列或本机「通知」页按服务订阅。
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
import {
  isWatchServiceName,
  watchServiceSortKey,
} from "@/utils/watchServices";

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

function canSubscribeNotify(service: string) {
  return isWatchServiceName(service);
}

function canShutdown(row: agentcli.JavaAppInstance) {
  if (!row.screen) return false;
  return (row.pid || 0) > 0 || (row.port || 0) > 0;
}

/** 实例 HTTP 探活 200 → 在线 */
function isOnline(row: agentcli.JavaAppInstance) {
  return !!row.healthUp;
}

/** 已拉起进程（有 pid / 端口 / screen），空占位行不算启动 */
function isAppStarted(row: agentcli.JavaAppInstance) {
  return (row.pid || 0) > 0 || (row.port || 0) > 0 || !!row.processUp || !!(row.screen || "").trim();
}

/** 未启动或离线的实例点行不弹曲线卡 */
function canOpenCharts(row: agentcli.JavaAppInstance) {
  return !!row.service && isAppStarted(row) && isOnline(row);
}

/** 部署版本 YYMMDD_N，先比日期再比序号 */
function compareDeployVer(a: string, b: string): number {
  if (!a && !b) return 0;
  if (!a) return -1;
  if (!b) return 1;
  const [aDate = "", aSeq = "0"] = a.split("_");
  const [bDate = "", bSeq = "0"] = b.split("_");
  if (aDate !== bDate) return aDate.localeCompare(bDate);
  return (parseInt(aSeq, 10) || 0) - (parseInt(bSeq, 10) || 0);
}

function latestDeployVerInRows(rows: agentcli.JavaAppInstance[]): string {
  let latest = "";
  for (const r of rows) {
    const v = (r.deployVer || "").trim();
    if (!v) continue;
    if (!latest || compareDeployVer(v, latest) > 0) latest = v;
  }
  return latest;
}

function isLatestDeploy(deployVer: string, latest: string): boolean {
  if (!deployVer || !latest) return false;
  return deployVer.trim() === latest;
}

function instRowClass(latestDeployVer: string, row: agentcli.JavaAppInstance): string {
  const parts: string[] = [];
  if (isLatestDeploy(row.deployVer || "", latestDeployVer)) parts.push("deploy-latest-row");
  if (!canOpenCharts(row)) parts.push("inst-stopped-row");
  return parts.join(" ");
}

function serviceSortKey(name: string): number {
  return watchServiceSortKey(name);
}

function sortInstances(rows: agentcli.JavaAppInstance[]): agentcli.JavaAppInstance[] {
  return [...rows].sort((a, b) => {
    const sa = serviceSortKey(a.service || "");
    const sb = serviceSortKey(b.service || "");
    if (sa !== sb) return sa - sb;
    return (a.port || 0) - (b.port || 0);
  });
}

function svcIdClass(name: string): string {
  if (!name) return "svc-default";
  const known: Record<string, string> = {
    im: "svc-im",
    oss: "svc-oss",
    csp: "svc-csp",
    std: "svc-std",
    zhetai: "svc-zhetai",
    fpl: "svc-fpl",
    "ai-agent": "svc-ai-agent",
    "sapi-agent": "svc-sapi-agent",
  };
  return known[name] || "svc-default";
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
    return {
      ...r,
      group,
      runtime: r.runtime || st?.runtime || "java",
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
      healthUp: false,
      processUp: false,
      ingressOn: false,
      ingressUp: false,
      status: "DOWN",
      group,
    });
  }
  return rows;
});

const stdInstances = computed(() => sortInstances(tableRows.value.filter((r) => r.group === "std")));
const proInstances = computed(() => sortInstances(tableRows.value.filter((r) => r.group === "pro")));
const otherInstances = computed(() => sortInstances(tableRows.value.filter((r) => r.group === "other")));

/** 整机只取一个最新部署版本（workspace 目录 YYMMDD_N），不按分组各自取 */
const latestDeployVer = computed(() => latestDeployVerInRows(tableRows.value));

const instanceSections = computed(() =>
  [
    { key: "std", title: "标准版服务", rows: stdInstances.value },
    { key: "pro", title: "私有化服务", rows: proInstances.value },
    { key: "other", title: "云组件服务", rows: otherInstances.value },
  ].filter((s) => s.rows.length > 0)
);
function onInstRowClick(row: agentcli.JavaAppInstance) {
  if (!canOpenCharts(row)) return;
  openCharts(row);
}

function openCharts(row: agentcli.JavaAppInstance) {
  if (!canOpenCharts(row)) return;
  const service = row.service;
  if (selected.value === service) {
    chartsOpen.value = true;
    loadDetail();
    return;
  }
  selected.value = service;
  chartsOpen.value = true;
}

function openShutdown(row: agentcli.JavaAppInstance) {
  shutdownTarget.value = row;
  shutdownOpen.value = true;
}

async function confirmShutdown() {
  const t = shutdownTarget.value;
  if (!t) return;
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
      unit: "bytes",
      yAxisIndex: 1,
    },
  ],
  formatStr: "%",
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
:deep(.data-table-unified .el-table__row) {
  cursor: pointer;
}
:deep(.data-table-unified .inst-stopped-row) {
  cursor: default;
}
:deep(.data-table-unified .el-table__cell.is-center .cell) {
  display: flex;
  align-items: center;
  justify-content: center;
}
:deep(.deploy-latest-row > td.el-table__cell) {
  background: var(--m3-primary-container) !important;
}
:deep(.deploy-latest-row > td.el-table__cell:first-child) {
  box-shadow: inset 3px 0 0 var(--m3-primary);
}
:deep(.el-table--enable-row-hover .el-table__body .deploy-latest-row:hover > td.el-table__cell),
:deep(.el-table__body .deploy-latest-row.current-row > td.el-table__cell) {
  background: color-mix(in srgb, var(--m3-primary) 8%, var(--m3-primary-container)) !important;
}
.latest-highlight {
  font-weight: 600;
  color: var(--m3-on-primary-container);
}
.page-alert {
  margin-bottom: 4px;
}
.svc-id-cell {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex-wrap: nowrap;
  white-space: nowrap;
  max-width: 100%;
}
.svc-id {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 13px;
  font-weight: 600;
  line-height: 1.2;
  background: none;
}
.svc-im {
  color: #64b5f6;
}
.svc-oss {
  color: #81c784;
  letter-spacing: 0.02em;
}
.svc-csp {
  color: #ffb74d;
  font-weight: 700;
}
.svc-std {
  color: #ce93d8;
}
.svc-zhetai {
  color: #4db6ac;
  font-style: italic;
}
.svc-fpl {
  color: #e57373;
  letter-spacing: 0.04em;
}
.svc-ai-agent {
  color: #4fc3f7;
  font-weight: 500;
}
.svc-sapi-agent {
  color: #aed581;
  font-weight: 500;
}
.svc-default {
  color: var(--el-text-color-primary);
}
.rt-badge {
  flex-shrink: 0;
  font: var(--m3-label-small);
  color: var(--el-text-color-secondary);
  border: 1px solid var(--m3-outline-variant);
  border-radius: var(--m3-shape-extra-small);
  padding: 0 4px;
  line-height: 16px;
  background: none;
}
.status-online,
.status-offline,
.shutdown-action {
  display: inline-block;
  line-height: 22px;
  font-size: inherit;
  font-weight: 600;
}
.status-online {
  color: #52c41a;
}
.status-offline {
  color: #8c8c8c;
}
.notify-cell {
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.notify-na {
  color: var(--el-text-color-secondary);
}
.shutdown-action {
  cursor: pointer;
  color: #ff4d4f;
  &:hover,
  &:focus-visible {
    color: #ff7875;
  }
}
.shutdown-tip {
  margin: 0 0 8px;
  color: var(--el-text-color-secondary);
  font-size: 13px;
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
.shutdown-body {
  display: flex;
  flex-direction: column;
  gap: 8px;
  font-size: 13px;
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
