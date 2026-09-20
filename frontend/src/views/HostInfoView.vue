<template>
  <div class="host-info">
    <div class="host-info__bar">
      <el-button :disabled="!infoBoard?.isDirty" @click="infoBoard?.reset()">
        恢复默认
      </el-button>
      <el-button :loading="loading" @click="reload">刷新</el-button>
    </div>

    <el-alert
      v-if="needAgent"
      type="warning"
      show-icon
      title="未安装 Agent，无法采集状态"
    >
      <el-button type="primary" link @click="agentInstall.openCheck(host)">
        安装 / 检查 Agent
      </el-button>
    </el-alert>
    <el-alert v-else-if="error" type="error" show-icon :title="error" />

    <div v-if="exceptionLines.length" class="info-alert" role="status">
      <strong>异常</strong>
      <span v-for="line in exceptionLines" :key="line">{{ line }}</span>
    </div>

    <template v-else-if="overview">
    <section class="connection-card panel-hover-card">
      <div class="connection-card__head">
        <div class="connection-card__title-wrap">
          <h3>SSH 通道</h3>
          <span class="connection-card__target">
            {{ hostConfig?.user || "—" }}@{{ hostConfig?.hostName || overview.ipAddress || "—" }}
          </span>
        </div>
        <span class="ssh-channel-status" :class="`is-${sshChannel.tone}`">
          <i class="ssh-channel-status__dot" aria-hidden="true" />
          {{ sshChannel.label }}
        </span>
      </div>
      <div class="connection-card__facts">
        <div>
          <span>账号</span>
          <b>{{ hostConfig?.user || "—" }}</b>
        </div>
        <div>
          <span>地址</span>
          <b>{{ hostConfig?.hostName || overview.ipAddress || "—" }}</b>
        </div>
        <div>
          <span>端口</span>
          <b>{{ hostConfig?.port || "22" }}</b>
        </div>
        <div>
          <span>Agent</span>
          <b>{{ agentSummary }}</b>
        </div>
      </div>
    </section>

    <CardBoard
      ref="infoBoard"
      board-id="host-info"
      :columns="4"
      :defaults="infoBoardDefaults"
    >
      <template #load>
      <section class="card panel-hover-card ring-card">
        <el-popover trigger="hover" placement="bottom" :width="200">
          <div class="ring-popover" :class="{ 'is-danger': loadAlert }">
            <div class="ring-pop-row">
              <span>1 分钟</span>
              <span class="num">{{ overview.load1.toFixed(2) }}</span>
            </div>
            <div class="ring-pop-row">
              <span>5 分钟</span>
              <span class="num">{{ overview.load5.toFixed(2) }}</span>
            </div>
            <div class="ring-pop-row">
              <span>15 分钟</span>
              <span class="num">{{ overview.load15.toFixed(2) }}</span>
            </div>
          </div>
          <template #reference>
            <VChartPie
              height="148px"
              :danger="loadAlert"
              :option="{
                title: '负载',
                data: loadPercent,
                center: overview.load1.toFixed(2),
              }"
            />
          </template>
        </el-popover>
        <div class="ring-help">{{ loadLabel }}</div>
      </section>
      </template>

      <template #cpu>
      <section class="card panel-hover-card ring-card">
        <el-popover trigger="hover" placement="bottom" :width="280">
          <div class="ring-popover" :class="{ 'is-danger': cpuAlert }">
            <div class="ring-pop-row">
              <span class="ring-pop-label">型号</span>
              <span class="ring-pop-value" v-tip="overview.cpuModel || undefined">
                {{ overview.cpuModel || "—" }}
              </span>
            </div>
            <div class="ring-pop-row">
              <span>核心数</span>
              <span class="num">{{ overview.cpuCount }} 核</span>
            </div>
            <div class="ring-pop-row">
              <span>使用率</span>
              <span class="num">{{ overview.cpuPercent.toFixed(2) }}%</span>
            </div>
          </div>
          <template #reference>
            <VChartPie
              height="148px"
              :danger="cpuAlert"
              :option="{ title: 'CPU', data: overview.cpuPercent }"
            />
          </template>
        </el-popover>
        <div class="ring-help">
          ( {{ overview.cpuPercent.toFixed(2) }} / {{ overview.cpuCount }} ) 核
        </div>
      </section>
      </template>

      <template #mem>
      <section class="card panel-hover-card ring-card">
        <el-popover trigger="hover" placement="bottom" :width="300">
          <div class="ring-popover" :class="{ 'is-danger': memAlert }">
            <div class="ring-pop-grid">
              <div class="ring-pop-col">
                <div class="ring-pop-title">内存</div>
                <div class="ring-pop-row">
                  <span>总量</span>
                  <span class="num">{{ formatMemCapacity(overview.memTotal) }}</span>
                </div>
                <div class="ring-pop-row">
                  <span>已用</span>
                  <span class="num">{{ formatBytes(overview.memUsed) }}</span>
                </div>
                <div class="ring-pop-row">
                  <span>可用</span>
                  <span class="num">{{ formatBytes(Math.max(0, overview.memTotal - overview.memUsed)) }}</span>
                </div>
                <div class="ring-pop-row">
                  <span>使用率</span>
                  <span class="num">{{ overview.memPercent.toFixed(2) }}%</span>
                </div>
              </div>
              <div v-if="overview.swapTotal > 0" class="ring-pop-col">
                <div class="ring-pop-title">Swap</div>
                <div class="ring-pop-row">
                  <span>总量</span>
                  <span class="num">{{ formatBytes(overview.swapTotal) }}</span>
                </div>
                <div class="ring-pop-row">
                  <span>已用</span>
                  <span class="num">{{ formatBytes(overview.swapUsed) }}</span>
                </div>
                <div class="ring-pop-row">
                  <span>可用</span>
                  <span class="num">{{ formatBytes(Math.max(0, overview.swapTotal - overview.swapUsed)) }}</span>
                </div>
                <div class="ring-pop-row">
                  <span>使用率</span>
                  <span class="num">{{ overview.swapPercent.toFixed(2) }}%</span>
                </div>
              </div>
            </div>
          </div>
          <template #reference>
            <VChartPie
              height="148px"
              :danger="memAlert"
              :option="{ title: '内存', data: overview.memPercent }"
            />
          </template>
        </el-popover>
        <div class="ring-help">
          {{ formatBytes(overview.memUsed) }} / {{ formatMemCapacity(overview.memTotal) }}
        </div>
      </section>
      </template>

      <template #disk>
      <section class="card panel-hover-card ring-card">
        <el-popover trigger="hover" placement="bottom" :width="240">
          <div class="ring-popover" :class="{ 'is-danger': diskLow }">
            <div class="ring-pop-row">
              <span>范围</span>
              <span class="num">
                全部 {{ diskSummary?.count || 0 }}
                {{ diskSummary?.scope === "disk" ? " 块磁盘" : " 分区" }}
              </span>
            </div>
            <div class="ring-pop-row">
              <span>总量</span>
              <span class="num">{{ formatBytes(diskSummary?.total || 0) }}</span>
            </div>
            <div class="ring-pop-row">
              <span>已用</span>
              <span class="num">{{ formatBytes(diskSummary?.used || 0) }}</span>
            </div>
            <div class="ring-pop-row">
              <span>可用</span>
              <span class="num">{{ formatBytes(diskSummary?.avail || 0) }}</span>
            </div>
            <div class="ring-pop-row">
              <span>使用率</span>
              <span class="num">{{ (diskSummary?.percent || 0).toFixed(2) }}%</span>
            </div>
          </div>
          <template #reference>
            <VChartPie
              height="148px"
              :danger="diskLow"
              :option="{ title: '磁盘', data: diskSummary?.percent || 0 }"
            />
          </template>
        </el-popover>
        <div class="ring-help" :class="{ 'is-danger': diskLow }" v-if="diskSummary">
          {{ formatBytes(diskSummary.used) }} / {{ formatBytes(diskSummary.total) }}
        </div>
        <div v-else class="ring-help">暂无磁盘数据</div>
      </section>
      </template>

      <template #system>
      <section class="card panel-hover-card">
        <header class="card__head">
          <h3>系统</h3>
        </header>
        <div class="facts">
          <div class="fact">
            <span>主机名</span>
            <b>{{ overview.hostname || "—" }}</b>
          </div>
          <div class="fact">
            <span>系统</span>
            <b>{{ overview.osRelease || "—" }}</b>
          </div>
          <div class="fact">
            <span>内核</span>
            <b>{{ overview.kernel || "—" }}</b>
          </div>
          <div class="fact">
            <span>地址</span>
            <b>{{ overview.ipAddress || "—" }}</b>
          </div>
          <div class="fact">
            <span>运行时间</span>
            <b>{{ formatDurationLong(overview.uptime) }}</b>
          </div>
        </div>
      </section>
      </template>

      <template #hardware>
      <section class="card panel-hover-card">
        <header class="card__head">
          <h3>硬件</h3>
        </header>
        <div class="facts">
          <div class="fact">
            <span>CPU</span>
            <b>{{ overview.cpuModel || "—" }} × {{ overview.cpuCount || "—" }} 核</b>
          </div>
          <div class="fact">
            <span>架构</span>
            <b>{{ overview.arch || "—" }}</b>
          </div>
        </div>
      </section>
      </template>

      <template #volumes>
      <section class="card panel-hover-card">
        <header class="card__head">
          <h3>磁盘</h3>
          <span class="card__meta">{{ disks.length }} 项</span>
        </header>
        <el-empty v-if="disks.length === 0" description="无分区数据" :image-size="48" />
        <div v-else class="stack">
          <div v-for="d in disks" :key="d.mount + d.filesystem" class="stack-row">
            <div class="stack-row__top">
              <b>{{ d.mount || d.filesystem }}</b>
              <span class="muted">{{ d.fsType || d.filesystem }}</span>
              <span class="stack-row__end" :class="{ 'is-danger': diskRowLow(d) }">
                {{ d.percent.toFixed(0) }}%
              </span>
            </div>
            <el-progress
              :percentage="Math.min(100, Math.max(0, d.percent || 0))"
              :stroke-width="8"
              :show-text="false"
              :status="diskRowLow(d) ? 'exception' : undefined"
            />
            <div class="stack-row__foot">可用 {{ formatBytes(d.avail) }}</div>
          </div>
        </div>
      </section>
      </template>

      <template #network>
      <section class="card panel-hover-card">
        <header class="card__head">
          <h3>网络</h3>
          <span class="card__meta">{{ ifaces.length }} 块网卡</span>
        </header>
        <div class="facts">
          <div class="fact">
            <span>内网</span>
            <b>{{ privateLine }}</b>
          </div>
          <div class="fact">
            <span>公网</span>
            <b>{{ publicLine }}</b>
          </div>
        </div>
        <div v-if="ifaces.length" class="stack stack--after">
          <div v-for="n in ifaces" :key="n.name" class="iface">
            <b>{{ n.name }}</b>
            <span class="state" :class="ifaceTone(n.state)">{{ n.state || "—" }}</span>
            <span class="muted">{{ (n.ipv4 || []).join(", ") || "—" }}</span>
          </div>
        </div>
      </section>
      </template>

      <template #listen>
      <section class="card panel-hover-card">
        <header class="card__head">
          <h3>监听</h3>
          <div class="card__side">
            <span class="card__meta">{{ listens.length }} 个端口</span>
            <button
              v-if="listens.length > LISTEN_PREVIEW"
              type="button"
              class="text-btn"
              @click="listenOpen = !listenOpen"
            >
              {{ listenOpen ? "收起" : "展开" }}
            </button>
          </div>
        </header>
        <div v-if="listens.length === 0" class="empty-line">无监听数据</div>
        <div v-else class="stack">
          <div v-for="(c, i) in shownListens" :key="i" class="listen">
            <span class="mono">{{ c.localAddr }}</span>
            <b>{{ c.process || "—" }}</b>
          </div>
          <p v-if="!listenOpen && listens.length > LISTEN_PREVIEW" class="listen-more">
            还有 {{ listens.length - LISTEN_PREVIEW }} 项
          </p>
          <p v-else-if="listenOpen && listens.length > LISTEN_CAP" class="listen-more">
            只列出前 {{ LISTEN_CAP }} 项
          </p>
        </div>
      </section>
      </template>
    </CardBoard>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { api } from "@/api";
