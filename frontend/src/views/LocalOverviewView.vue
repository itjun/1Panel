<template>
  <div class="local-overview">
    <PageSkeleton v-if="loading && !overview" variant="status" />
    <el-alert
      v-else-if="error && !overview"
      type="error"
      :title="error"
      show-icon
      :closable="false"
    />

    <template v-else-if="overview">
      <el-row :gutter="12">
        <!-- 状态 + CPU/内存曲线（系统信息已迁至独立侧栏页） -->
        <el-col :span="24">
          <el-card shadow="never" class="home-card panel-hover-card">
            <div class="card-header">
              <span class="panel-section-title">状态</span>
            </div>
            <el-row :gutter="8">
              <el-col :span="4" align="center">
                <el-popover trigger="hover" placement="bottom" :width="200">
                  <div class="ring-popover" :class="{ 'is-danger': loadPercent > 80 }">
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
                      height="140px"
                      :danger="loadPercent > 80"
                      :option="{ title: '负载', data: loadPercent }"
                    />
                  </template>
                </el-popover>
                <div class="input-help">{{ loadLabel }}</div>
              </el-col>
              <el-col :span="5" align="center">
                <el-popover trigger="hover" placement="bottom" :width="440">
                  <div
                    class="ring-popover"
                    :class="{ 'is-danger': overview.cpuPercent > 85 }"
                  >
                    <div class="ring-pop-row">
                      <span class="ring-pop-label">型号</span>
                      <span class="ring-pop-value" :title="overview.cpuModel">
                        {{ overview.cpuModel || "—" }}
                      </span>
                    </div>
                    <div class="ring-pop-row">
                      <span>总核心</span>
                      <span class="num">{{ overview.cpuCount }} 核</span>
                    </div>
                    <div class="ring-pop-row">
                      <span>使用率</span>
                      <span class="num">{{ overview.cpuPercent.toFixed(2) }}%</span>
                    </div>
                    <LocalCpuCoresCard
                      embedded
                      :cores="overview.cpuCores"
                      :perf-percent="overview.perfCpuPercent"
                      :eff-percent="overview.effCpuPercent"
                      :perf-cores="overview.perfCores"
                      :eff-cores="overview.effCores"
                    />
                  </div>
                  <template #reference>
                    <VChartPie
                      height="140px"
                      :danger="overview.cpuPercent > 85"
                      :option="{ title: 'CPU', data: overview.cpuPercent }"
                    />
                  </template>
                </el-popover>
                <div class="input-help">
                  <template v-if="overview.perfCores > 0 || overview.effCores > 0">
                    <div>
                      性能 {{ overview.perfCores || 0 }} · 能效
                      {{ overview.effCores || 0 }} · 共 {{ overview.cpuCount }} 核
                    </div>
                    <div>
                      全核心 {{ overview.cpuPercent.toFixed(1) }}% · 性能
                      {{ overview.perfCpuPercent.toFixed(1) }}% · 能效
                      {{ overview.effCpuPercent.toFixed(1) }}%
                    </div>
                  </template>
                  <template v-else>
                    {{ overview.cpuPercent.toFixed(1) }}% / {{ overview.cpuCount }} 核
                  </template>
                </div>
              </el-col>
              <el-col :span="5" align="center">
                <el-popover
                  trigger="hover"
                  placement="bottom"
                  :width="overview.swapTotal > 0 ? 300 : 240"
                >
                  <div
                    class="ring-popover"
                    :class="{ 'is-danger': overview.memPercent > 90 }"
                  >
                    <div class="ring-pop-grid">
                      <div class="ring-pop-col">
                        <div class="ring-pop-title">物理内存</div>
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
                          <span class="num">{{
                            formatBytes(overview.memTotal - overview.memUsed)
                          }}</span>
                        </div>
                        <div class="ring-pop-row">
                          <span>使用率</span>
                          <span class="num">{{ overview.memPercent.toFixed(2) }}%</span>
                        </div>
                      </div>
                      <div v-if="overview.swapTotal > 0" class="ring-pop-col">
                        <div class="ring-pop-title">交换内存</div>
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
                          <span class="num">{{
                            formatBytes(overview.swapTotal - overview.swapUsed)
                          }}</span>
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
                      height="140px"
                      :danger="overview.memPercent > 90"
                      :option="{ title: '内存', data: overview.memPercent }"
                    />
                  </template>
                </el-popover>
                <div class="input-help">
                  <div>
                    物理 {{ formatBytes(overview.memUsed) }} /
                    {{ formatMemCapacity(overview.memTotal) }}
                  </div>
                  <div v-if="overview.swapTotal > 0">
                    交换 {{ formatBytes(overview.swapUsed) }} /
                    {{ formatBytes(overview.swapTotal) }}
                    <span class="muted"> · {{ overview.swapPercent.toFixed(0) }}%</span>
                  </div>
                  <div v-else>交换 未启用</div>
                </div>
              </el-col>
              <el-col :span="5" align="center">
                <el-popover trigger="hover" placement="bottom" :width="240">
                  <div class="ring-popover" :class="{ 'is-danger': diskPercent > 90 }">
                    <div class="ring-pop-row">
                      <span>范围</span>
                      <span class="num">
                        全部 {{ diskSummary?.count || 0 }}
                        {{ diskSummary?.scope === "disk" ? " 块磁盘" : " 分区" }}
                      </span>
                    </div>
                    <div class="ring-pop-row">
                      <span>总量</span>
                      <span class="num">{{ formatBytesSI(diskTotal) }}</span>
                    </div>
                    <div class="ring-pop-row">
                      <span>已用</span>
                      <span class="num">{{ formatBytesSI(diskUsed) }}</span>
                    </div>
                    <div class="ring-pop-row">
                      <span>可用</span>
                      <span class="num">{{ formatBytesSI(diskFree) }}</span>
                    </div>
                    <div class="ring-pop-row">
                      <span>使用率</span>
                      <span class="num">{{ diskPercent.toFixed(2) }}%</span>
                    </div>
                  </div>
                  <template #reference>
                    <VChartPie
                      height="140px"
                      :danger="diskPercent > 90"
                      :option="{ title: '磁盘', data: diskPercent }"
                    />
                  </template>
                </el-popover>
                <div class="input-help" :class="{ 'is-danger': diskPercent > 90 }">
                  {{ formatBytesSI(diskUsed) }} / {{ formatBytesSI(diskTotal) }}
                </div>
              </el-col>
              <el-col :span="5" align="center">
                <el-popover trigger="hover" placement="bottom" :width="220">
                  <div class="ring-popover" :class="{ 'is-danger': tempDanger }">
                    <div class="ring-pop-row">
                      <span>综合</span>
                      <span class="num">{{ tempLabel }}</span>
                    </div>
                    <div class="ring-pop-row">
                      <span>CPU</span>
                      <span class="num">{{ formatTemp(overview.cpuTempC) }}</span>
                    </div>
                    <div class="ring-pop-row">
                      <span>GPU</span>
                      <span class="num">{{ formatTemp(overview.gpuTempC) }}</span>
                    </div>
                  </div>
                  <template #reference>
                    <VChartPie
                      height="140px"
                      :danger="tempDanger"
                      :option="{ title: '温度', data: tempRingPercent }"
                    />
                  </template>
                </el-popover>
                <div class="input-help" :class="{ 'is-danger': tempDanger }">
                  {{ tempLabel }}
                </div>
              </el-col>
            </el-row>
          </el-card>

          <!-- 磁盘挂载：紧挨状态 -->
          <el-card shadow="never" class="home-card panel-hover-card card-interval">
            <div class="card-header">
              <span class="panel-section-title">磁盘</span>
              <el-button link type="primary" @click="app.setLocalSection('storage')">
                查看占用
              </el-button>
            </div>
            <div v-if="!mountDisks.length" class="muted">无磁盘数据</div>
            <div v-for="d in mountDisks" :key="d.mount" class="disk-row">
              <div class="disk-head">
                <span class="disk-mount">{{ d.mount }}</span>
                <span class="mono muted"
                  >{{ formatBytesSI(d.used) }} / {{ formatBytesSI(d.total) }}</span
                >
              </div>
              <el-progress
                :percentage="diskMountPercent(d)"
                :stroke-width="8"
                :status="diskMountPercent(d) > 90 ? 'exception' : undefined"
              />
            </div>
          </el-card>
        </el-col>
      </el-row>

      <!-- CPU / 内存曲线 -->
      <div class="metrics-grid metrics-grid--pair card-interval">
        <EnlargableCard
          v-for="card in cpuMemCards"
          :key="card.title"
          bare
          enlargeable
          :title="card.title"
          class="metrics-cell"
        >
          <el-card shadow="never" class="home-card panel-hover-card metrics-card">
            <div class="card-header enl-head-zone">
              <span class="panel-section-title">{{ card.title }}</span>
              <div v-if="card.tags.length" class="monitor-tags">
                <el-tag
                  v-for="(tag, i) in card.tags"
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
              <VChartLine
                height="100%"
                :option="card.option"
                :connect-group="connectGroup"
                zoomable
              />
            </div>
          </el-card>
        </EnlargableCard>
      </div>

      <div class="metrics-grid metrics-grid--io card-interval">
        <EnlargableCard
          :key="ioCard.title"
          bare
          enlargeable
          :title="ioCard.title"
          class="metrics-cell metrics-cell--wide"
        >
          <el-card shadow="never" class="home-card panel-hover-card metrics-card">
            <div class="card-header enl-head-zone">
              <span class="panel-section-title">{{ ioCard.title }}</span>
              <div v-if="ioCard.tags.length" class="monitor-tags">
                <el-tag
                  v-for="(tag, i) in ioCard.tags"
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
              <VChartLine
                height="100%"
                :option="ioCard.option"
                :connect-group="connectGroup"
                zoomable
              />
            </div>
          </el-card>
        </EnlargableCard>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { storeToRefs } from "pinia";
