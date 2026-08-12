<template>
  <div ref="pageRef" v-loading="loading && !overview" class="overview-page">
    <el-alert v-if="error && !overview" type="error" :title="error" show-icon />
    <template v-if="overview">
      <el-row :gutter="7">
        <!-- 左栏 16 -->
        <el-col :xs="24" :md="16">
          <el-card
            shadow="never"
            class="home-card"
            :class="{ 'is-enlarged': enlargedKey === 'overview' }"
            :style="enlargedKey === 'overview' ? enlargeStyle : undefined"
          >
            <div class="card-header" @dblclick="openEnlarge('overview')">
              <span class="panel-section-title">概览</span>
              <div class="card-actions">
                <el-button link type="primary" :icon="Refresh" @click="refreshAll">
                  刷新
                </el-button>
                <el-button
                  link
                  class="enlarge-btn"
                  :icon="enlargedKey === 'overview' ? Close : FullScreen"
                  :title="enlargedKey === 'overview' ? '退出放大' : '放大'"
                  @click="toggleEnlarge('overview')"
                />
              </div>
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

          <el-card
            shadow="never"
            class="home-card card-interval"
            :class="{ 'is-enlarged': enlargedKey === 'status' }"
            :style="enlargedKey === 'status' ? enlargeStyle : undefined"
          >
            <div class="card-header" @dblclick="openEnlarge('status')">
              <span class="panel-section-title">状态</span>
              <el-button
                link
                class="enlarge-btn"
                :icon="enlargedKey === 'status' ? Close : FullScreen"
                :title="enlargedKey === 'status' ? '退出放大' : '放大'"
                @click="toggleEnlarge('status')"
              />
            </div>
            <el-row :gutter="8">
              <el-col :span="6" align="center">
                <el-popover trigger="hover" placement="bottom" :width="200">
                  <div class="ring-popover">
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
                      height="160px"
                      :option="{ title: '负载', data: loadPercent }"
                    />
                  </template>
                </el-popover>
                <div class="input-help">{{ loadLabel }}</div>
              </el-col>
              <el-col :span="6" align="center">
                <el-popover trigger="hover" placement="bottom" :width="280">
                  <div class="ring-popover">
                    <div class="ring-pop-row">
                      <span class="ring-pop-label">型号</span>
                      <span
                        class="ring-pop-value"
                        :title="overview.cpuModel"
                      >
                        {{ overview.cpuModel || '—' }}
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
                      height="160px"
                      :option="{ title: 'CPU', data: overview.cpuPercent }"
                    />
                  </template>
                </el-popover>
                <div class="input-help">
                  ( {{ overview.cpuPercent.toFixed(2) }} /
                  {{ overview.cpuCount }} ) 核
                </div>
              </el-col>
              <el-col :span="6" align="center">
                <el-popover trigger="hover" placement="bottom" :width="300">
                  <div class="ring-popover">
                    <div class="ring-pop-grid">
                      <div class="ring-pop-col">
                        <div class="ring-pop-title">内存</div>
                        <div class="ring-pop-row">
                          <span>总量</span>
                          <span class="num">{{ formatBytes(overview.memTotal) }}</span>
                        </div>
                        <div class="ring-pop-row">
                          <span>已用</span>
                          <span class="num">{{ formatBytes(overview.memUsed) }}</span>
                        </div>
                        <div class="ring-pop-row">
                          <span>可用</span>
                          <span class="num">{{ formatBytes(overview.memTotal - overview.memUsed) }}</span>
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
                          <span class="num">{{ formatBytes(overview.swapTotal - overview.swapUsed) }}</span>
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
                      height="160px"
                      :option="{ title: '内存', data: overview.memPercent }"
                    />
                  </template>
                </el-popover>
                <div class="input-help">
                  {{ formatBytes(overview.memUsed) }} /
                  {{ formatBytes(overview.memTotal) }}
                </div>
              </el-col>
              <el-col :span="6" align="center">
                <el-popover trigger="hover" placement="bottom" :width="240">
                  <div class="ring-popover">
                    <div class="ring-pop-row">
                      <span>挂载点</span>
                      <span class="num">{{ rootDisk?.mount || '/' }}</span>
                    </div>
                    <div class="ring-pop-row">
                      <span>总量</span>
                      <span class="num">{{ formatBytes(rootDisk?.total || 0) }}</span>
                    </div>
                    <div class="ring-pop-row">
                      <span>已用</span>
                      <span class="num">{{ formatBytes(rootDisk?.used || 0) }}</span>
                    </div>
                    <div class="ring-pop-row">
                      <span>可用</span>
                      <span class="num">{{ formatBytes(rootDisk?.avail || 0) }}</span>
                    </div>
                    <div class="ring-pop-row">
                      <span>使用率</span>
                      <span class="num">{{ (rootDisk?.percent || 0).toFixed(2) }}%</span>
                    </div>
                  </div>
                  <template #reference>
                    <VChartPie
                      height="160px"
                      :option="{
                        title: rootDisk?.mount || '/',
                        data: rootDisk?.percent || 0,
                      }"
                    />
                  </template>
                </el-popover>
                <div class="input-help" v-if="rootDisk">
                  {{ formatBytes(rootDisk.used) }} /
                  {{ formatBytes(rootDisk.total) }}
                </div>
              </el-col>
            </el-row>
          </el-card>

          <el-card
            shadow="never"
            class="home-card card-interval"
            :class="{ 'is-enlarged': enlargedKey === 'monitor' }"
            :style="enlargedKey === 'monitor' ? enlargeStyle : undefined"
          >
            <div class="card-header" @dblclick="openEnlarge('monitor')">
              <div class="card-title-group">
                <span class="panel-section-title">监控</span>
                <el-radio-group v-model="chartMode" size="small">
                  <el-radio-button value="network">流量</el-radio-button>
                  <el-radio-button value="io">磁盘 IO</el-radio-button>
                </el-radio-group>
              </div>
              <el-button
                link
                class="enlarge-btn"
                :icon="enlargedKey === 'monitor' ? Close : FullScreen"
                :title="enlargedKey === 'monitor' ? '退出放大' : '放大'"
                @click="toggleEnlarge('monitor')"
              />
            </div>
            <div v-if="chartMode === 'network'" class="monitor-tags">
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
            <div v-else class="monitor-tags">
              <el-tag type="primary" effect="light">
                读: {{ formatBytes(ioRates.readBps) }}/s
              </el-tag>
              <el-tag type="primary" effect="light">
                写: {{ formatBytes(ioRates.writeBps) }}/s
              </el-tag>
              <el-tag type="warning" effect="light">
                IOPS: {{ ioRates.iops }}/s
              </el-tag>
            </div>
            <VChartLine
              height="280px"
              :option="chartMode === 'network' ? lineOption : ioLineOption"
            />
          </el-card>

          <el-card
            shadow="never"
            class="home-card card-interval"
            :class="{ 'is-enlarged': enlargedKey === 'disks' }"
            :style="enlargedKey === 'disks' ? enlargeStyle : undefined"
          >
            <div class="card-header" @dblclick="openEnlarge('disks')">
              <span class="panel-section-title">磁盘</span>
              <div class="card-actions">
                <el-button link type="primary" @click="loadDisks">刷新</el-button>
                <el-button
                  link
                  class="enlarge-btn"
                  :icon="enlargedKey === 'disks' ? Close : FullScreen"
                  :title="enlargedKey === 'disks' ? '退出放大' : '放大'"
                  @click="toggleEnlarge('disks')"
                />
              </div>
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
          <el-card
            shadow="never"
            class="home-card"
            :class="{ 'is-enlarged': enlargedKey === 'sysinfo' }"
            :style="enlargedKey === 'sysinfo' ? enlargeStyle : undefined"
          >
            <div class="card-header" @dblclick="openEnlarge('sysinfo')">
              <span class="panel-section-title">系统信息</span>
              <el-button
                link
                class="enlarge-btn"
                :icon="enlargedKey === 'sysinfo' ? Close : FullScreen"
                :title="enlargedKey === 'sysinfo' ? '退出放大' : '放大'"
                @click="toggleEnlarge('sysinfo')"
              />
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

          <el-card
            shadow="never"
            class="home-card card-interval"
            :class="{ 'is-enlarged': enlargedKey === 'memo' }"
            :style="enlargedKey === 'memo' ? enlargeStyle : undefined"
          >
            <div class="card-header" @dblclick="openEnlarge('memo')">
              <span class="panel-section-title">备忘录</span>
              <div class="card-actions">
                <el-button
                  link
                  type="primary"
                  :icon="memoEditing ? Check : Edit"
                  @click="toggleMemo"
                >
                  {{ memoEditing ? "保存" : "编辑" }}
                </el-button>
                <el-button
                  link
                  class="enlarge-btn"
                  :icon="enlargedKey === 'memo' ? Close : FullScreen"
                  :title="enlargedKey === 'memo' ? '退出放大' : '放大'"
                  @click="toggleEnlarge('memo')"
                />
              </div>
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
          <el-card
            shadow="never"
            class="home-card card-interval"
            :class="{ 'is-enlarged': enlargedKey === 'java' }"
            :style="enlargedKey === 'java' ? enlargeStyle : undefined"
          >
            <div class="card-header" @dblclick="openEnlarge('java')">
              <span class="panel-section-title">应用</span>
              <div class="card-actions">
                <span class="hint">Java · {{ javaList.length }}</span>
                <el-button
                  link
                  class="enlarge-btn"
                  :icon="enlargedKey === 'java' ? Close : FullScreen"
                  :title="enlargedKey === 'java' ? '退出放大' : '放大'"
                  @click="toggleEnlarge('java')"
                />
              </div>
            </div>
            <div class="app-scroll">
              <div v-if="appsLoading" class="empty-tip">加载中…</div>
              <div v-else-if="!javaList.length" class="empty-tip">暂无 Java 进程</div>
              <div
                v-for="p in javaList"
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
            </div>
          </el-card>

          <el-card
            shadow="never"
            class="home-card card-interval"
            :class="{ 'is-enlarged': enlargedKey === 'docker' }"
            :style="enlargedKey === 'docker' ? enlargeStyle : undefined"
          >
            <div class="card-header" @dblclick="openEnlarge('docker')">
              <span class="panel-section-title">应用</span>
              <div class="card-actions">
                <span class="hint">
                  Docker ·
                  {{ docker?.available ? dockerList.length : "—" }}
                </span>
                <el-button
                  link
                  class="enlarge-btn"
                  :icon="enlargedKey === 'docker' ? Close : FullScreen"
                  :title="enlargedKey === 'docker' ? '退出放大' : '放大'"
                  @click="toggleEnlarge('docker')"
                />
              </div>
            </div>
            <div class="app-scroll">
              <div v-if="appsLoading" class="empty-tip">加载中…</div>
              <div v-else-if="!docker?.available" class="empty-tip">
                未检测到 Docker
              </div>
              <div v-else-if="!dockerList.length" class="empty-tip">
                暂无容器
              </div>
              <div
                v-for="c in dockerList"
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
            </div>
          </el-card>
        </el-col>
      </el-row>
    </template>

    <div
      v-if="enlargedKey"
      class="enlarge-mask"
      :style="enlargeStyle"
      @click="closeEnlarge"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { Check, Close, Edit, FullScreen, Refresh } from "@element-plus/icons-vue";
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