import type { agentcli, monitor } from "@/api";
import { useAppStore } from "@/stores/app";
import { useAgentInstallStore } from "@/stores/agentInstall";
import {
  formatBytes,
  formatDurationLong,
  formatErr,
  formatMemCapacity,
  isAgentMissing,
} from "@/utils/format";
import {
  isCpuAlert,
  isDiskLow,
  isLoadAlert,
  isMemAlert,
  summarizeDisks,
} from "@/utils/alerts";
import type { BoardSlot } from "@/utils/cardBoard";

const infoBoardDefaults: BoardSlot[] = [
  { id: "load", span: 1, label: "负载" },
  { id: "cpu", span: 1, label: "CPU" },
  { id: "mem", span: 1, label: "内存" },
  { id: "disk", span: 1, label: "磁盘" },
  { id: "system", span: 2, label: "系统" },
  { id: "hardware", span: 2, label: "硬件" },
  { id: "volumes", span: 4, label: "分区" },
  { id: "network", span: 2, label: "网络" },
  { id: "listen", span: 2, label: "监听" },
];

const infoBoard = ref<{ reset: () => void; isDirty: boolean } | null>(null);

const props = defineProps<{ host: string }>();
const app = useAppStore();
const agentInstall = useAgentInstallStore();

const loading = ref(false);
const error = ref("");
const needAgent = ref(false);
const overview = ref<monitor.Overview | null>(null);
const disks = ref<monitor.DiskInfo[]>([]);
const network = ref<monitor.NetworkSnapshot | null>(null);
const agentInfo = ref<agentcli.Status | null>(null);

