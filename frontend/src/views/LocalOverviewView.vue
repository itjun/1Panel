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
                      <span class="ring-pop-value" v-tip="overview.cpuModel">
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
                <el-popover
                  trigger="hover"
                  placement="bottom"
                  :width="diskPopWidth"
                  popper-class="disk-pop-el"
                >
                  <div
                    class="disk-pop"
                    :class="{
                      'is-danger': diskPercent > 90,
                      [`cols-${diskPopCols}`]: true,
                    }"
                  >
                    <div v-if="diskSummaryItems.length" class="disk-pop-grid">
                      <div
                        v-for="item in diskSummaryItems"
                        :key="item.key"
                        class="disk-pop-cell"
                        :class="{ 'is-danger': item.percent > 90 }"
                      >
                        <div class="disk-pop-cell-head">
                          <span class="disk-pop-name" v-tip="item.label">{{
                            item.label
                          }}</span>
                          <span class="disk-pop-pct"
                            >{{ item.percent.toFixed(0) }}%</span
                          >
                        </div>
                        <div
                          class="disk-pop-bar"
                          role="presentation"
                          :aria-valuenow="Math.round(item.percent)"
                        >
                          <i
                            :style="{
                              width: `${Math.min(100, Math.max(0, item.percent))}%`,
                            }"
                          />
                        </div>
                        <div class="disk-pop-meta">
                          <span>{{ formatBytesSI(item.used) }} 已用</span>
                          <span>{{ formatBytesSI(item.avail) }} 可用</span>
                        </div>
                        <div class="disk-pop-total muted">
                          共 {{ formatBytesSI(item.total) }}
                        </div>
                      </div>
                    </div>
                    <div
                      v-if="diskSummaryItems.length > 1"
                      class="disk-pop-foot"
                    >
                      <span class="disk-pop-foot-count"
                        >{{ diskSummaryItems.length }} 块合计</span
                      >
                      <span class="disk-pop-foot-stats">
                        {{ formatBytesSI(diskUsed) }} /
                        {{ formatBytesSI(diskTotal) }}
                        <em>{{ diskPercent.toFixed(1) }}%</em>
                      </span>
                    </div>
                    <div v-if="!diskSummaryItems.length" class="muted">
                      无磁盘数据
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

          <!-- 磁盘分区：本机竖排；外置同风格，进度条换色区分 -->
          <el-card shadow="never" class="home-card panel-hover-card card-interval">
            <div class="card-header">
              <span class="panel-section-title">磁盘分区</span>
              <div class="disk-card-actions">
                <span v-if="externalDiskOverflow > 0" class="muted disk-overflow">
                  外置已满 {{ MAX_EXTERNAL_DISKS }} 块，另有
                  {{ externalDiskOverflow }} 块未显示
                </span>
                <el-button link type="primary" @click="app.setLocalSection('storage')">
                  查看占用
                </el-button>
              </div>
            </div>
            <div v-if="!internalDiskGroups.length && !externalDiskGroups.length" class="muted">
              无磁盘数据
            </div>
            <template v-else>
              <div v-if="internalDiskGroups.length" class="disk-section">
                <div class="disk-section-title">本机磁盘</div>
                <div
                  v-for="g in internalDiskGroups"
                  :key="g.parent"
                  class="disk-internal-group"
                >
                  <div
                    v-for="d in g.partitions"
                    :key="d.mount"
                    class="disk-row is-internal"
                    :class="{ 'is-danger': diskMountPercent(d) > 90 }"
                  >
                    <div class="disk-head">
                      <span class="disk-mount" v-tip="d.mount">{{
                        diskMountLabel(d)
                      }}</span>
                      <span class="mono muted"
                        >{{ formatBytesSI(d.used) }} /
                        {{ formatBytesSI(d.total) }}</span
                      >
                    </div>
                    <el-progress
                      :percentage="diskMountPercent(d)"
                      :stroke-width="8"
                      :color="
                        diskMountPercent(d) > 90 ? undefined : INTERNAL_DISK_BAR_COLOR
                      "
                      :status="diskMountPercent(d) > 90 ? 'exception' : undefined"
                    />
                  </div>
                </div>
              </div>

              <div v-if="externalDiskRows.length" class="disk-section">
                <div class="disk-section-title">外置磁盘</div>
                <div
                  v-for="d in externalDiskRows"
                  :key="d.mount || d.device"
                  class="disk-row is-external"
                  :class="{ 'is-danger': diskMountPercent(d) > 90 }"
                >
                  <div class="disk-head">
                    <span class="disk-mount" v-tip="d.mount">{{
                      diskExternalRowLabel(d)
                    }}</span>
                    <span class="mono muted"
                      >{{ formatBytesSI(d.used) }} /
                      {{ formatBytesSI(d.total) }}</span
                    >
                  </div>
                  <el-progress
                    :percentage="diskMountPercent(d)"
                    :stroke-width="8"
                    :color="
                      diskMountPercent(d) > 90 ? undefined : EXTERNAL_DISK_BAR_COLOR
                    "
                    :status="diskMountPercent(d) > 90 ? 'exception' : undefined"
                  />
                </div>
              </div>
            </template>
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