import type { localsys } from "@/api";
import VChartPie from "@/components/VChartPie.vue";
import VChartLine, { type LineOption } from "@/components/VChartLine.vue";
import EnlargableCard from "@/components/EnlargableCard.vue";
import LocalCpuCoresCard from "@/components/LocalCpuCoresCard.vue";
import PageSkeleton from "@/components/PageSkeleton.vue";
import { useAppStore } from "@/stores/app";
import { useLocalMetricsStore } from "@/stores/localMetrics";
import {
  formatBytes,
  formatBytesSI,
  formatMemCapacity,
} from "@/utils/format";

const app = useAppStore();
const metrics = useLocalMetricsStore();
const {
  overview,
  error,
  loading,
  cpuSeries,
  memSeries,
  ioSeries,
  ioRates,
  memTotalBytes,
  hasCpuClusters,
} = storeToRefs(metrics);

const connectGroup = "local-overview-metrics";

const loadPercent = computed(() => {
  const o = overview.value;
  if (!o?.cpuCount) return 0;
  return (o.load1 / o.cpuCount) * 100;
});

const loadLabel = computed(() => {
  const v = loadPercent.value;
  if (v < 30) return "运行流畅";
  if (v < 70) return "运行正常";
  if (v < 80) return "运行缓慢";
  return "运行堵塞";
});