const hostConfig = computed(
  () => app.hosts.find((item) => item.name === props.host) || null
);

const sshChannel = computed(() => {
  if (!agentInfo.value) return { label: "检测中", tone: "pending" };
  if (agentInfo.value.ok || agentInfo.value.notInstalled) {
    return { label: "SSH 通", tone: "ok" };
  }
  return { label: "连接异常", tone: "warn" };
});

const agentSummary = computed(() => {
  if (!agentInfo.value) return "检测中";
  if (agentInfo.value.ok) {
    return agentInfo.value.version ? `在线 · ${agentInfo.value.version}` : "在线";
  }
  if (agentInfo.value.notInstalled) return "未安装";
  return "不可用";
});

const diskSummary = computed(() => summarizeDisks(disks.value));
const diskLow = computed(() => isDiskLow(disks.value));
const cpuAlert = computed(() => isCpuAlert(overview.value));
const memAlert = computed(() => isMemAlert(overview.value));
const loadAlert = computed(() => isLoadAlert(overview.value));

const loadPercent = computed(() => {
  if (!overview.value?.cpuCount) return 0;
  return (overview.value.load1 / overview.value.cpuCount) * 100;
});

const loadLabel = computed(() => {
  const ov = overview.value;
  if (!ov) return "";
  const v = loadPercent.value;
  let word = "运行流畅";
  if (v >= 80) word = "运行堵塞";
  else if (v >= 70) word = "运行缓慢";
  else if (v >= 30) word = "运行正常";
  return `${ov.load1.toFixed(2)} / ${ov.cpuCount || 0} 核 · ${word}`;
});