/** 外置硬盘最多展示数量 */
const MAX_EXTERNAL_DISKS = 16;
/** 本机 / 外置进度条：本机 primary；外置用同色相的软蓝，避免 secondary 发灰 */
const INTERNAL_DISK_BAR_COLOR = "#005eeb"; // --m3-primary
const EXTERNAL_DISK_BAR_COLOR = "#5b8def"; // primary 浅化，仍可读作蓝

type DiskSummaryItem = {
  key: string;
  label: string;
  total: number;
  used: number;
  avail: number;
  percent: number;
  scope: "disk" | "mount";
};

function isExternalMountPath(mount?: string | null): boolean {
  const m = (mount || "").trim();
  if (!m.startsWith("/Volumes/")) return false;
  if (m === "/Volumes/Recovery") return false;
  const name = m.slice("/Volumes/".length);
  return !!name && !name.includes("/");
}

/** 弹出 / 环图：本机 1 块 + 外置最多 16 块 */
const diskSummaryItems = computed((): DiskSummaryItem[] => {
  const all = overview.value?.disks || [];
  const physical = all.filter((d) => d.kind === "disk" && (d.total || 0) > 0);
  const list = physical.length
    ? physical
    : all.filter((d) => d.kind !== "disk" && (d.total || 0) > 0);
  const byKey = new Map<string, localsys.DiskInfo>();
  for (const d of list) {
    const key = d.filesystem || d.device || d.mount || "";
    const prev = byKey.get(key);
    if (!prev || (d.total || 0) > (prev.total || 0)) {
      byKey.set(key, d);
    }
  }
  const internal: DiskSummaryItem[] = [];
  const external: DiskSummaryItem[] = [];
  for (const [key, d] of byKey) {
    const total = d.total || 0;
    if (total <= 0) continue;
    const used = d.used || 0;
    const avail = d.avail || d.free || 0;
    const item: DiskSummaryItem = {
      key,
      label: diskPhysicalLabel(d),
      total,
      used,
      avail,
      percent: (used / total) * 100,
      scope: d.kind === "disk" ? "disk" : "mount",
    };
    if (isExternalMountPath(d.mount) || item.label.includes("外置")) {
      external.push(item);
    } else {
      internal.push(item);
    }
  }
  internal.sort((a, b) => b.total - a.total);
  external.sort((a, b) => b.total - a.total);
  return [...internal, ...external.slice(0, MAX_EXTERNAL_DISKS)];
});

/** 磁盘环图：汇总已展示的盘（含上限内的外置） */
const diskSummary = computed(() => {
  const items = diskSummaryItems.value;
  if (!items.length) return null;
  let total = 0;
  let used = 0;
  let avail = 0;
  for (const d of items) {
    total += d.total;
    used += d.used;
    avail += d.avail;
  }
  if (total <= 0) return null;
  return {
    total,
    used,
    avail,
    percent: (used / total) * 100,
    count: items.length,
    scope: items.some((d) => d.scope === "disk")
      ? ("disk" as const)
      : ("mount" as const),
  };
});

function diskPhysicalLabel(d: localsys.DiskInfo): string {
  const m = (d.mount || "").trim();
  if (isExternalMountPath(m)) {
    const name = m.slice("/Volumes/".length);
    return name ? `${name}（外置）` : "外置磁盘";
  }
  if (d.kind === "disk" && (d.device || d.filesystem)) {
    return `本机磁盘（${d.device || d.filesystem}）`;
  }
  return diskMountLabel(d);
}