/** 磁盘环图：优先按 APFS 容器（kind=disk）汇总，避免多卷重复累计 */
const diskSummary = computed(() => {
  const all = overview.value?.disks || [];
  const physical = all.filter((d) => d.kind === "disk" && (d.total || 0) > 0);
  const list = physical.length ? physical : all.filter((d) => d.kind !== "disk");
  if (!list.length) return null;
  const byKey = new Map<string, localsys.DiskInfo>();
  for (const d of list) {
    const key = d.filesystem || d.device || d.mount || "";
    const prev = byKey.get(key);
    if (!prev || (d.total || 0) > (prev.total || 0)) {
      byKey.set(key, d);
    }
  }
  let total = 0;
  let used = 0;
  let avail = 0;
  for (const d of byKey.values()) {
    total += d.total || 0;
    used += d.used || 0;
    avail += d.avail || d.free || 0;
  }
  if (total <= 0) return null;
  return {
    total,
    used,
    avail,
    percent: (used / total) * 100,
    count: byKey.size,
    scope: physical.length ? ("disk" as const) : ("mount" as const),
  };
});

const mountDisks = computed(() =>
  (overview.value?.disks || []).filter((d) => d.kind !== "disk")
);

function diskMountPercent(d: localsys.DiskInfo): number {
  const total = d.total || 0;
  if (total <= 0) return 0;
  return Math.min(100, Math.round(((d.used || 0) / total) * 100));
}

const diskPercent = computed(() => diskSummary.value?.percent || 0);
const diskUsed = computed(() => diskSummary.value?.used || 0);
const diskTotal = computed(() => diskSummary.value?.total || 0);
const diskFree = computed(() => diskSummary.value?.avail || 0);

const tempC = computed(() => {
  const v = overview.value?.tempC;
  return v != null && Number.isFinite(Number(v)) ? Number(v) : null;
});
const tempRingPercent = computed(() => {
  const t = tempC.value;
  if (t == null) return 0;
  if (t < 0) return 0;
  if (t > 100) return 100;
  return t;
});
const tempDanger = computed(() => (tempC.value ?? 0) > 90);
const tempLabel = computed(() => {
  const t = tempC.value;
  if (t == null) return "—";
  return `${t.toFixed(0)} °C`;
});

function formatTemp(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(Number(v))) return "—";
  return `${Number(v).toFixed(0)} °C`;
}

const cpuOption = computed<LineOption>(() => {
  const xData = cpuSeries.value.map((p) => p.time);
  const yData: LineOption["yData"] = [
    {
      name: "全核心",
      data: cpuSeries.value.map((p) => p.total),
    },
  ];
  if (hasCpuClusters.value) {
    yData.push({
      name: "性能核",
      data: cpuSeries.value.map((p) => p.perf),
    });
    yData.push({
      name: "能效核",
      data: cpuSeries.value.map((p) => p.eff),
    });
  }
  return {
    xData,
    yData,
    formatStr: "%",
    unit: "raw",
    yMax: 100,
  };
});