// 监控卡片：流量 / 磁盘 IO 切换
const chartMode = ref<"network" | "io">("network");
const ioTraffic = ref<{ time: string; read: number; write: number }[]>([]);
const ioRates = ref({ readBps: 0, writeBps: 0, iops: 0 });
const lastDisk = ref<{ read: number; write: number; count: number; ts: number } | null>(null);

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

const ioLineOption = computed(() => ({
  xData: ioTraffic.value.map((t) => t.time),
  yData: [
    { name: "读", data: ioTraffic.value.map((t) => t.read) },
    { name: "写", data: ioTraffic.value.map((t) => t.write) },
  ],
  formatStr: "KB/s",
}));

async function loadOverview() {
  try {
    const data = await api.collectOverview(props.host);
    overview.value = data;
    error.value = null;
    pushTraffic(data);
    pushDiskIO(data);
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
  const readKBps = bytesToKBps(read - prev.read, dt);
  const writeKBps = bytesToKBps(write - prev.write, dt);
  ioRates.value = {
    readBps: ((read - prev.read) / dt) * 1000,
    writeBps: ((write - prev.write) / dt) * 1000,
    iops: Math.round(((count - prev.count) / dt) * 1000),
  };
  const time = new Date(now).toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  ioTraffic.value = [...ioTraffic.value, { time, read: readKBps, write: writeKBps }].slice(-100);
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
  ioTraffic.value = [];
  ioRates.value = { readBps: 0, writeBps: 0, iops: 0 };
  lastDisk.value = null;
  loadMemo();
}

// ---------- 卡片放大（铺满主内容区，侧栏/标签栏保留） ----------
const pageRef = ref<HTMLElement | null>(null);
const enlargedKey = ref<string | null>(null);
const enlargeRect = ref({ top: 0, left: 0, width: 0, height: 0 });

const enlargeStyle = computed(() => ({
  top: `${enlargeRect.value.top}px`,
  left: `${enlargeRect.value.left}px`,
  width: `${enlargeRect.value.width}px`,
  height: `${enlargeRect.value.height}px`,
}));

// 取主内容区 .content-pad 的视口坐标，放大卡片据此 fixed 铺满
function updateEnlargeRect() {
  const pad = pageRef.value?.closest(".content-pad") as HTMLElement | null;
  if (!pad) return;
  const r = pad.getBoundingClientRect();
  enlargeRect.value = {
    top: r.top,
    left: r.left,
    width: r.width,
    height: r.height,
  };
}

function openEnlarge(key: string) {
  updateEnlargeRect();
  enlargedKey.value = key;
  // 容器尺寸变化后通知 ECharts resize
  nextTick(() => window.dispatchEvent(new Event("resize")));
}

function closeEnlarge() {
  enlargedKey.value = null;
  nextTick(() => window.dispatchEvent(new Event("resize")));
}

function toggleEnlarge(key: string) {
  if (enlargedKey.value === key) closeEnlarge();
  else openEnlarge(key);
}

function onEnlargeKeydown(e: KeyboardEvent) {
  if (e.key === "Escape" && enlargedKey.value) closeEnlarge();
}

function onEnlargeWinResize() {
  if (enlargedKey.value) updateEnlargeRect();
}

watch(
  () => props.host,
  async () => {
    resetHostState();
    enlargedKey.value = null;
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
  window.addEventListener("keydown", onEnlargeKeydown);
  window.addEventListener("resize", onEnlargeWinResize);
});

onBeforeUnmount(() => {
  if (timer) clearInterval(timer);
  window.removeEventListener("keydown", onEnlargeKeydown);
  window.removeEventListener("resize", onEnlargeWinResize);
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
/* 放大态：卡片提升铺满主内容区，内部列表撑满滚动 */
.home-card.is-enlarged {
  position: fixed;
  z-index: 2001;
  max-width: none;
  overflow: hidden;
  border-radius: 6px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
  :deep(.el-card__body) {
    height: 100%;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
  }
  .app-scroll {
    max-height: none;
    flex: 1 1 auto;
    min-height: 0;
  }
}
.enlarge-mask {
  position: fixed;
  z-index: 2000;
  background: rgba(0, 0, 0, 0.5);
}
.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}
.card-title-group {
  display: flex;
  align-items: center;
  gap: 12px;
}
.card-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
.enlarge-btn {
  color: var(--el-text-color-secondary);
  &:hover {
    color: var(--el-color-primary);
  }
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
.app-scroll {
  max-height: 300px;
  overflow-y: auto;
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

<!-- el-popover 内容 teleport 到 body，scoped 样式无法穿透，故用全局样式 -->
<style lang="scss">
.ring-popover {
  font-size: 12px;
  color: var(--el-text-color-primary);

  .ring-pop-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 3px 0;

    .num {
      font-weight: 600;
      color: var(--el-color-primary);
      white-space: nowrap;
    }
  }

  /* CPU 型号行：标签固定宽，值截断 */
  .ring-pop-label {
    flex-shrink: 0;
    color: var(--el-text-color-secondary);
  }
  .ring-pop-value {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    text-align: right;
  }

  /* 内存两列网格 */
  .ring-pop-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
    gap: 0 20px;
  }
  .ring-pop-title {
    font-weight: 600;
    color: var(--el-color-primary);
    padding: 3px 0;
    margin-bottom: 2px;
    border-bottom: 1px solid var(--el-border-color-lighter);
  }
}
</style>