function diskParentOf(d: localsys.DiskInfo): string {
  const p = (d.parent || "").trim();
  if (p) return p;
  const device = (d.device || d.filesystem || "").trim();
  const bare = device.replace(/^\/dev\//, "");
  const m = /^disk\d+/.exec(bare);
  if (m) return m[0];
  if (isExternalMountPath(d.mount)) return (d.mount || "").trim();
  return device || (d.mount || "").trim() || "unknown";
}

type DiskGroup = {
  parent: string;
  label: string;
  displayName: string;
  external: boolean;
  physical?: localsys.DiskInfo;
  partitions: localsys.DiskInfo[];
};

/** 按物理盘分组：本机竖排分区 + 外置最多 16 盘 */
const diskGroups = computed((): { internal: DiskGroup[]; external: DiskGroup[] } => {
  const all = overview.value?.disks || [];
  const mounts = all.filter((d) => d.kind !== "disk");
  const physicals = all.filter((d) => d.kind === "disk" && (d.total || 0) > 0);

  const byParent = new Map<string, DiskGroup>();

  const ensure = (parent: string, external: boolean): DiskGroup => {
    let g = byParent.get(parent);
    if (!g) {
      g = {
        parent,
        label: "",
        displayName: parent,
        external,
        partitions: [],
      };
      byParent.set(parent, g);
    }
    return g;
  };

  for (const d of physicals) {
    const parent = diskParentOf(d);
    const external = isExternalMountPath(d.mount) || isExternalMountPath(d.filesystem);
    const g = ensure(parent, external);
    g.external = g.external || external;
    g.physical = d;
    if (external) {
      g.displayName = diskPhysicalLabel(d);
      g.label = "";
    } else {
      g.label = "";
      g.displayName = d.device || parent;
    }
  }

  for (const d of mounts) {
    const parent = diskParentOf(d);
    const external = isExternalMountPath(d.mount);
    const g = ensure(parent, external);
    g.external = g.external || external;
    g.partitions.push(d);
    if (external && !g.physical) {
      g.displayName = diskMountLabel(d);
    }
  }

  const internal: DiskGroup[] = [];
  const external: DiskGroup[] = [];
  for (const g of byParent.values()) {
    if (!g.partitions.length && !g.physical) continue;
    // 外置无分区时用 physical 当展示源
    if (g.external) {
      if (!g.partitions.length && g.physical) {
        g.partitions = [g.physical];
      }
      external.push(g);
    } else {
      if (!g.partitions.length) continue;
      internal.push(g);
    }
  }

  internal.sort((a, b) => {
    const at = a.physical?.total || a.partitions[0]?.total || 0;
    const bt = b.physical?.total || b.partitions[0]?.total || 0;
    return bt - at;
  });
  for (const g of internal) {
    g.partitions.sort((a, b) => {
      if (a.mount === "/") return -1;
      if (b.mount === "/") return 1;
      return (a.mount || "").localeCompare(b.mount || "");
    });
  }

  external.sort((a, b) => diskGroupTotal(b) - diskGroupTotal(a));
  const shown = external.slice(0, MAX_EXTERNAL_DISKS);
  return { internal, external: shown };
});

const internalDiskGroups = computed(() => diskGroups.value.internal);
const externalDiskGroups = computed(() => diskGroups.value.external);

/** 外置：展开为与本机相同的竖排分区行 */
const externalDiskRows = computed((): localsys.DiskInfo[] => {
  const rows: localsys.DiskInfo[] = [];
  for (const g of externalDiskGroups.value) {
    if (g.partitions.length) {
      rows.push(...g.partitions);
    } else if (g.physical) {
      rows.push(g.physical);
    }
  }
  return rows;
});

const externalDiskOverflow = computed(() => {
  const all = overview.value?.disks || [];
  const parents = new Set<string>();
  for (const d of all) {
    if (d.kind === "disk" && isExternalMountPath(d.mount || d.filesystem)) {
      parents.add(diskParentOf(d));
    } else if (d.kind !== "disk" && isExternalMountPath(d.mount)) {
      parents.add(diskParentOf(d));
    }
  }
  return Math.max(0, parents.size - MAX_EXTERNAL_DISKS);
});

function diskGroupUsed(g: DiskGroup): number {
  if (g.physical && (g.physical.total || 0) > 0) return g.physical.used || 0;
  return g.partitions.reduce((s, d) => s + (d.used || 0), 0);
}

function diskGroupTotal(g: DiskGroup): number {
  if (g.physical && (g.physical.total || 0) > 0) return g.physical.total || 0;
  return Math.max(0, ...g.partitions.map((d) => d.total || 0));
}

function diskGroupPercent(g: DiskGroup): number {
  const total = diskGroupTotal(g);
  if (total <= 0) return 0;
  return Math.min(100, Math.round((diskGroupUsed(g) / total) * 100));
}

function diskMountLabel(d: localsys.DiskInfo): string {
  const m = (d.mount || "").trim();
  if (isExternalMountPath(m)) {
    const name = m.slice("/Volumes/".length);
    return name ? `${name}（外置）` : m;
  }
  return m || d.device || "磁盘";
}

/** 外置区行标题：分区名即可（区标题已是「外置磁盘」） */
function diskExternalRowLabel(d: localsys.DiskInfo): string {
  const m = (d.mount || "").trim();
  if (isExternalMountPath(m)) {
    const name = m.slice("/Volumes/".length);
    return name || m;
  }
  return diskMountLabel(d);
}

function diskMountPercent(d: localsys.DiskInfo): number {
  const total = d.total || 0;
  if (total <= 0) return 0;
  return Math.min(100, Math.round(((d.used || 0) / total) * 100));
}

const diskPercent = computed(() => diskSummary.value?.percent || 0);
const diskUsed = computed(() => diskSummary.value?.used || 0);
const diskTotal = computed(() => diskSummary.value?.total || 0);
const diskFree = computed(() => diskSummary.value?.avail || 0);

/** 弹出网格列数：尽量一屏装下最多 16 外置 + 本机 */
const diskPopCols = computed(() => {
  const n = diskSummaryItems.value.length;
  if (n <= 1) return 1;
  if (n <= 4) return 2;
  if (n <= 9) return 3;
  return 4;
});

const diskPopWidth = computed(() => {
  const cols = diskPopCols.value;
  if (cols <= 1) return 240;
  if (cols === 2) return 420;
  if (cols === 3) return 560;
  return 680;
});

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

.disk-card-actions {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.disk-overflow {
  font-size: 12px;
}

.disk-section {
  & + & {
    margin-top: 14px;
    padding-top: 14px;
    border-top: 1px solid var(--m3-outline-variant, var(--el-border-color-lighter));
  }
}

.disk-section-title {
  font-size: 12px;
  font-weight: 600;
  line-height: 1.3;
  color: var(--m3-on-surface-variant, var(--el-text-color-secondary));
  margin-bottom: 8px;
}

.disk-internal-group {
  & + & {
    margin-top: 10px;
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
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.disk-row.is-internal :deep(.el-progress__text) {
  color: var(--m3-primary);
}

.disk-row.is-external :deep(.el-progress__text) {
  color: #5b8def;
}

.disk-row.is-danger :deep(.el-progress__text) {
  color: var(--m3-error, var(--el-color-danger));
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
  }

  .ring-pop-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px 16px;
  }
}

/* 磁盘环图弹出：色块分区，不用线框切割 */
.disk-pop {
  --disk-ok: var(--m3-primary, var(--el-color-primary));
  --disk-warn: var(--m3-error, var(--el-color-danger));
  --disk-soft: var(--m3-surface-container, var(--el-fill-color-light));
  --disk-ink: var(--m3-on-surface, var(--el-text-color-primary));
  --disk-mute: var(--m3-on-surface-variant, var(--el-text-color-secondary));
  color: var(--disk-ink);
  font: var(--m3-body-small);
}

.disk-pop-grid {
  display: grid;
  gap: 8px;
  grid-template-columns: repeat(1, minmax(0, 1fr));
}

.disk-pop.cols-2 .disk-pop-grid {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.disk-pop.cols-3 .disk-pop-grid {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.disk-pop.cols-4 .disk-pop-grid {
  grid-template-columns: repeat(4, minmax(0, 1fr));
}

.disk-pop-cell {
  min-width: 0;
  padding: 10px 11px 9px;
  border-radius: 10px;
  background: var(--disk-soft);
  box-sizing: border-box;
}

.disk-pop-cell-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  min-width: 0;
}

.disk-pop-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  font-weight: 600;
  line-height: 1.25;
  color: var(--disk-ink);
}

.disk-pop-pct {
  flex-shrink: 0;
  font-size: 18px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.02em;
  line-height: 1;
  color: var(--disk-ok);
}

.disk-pop-cell.is-danger .disk-pop-pct {
  color: var(--disk-warn);
}

.disk-pop-bar {
  margin-top: 8px;
  height: 4px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--disk-ink) 8%, transparent);
  overflow: hidden;

  > i {
    display: block;
    height: 100%;
    border-radius: inherit;
    background: var(--disk-ok);
  }
}