const exceptionLines = computed(() => {
  const ov = overview.value;
  if (!ov) return [] as string[];
  const lines: string[] = [];
  if (loadAlert.value) {
    lines.push(`负载 ${ov.load1.toFixed(2)} / ${ov.cpuCount || 0} 核`);
  }
  if (cpuAlert.value) lines.push(`CPU ${ov.cpuPercent.toFixed(0)}%`);
  if (memAlert.value) lines.push(`内存 ${ov.memPercent.toFixed(0)}%`);
  if (diskLow.value) lines.push("磁盘空间偏低");
  return lines;
});

const privateLine = computed(() => {
  const ips = network.value?.privateIPs || [];
  if (!ips.length) return "—";
  return ips.join(", ");
});

const publicLine = computed(() => {
  const snap = network.value;
  if (!snap) return "—";
  if (snap.egressPublicIP) return snap.egressPublicIP;
  const ips = snap.publicIPs || [];
  if (!ips.length) return "—";
  return ips.join(", ");
});

const ifaces = computed(() =>
  (network.value?.interfaces || []).filter((n) => n.kind !== "loopback")
);
const LISTEN_PREVIEW = 4;
const LISTEN_CAP = 40;
const listenOpen = ref(false);
watch(
  () => props.host,
  () => {
    listenOpen.value = false;
  }
);
const listens = computed(() =>
  (network.value?.connections || []).filter((c) => (c.state || "").toUpperCase() === "LISTEN")
);
const shownListens = computed(() => {
  const all = listens.value;
  if (!listenOpen.value) return all.slice(0, LISTEN_PREVIEW);
  return all.slice(0, LISTEN_CAP);
});