const memOption = computed<LineOption>(() => {
  const memTotal = memTotalBytes.value;
  const xData = memSeries.value.map((p) => p.time);
  const yData: LineOption["yData"] = [
    {
      name: "物理内存",
      data: memSeries.value.map((p) => p.phys),
      unit: "bytes",
    },
    {
      name: "交换内存",
      data: memSeries.value.map((p) => p.swap),
      unit: "bytes",
      // 交换量通常远小于物理内存，单独右轴便于看清曲线
      yAxisIndex: 1,
    },
  ];
  return {
    xData,
    yData,
    unit: "bytes",
    ...(memTotal
      ? { yMarkLine: { name: `物理总量 ${formatBytes(memTotal)}`, value: memTotal } }
      : {}),
  };
});

const ioOption = computed<LineOption>(() => ({
  xData: ioSeries.value.map((p) => p.time),
  yData: [
    { name: "读", data: ioSeries.value.map((p) => p.read) },
    { name: "写", data: ioSeries.value.map((p) => p.write) },
  ],
  formatStr: "KB/s",
}));

const cpuMemCards = computed(() => {
  const o = overview.value;
  const cpuTags: { text: string; warn?: boolean }[] = [];
  const memTags: { text: string; warn?: boolean }[] = [];
  if (o) {
    cpuTags.push({ text: `全核心 ${o.cpuPercent.toFixed(1)}%` });
    if (o.perfCores > 0 || o.effCores > 0) {
      cpuTags.push({ text: `性能 ${o.perfCpuPercent.toFixed(1)}%` });
      cpuTags.push({ text: `能效 ${o.effCpuPercent.toFixed(1)}%` });
    }
    memTags.push({
      text: `物理 ${formatBytes(o.memUsed)} / ${formatBytes(o.memTotal)}`,
    });
    if (o.swapTotal > 0) {
      memTags.push({
        text: `交换 ${formatBytes(o.swapUsed)} / ${formatBytes(o.swapTotal)}`,
      });
    } else {
      memTags.push({ text: "交换 未启用" });
    }
  }
  return [
    {
      title: "CPU",
      tags: cpuTags,
      option: cpuOption.value,
    },
    {
      title: "内存",
      tags: memTags,
      option: memOption.value,
    },
  ];
});

const ioCard = computed(() => ({
  title: "磁盘 IO",
  tags: [
    { text: `读 ${formatBytes(ioRates.value.readBps)}/s` },
    { text: `写 ${formatBytes(ioRates.value.writeBps)}/s` },
    { text: `IOPS ${ioRates.value.iops}/s`, warn: true },
  ],
  option: ioOption.value,
}));
</script>

<style scoped lang="scss">
.local-overview {
  min-height: 0;
}

.metrics-grid {
  display: grid;
  gap: 10px;
}

.metrics-grid--pair {
  grid-template-columns: 1fr 1fr;
  grid-template-rows: minmax(200px, 240px);
}

.metrics-grid--io {
  grid-template-columns: 1fr;
  grid-template-rows: minmax(200px, 240px);
}

.metrics-cell {
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;

  :deep(.metrics-card) {
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

.metrics-cell--wide {
  grid-column: 1 / -1;
}

.chart-slot {
  flex: 1;
  min-height: 0;
  width: 100%;
}

@media (max-width: 900px) {
  .metrics-grid--pair {
    grid-template-columns: 1fr;
    grid-template-rows: none;
  }

  .metrics-cell {
    min-height: 200px;
  }

  .metrics-cell--wide {
    grid-column: auto;
  }
}

.home-card {
  margin-bottom: 0;
}

.card-interval {
  margin-top: 10px;
}

.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
  gap: 8px;
  flex-wrap: wrap;
}

.input-help {
  margin-top: 2px;
  font-size: 12px;
  line-height: 1.35;
  color: var(--el-text-color-secondary);

  &.is-danger {
    color: var(--m3-error, var(--el-color-danger));
  }

  .muted {
    font-size: inherit;
  }
}

.disk-row {
  margin-bottom: 10px;
  &:last-child {
    margin-bottom: 0;
  }
}

.disk-head {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 4px;
  font-size: 13px;
}

.disk-mount {
  font-weight: 600;
}

.mono {
  font-family: var(--m3-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
  font-variant-numeric: tabular-nums;
}

.muted {
  color: var(--el-text-color-secondary);
  font-size: 13px;
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

  .ring-pop-title {
    font: var(--m3-title-small);
    font-weight: 600;
    color: var(--m3-primary);
    padding: 4px 0;
    margin-bottom: 2px;
    border-bottom: 1px solid var(--m3-outline-variant);
  }

  .ring-pop-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px 16px;
  }
}
</style>