.disk-pop-cell.is-danger .disk-pop-bar > i {
  background: var(--disk-warn);
}

.disk-pop-meta {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  margin-top: 8px;
  font-size: 11px;
  line-height: 1.3;
  color: var(--disk-mute);
  font-variant-numeric: tabular-nums;

  > span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}

.disk-pop-total {
  margin-top: 3px;
  font-size: 11px;
  line-height: 1.3;
  font-variant-numeric: tabular-nums;
}

.disk-pop-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-top: 8px;
  padding: 8px 11px;
  border-radius: 10px;
  background: color-mix(in srgb, var(--disk-ok) 8%, var(--disk-soft));
}

.disk-pop-foot-count {
  flex-shrink: 0;
  font-size: 12px;
  color: var(--disk-mute);
}

.disk-pop-foot-stats {
  min-width: 0;
  text-align: right;
  font-size: 12px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  color: var(--disk-ink);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;

  em {
    margin-left: 6px;
    font-style: normal;
    color: var(--disk-ok);
  }
}

.disk-pop.is-danger .disk-pop-foot {
  background: color-mix(in srgb, var(--disk-warn) 10%, var(--disk-soft));
}

.disk-pop.is-danger .disk-pop-foot-stats em {
  color: var(--disk-warn);
}
</style>