function diskRowLow(d: monitor.DiskInfo): boolean {
  return isDiskLow([d]);
}

function ifaceTone(state: string): string {
  const s = (state || "").toUpperCase();
  if (s === "UP") return "is-up";
  if (s === "DOWN") return "is-down";
  return "";
}

let timer: ReturnType<typeof setInterval> | null = null;

async function reload() {
  if (!app.isHostSubActive(props.host, "overview")) return;
  loading.value = true;
  error.value = "";
  needAgent.value = false;
  try {
    overview.value = await api.collectOverview(props.host);
    if (overview.value?.osRelease) {
      app.rememberOsRelease(props.host, overview.value.osRelease);
    }
  } catch (e) {
    overview.value = null;
    if (isAgentMissing(e)) {
      needAgent.value = true;
    } else {
      error.value = formatErr(e);
    }
    loading.value = false;
    return;
  }
  try {
    disks.value = (await api.collectDisks(props.host)) || [];
  } catch {
    disks.value = [];
  }
  try {
    network.value = await api.collectNetwork(props.host);
  } catch {
    network.value = null;
  }
  loading.value = false;
}

function startPoll() {
  stopPoll();
  void reload();
  timer = window.setInterval(() => {
    void reload();
  }, 8000);
}

function stopPoll() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

async function loadAgentStatus() {
  try {
    agentInfo.value = await api.agentStatus(props.host);
  } catch {
    agentInfo.value = null;
  }
}

watch(
  () => [props.host, app.isHostSubActive(props.host, "overview")] as const,
  ([, vis]) => {
    if (vis) {
      startPoll();
      void loadAgentStatus();
    } else {
      stopPoll();
    }
  },
  { immediate: true }
);

watch(
  () => props.host,
  () => {
    agentInfo.value = null;
  }
);

onBeforeUnmount(stopPoll);
</script>

<style scoped lang="scss">
.host-info {
  height: 100%;
  overflow: auto;
  box-sizing: border-box;
  padding: 12px 12px 24px;
  background: var(--m3-content);
}

/* 概览页采用扁平卡片：保留内描边，不让内容卡片向画布外投影。 */
.host-info :deep(.panel-hover-card) {
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--m3-outline-variant) 70%, transparent) !important;
}

.host-info :deep(.panel-hover-card:hover) {
  box-shadow: inset 0 0 0 2px var(--m3-primary) !important;
}

.host-info :deep(.panel-hover-card:focus-within),
.host-info :deep(.panel-hover-card.is-selected),
.host-info :deep(.panel-hover-card.is-dragging),
.host-info :deep(.panel-hover-card.is-resizing) {
  box-shadow: inset 0 0 0 2px var(--m3-primary) !important;
}

.host-info__bar {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 6px;
  height: 40px;
  min-height: 40px;
  margin: -12px -12px 8px;
  padding: 4px 12px;
  border-bottom: 1px solid var(--m3-outline-variant);
  box-sizing: border-box;

  :deep(.el-button) {
    min-height: 30px;
    padding: 4px 12px;
  }
}

@media (max-width: 520px) {
  .host-info__bar {
    gap: 4px;
    padding-inline: 8px;

    :deep(.el-button) {
      padding-inline: 10px;
    }
  }
}

.connection-card {
  margin-bottom: 12px;
  padding: 14px 16px;
  box-sizing: border-box;
}

.connection-card__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  min-width: 0;
}

.connection-card__title-wrap {
  display: flex;
  align-items: baseline;
  gap: 10px;
  min-width: 0;
}

.connection-card h3 {
  margin: 0;
  flex-shrink: 0;
  font: var(--m3-title-small);
  font-weight: 650;
  color: var(--m3-on-surface);
}

.connection-card__target {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--m3-on-surface-variant);
  font: var(--m3-body-small);
  font-family: var(--m3-font-mono);
}

.connection-card__facts {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 16px;
  margin-top: 12px;
  padding-top: 10px;
  border-top: 1px solid color-mix(in srgb, var(--m3-outline-variant) 75%, transparent);

  > div {
    display: grid;
    gap: 3px;
    min-width: 0;
  }

  span {
    color: var(--m3-on-surface-variant);
    font: var(--m3-body-small);
  }

  b {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font: var(--m3-body-medium);
    font-weight: 600;
  }
}

.ssh-channel-status {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
  font: var(--m3-label-medium);
  color: var(--m3-on-surface-variant);
}

.ssh-channel-status__dot {
  width: 8px;
  height: 8px;
  flex: 0 0 auto;
  border-radius: 50%;
  background: var(--m3-outline);
}

.ssh-channel-status.is-ok {
  color: var(--m3-status-online);

  .ssh-channel-status__dot {
    background: var(--m3-status-online);
  }
}

.ssh-channel-status.is-warn {
  color: var(--m3-status-warn);

  .ssh-channel-status__dot {
    background: var(--m3-status-warn);
  }
}

@media (max-width: 720px) {
  .connection-card__head {
    align-items: flex-start;
    flex-direction: column;
    gap: 8px;
  }

  .connection-card__facts {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px;
  }
}

.info-alert {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 12px;
  margin-bottom: 12px;
  padding: 8px 12px;
  border: 1px solid color-mix(in srgb, var(--m3-status-alert) 35%, white);
  border-radius: var(--m3-shape-s);
  background: var(--m3-error-container);
  color: var(--m3-on-error-container);
  font: var(--m3-body-small);

  strong {
    font: var(--m3-label-large);
  }
}

.card {
  min-width: 0;
  padding: 16px;
  box-sizing: border-box;
}

.card__head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 4px;

  h3 {
    margin: 0;
    font: var(--m3-title-small);
    font-weight: 650;
    color: var(--m3-on-surface);
  }
}

.card__meta {
  font: var(--m3-body-small);
  color: var(--m3-on-surface-variant);
}

.card__side {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.ring-card {
  padding: 8px 8px 14px;
  text-align: center;
}

.ring-help {
  font: var(--m3-body-small);
  color: var(--m3-on-surface-variant);
  margin-top: 2px;

  &.is-danger {
    color: var(--m3-error);
  }
}

.ring-popover {
  font: var(--m3-body-small);
  color: var(--m3-on-surface);

  .ring-pop-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 4px 0;

    .num {
      font-weight: 600;
      color: var(--m3-primary);
      white-space: nowrap;
    }
  }

  &.is-danger .num {
    color: var(--m3-error);
  }

  .ring-pop-label {
    flex-shrink: 0;
    color: var(--m3-on-surface-variant);
  }

  .ring-pop-value {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    text-align: right;
  }

  .ring-pop-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
    gap: 0 20px;
  }

  .ring-pop-title {
    font: var(--m3-title-small);
    font-weight: 600;
    color: var(--m3-primary);
    padding: 4px 0;
    margin-bottom: 2px;
    border-bottom: 1px solid var(--m3-outline-variant);
  }
}

.facts {
  display: flex;
  flex-direction: column;
}

.fact {
  display: grid;
  grid-template-columns: 72px minmax(0, 1fr);
  gap: 12px;
  align-items: baseline;
  padding: 9px 0;
  border-top: 1px solid color-mix(in srgb, var(--m3-outline-variant) 75%, transparent);

  &:first-child {
    border-top: 0;
    padding-top: 6px;
  }

  span {
    color: var(--m3-on-surface-variant);
    font: var(--m3-body-small);
  }

  b {
    min-width: 0;
    font-weight: 550;
    overflow-wrap: anywhere;
  }
}

.stack {
  display: flex;
  flex-direction: column;
}

.stack--after {
  margin-top: 8px;
  padding-top: 4px;
  border-top: 1px solid color-mix(in srgb, var(--m3-outline-variant) 75%, transparent);
}

.stack-row {
  padding: 12px 0;
  border-top: 1px solid color-mix(in srgb, var(--m3-outline-variant) 75%, transparent);

  &:first-child {
    border-top: 0;
    padding-top: 8px;
  }
}

.stack-row__top,
.iface,
.listen {
  display: flex;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
}

.stack-row__top {
  margin-bottom: 8px;

  b {
    font-weight: 650;
  }
}

.stack-row__end {
  margin-left: auto;
  font-variant-numeric: tabular-nums;
  font-weight: 600;

  &.is-danger {
    color: var(--m3-error);
  }
}

.stack-row__foot {
  margin-top: 6px;
  font: var(--m3-body-small);
  color: var(--m3-on-surface-variant);
}

.iface,
.listen {
  padding: 8px 0;
  border-top: 1px solid color-mix(in srgb, var(--m3-outline-variant) 75%, transparent);

  &:first-child {
    border-top: 0;
  }

  b {
    font-weight: 600;
  }
}

.listen b {
  margin-left: auto;
}

.text-btn {
  appearance: none;
  height: var(--m3-button-height-small);
  padding: 0 8px;
  border: 0;
  border-radius: var(--m3-shape-s);
  background: transparent;
  color: var(--m3-primary);
  font: var(--m3-label-medium);
  cursor: pointer;

  &:hover {
    background: var(--m3-primary-container);
  }

  &:focus-visible {
    outline: var(--m3-focus-ring);
    outline-offset: 1px;
  }
}

.listen-more {
  margin: 4px 0 0;
  font: var(--m3-body-small);
  color: var(--m3-on-surface-variant);
}

.state {
  flex-shrink: 0;
  padding: 1px 8px;
  border-radius: var(--m3-shape-full);
  font: var(--m3-body-small);
  color: var(--m3-on-surface-variant);
  background: var(--m3-surface-container);

  &.is-up {
    color: var(--m3-status-online);
    background: color-mix(in srgb, var(--m3-status-online) 12%, white);
  }

  &.is-down {
    color: var(--m3-on-surface-variant);
    background: var(--m3-surface-container-high);
  }
}

.iface .muted {
  margin-left: auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mono {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 12px;
}

.empty-line,
.muted {
  color: var(--m3-on-surface-variant);
  font-size: 13px;
}

.empty-line {
  padding: 12px 0 4px;
}
</style>
