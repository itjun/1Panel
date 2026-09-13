<template>
  <div
    class="page-skeleton"
    :class="`is-${variant}`"
    role="status"
    aria-busy="true"
    aria-label="页面加载中"
  >
    <!-- 状态环：本机/远端概览状态区 -->
    <template v-if="variant === 'status'">
      <div class="sk-card">
        <div class="sk-title sk-bone" />
        <div class="sk-rings">
          <div v-for="i in 5" :key="i" class="sk-ring-cell">
            <div class="sk-ring sk-bone" />
            <div class="sk-line sk-bone short" />
          </div>
        </div>
      </div>
      <div class="sk-card sk-gap">
        <div class="sk-title sk-bone" />
        <div class="sk-bars">
          <div v-for="i in 3" :key="i" class="sk-bar-row">
            <div class="sk-line sk-bone" />
            <div class="sk-progress sk-bone" />
          </div>
        </div>
      </div>
      <div class="sk-charts sk-gap">
        <div class="sk-card sk-chart"><div class="sk-title sk-bone" /><div class="sk-plot sk-bone" /></div>
        <div class="sk-card sk-chart"><div class="sk-title sk-bone" /><div class="sk-plot sk-bone" /></div>
      </div>
    </template>

    <!-- 远端主机概览：统计条 + 状态 + 曲线 -->
    <template v-else-if="variant === 'overview'">
      <div class="sk-card">
        <div class="sk-title sk-bone" />
        <div class="sk-stats">
          <div v-for="i in 4" :key="i" class="sk-stat">
            <div class="sk-line sk-bone tiny" />
            <div class="sk-line sk-bone mid" />
          </div>
        </div>
      </div>
      <div class="sk-card sk-gap">
        <div class="sk-title sk-bone" />
        <div class="sk-rings">
          <div v-for="i in 4" :key="i" class="sk-ring-cell">
            <div class="sk-ring sk-bone" />
            <div class="sk-line sk-bone short" />
          </div>
        </div>
      </div>
      <div class="sk-charts sk-gap">
        <div class="sk-card sk-chart"><div class="sk-title sk-bone" /><div class="sk-plot sk-bone" /></div>
        <div class="sk-card sk-chart"><div class="sk-title sk-bone" /><div class="sk-plot sk-bone" /></div>
      </div>
      <div class="sk-card sk-gap sk-chart-wide">
        <div class="sk-title sk-bone" />
        <div class="sk-plot sk-bone" />
      </div>
    </template>

    <!-- 表格页：工具条占位 + 表头 + 行 -->
    <template v-else-if="variant === 'table'">
      <div v-if="showToolbar" class="sk-toolbar">
        <div class="sk-line sk-bone title" />
        <div class="sk-tools">
          <div class="sk-chip sk-bone" />
          <div class="sk-chip sk-bone" />
          <div class="sk-btn sk-bone" />
        </div>
      </div>
      <div class="sk-table sk-card">
        <div class="sk-thead">
          <div v-for="i in cols" :key="'h' + i" class="sk-th sk-bone" />
        </div>
        <div v-for="r in rows" :key="'r' + r" class="sk-tr">
          <div v-for="c in cols" :key="'c' + r + c" class="sk-td sk-bone" :style="tdWidth(c)" />
        </div>
      </div>
    </template>

    <!-- 网络：出口卡 + 网卡列表 -->
    <template v-else-if="variant === 'network'">
      <div class="sk-card sk-egress">
        <div class="sk-line sk-bone xl" />
        <div class="sk-facts">
          <div v-for="i in 3" :key="i" class="sk-fact">
            <div class="sk-line sk-bone tiny" />
            <div class="sk-line sk-bone mid" />
          </div>
        </div>
      </div>
      <div class="sk-filter sk-gap">
        <div class="sk-chip sk-bone" />
        <div class="sk-line sk-bone short" />
      </div>
      <div class="sk-iface-grid sk-gap">
        <div v-for="i in 4" :key="i" class="sk-card sk-iface">
          <div class="sk-line sk-bone mid" />
          <div class="sk-line sk-bone" />
          <div class="sk-line sk-bone short" />
        </div>
      </div>
    </template>

    <!-- 监控：多图宫格 -->
    <template v-else-if="variant === 'monitor'">
      <div class="sk-toolbar">
        <div class="sk-line sk-bone title" />
        <div class="sk-tools">
          <div v-for="i in 4" :key="i" class="sk-chip sk-bone" />
        </div>
      </div>
      <div class="sk-monitor-grid">
        <div v-for="i in 5" :key="i" class="sk-card sk-chart">
          <div class="sk-title sk-bone" />
          <div class="sk-plot sk-bone" />
        </div>
      </div>
    </template>

    <!-- 文件：导航 + 列表行 -->
    <template v-else-if="variant === 'files'">
      <div class="sk-file-nav">
        <div v-for="i in 4" :key="i" class="sk-btn-circle sk-bone" />
        <div class="sk-line sk-bone path" />
        <div class="sk-line sk-bone search" />
      </div>
      <div class="sk-card sk-file-list">
        <div v-for="r in 12" :key="r" class="sk-file-row">
          <div class="sk-icon sk-bone" />
          <div class="sk-line sk-bone" />
          <div class="sk-line sk-bone tiny" />
          <div class="sk-line sk-bone short" />
        </div>
      </div>
    </template>

    <!-- 日志：灰底行块 -->
    <template v-else-if="variant === 'logs'">
      <div class="sk-card sk-log">
        <div v-for="r in 16" :key="r" class="sk-log-line sk-bone" :style="{ width: logWidth(r) }" />
      </div>
    </template>

    <!-- 关于本机：侧栏 + 键值 -->
    <template v-else-if="variant === 'sysinfo'">
      <div class="sk-sysinfo">
        <aside class="sk-card sk-sys-nav">
          <div class="sk-title sk-bone" />
          <div v-for="i in 6" :key="i" class="sk-nav-item sk-bone" />
        </aside>
        <main class="sk-card sk-sys-main">
          <div class="sk-title sk-bone" />
          <div v-for="i in 10" :key="i" class="sk-kv">
            <div class="sk-line sk-bone short" />
            <div class="sk-line sk-bone" />
          </div>
        </main>
      </div>
    </template>

    <!-- Nginx / 配置列表 -->
    <template v-else-if="variant === 'nginx'">
      <div class="sk-toolbar">
        <div class="sk-line sk-bone title" />
        <div class="sk-chip sk-bone" />
        <div class="sk-line sk-bone mid" />
      </div>
      <div class="sk-card">
        <div v-for="i in 8" :key="i" class="sk-file-row">
          <div class="sk-icon sk-bone" />
          <div class="sk-line sk-bone" />
          <div class="sk-line sk-bone tiny" />
        </div>
      </div>
    </template>

    <!-- Docker 卡片宫格 -->
    <template v-else-if="variant === 'cards'">
      <div class="sk-card-grid">
        <div v-for="i in 6" :key="i" class="sk-card sk-docker">
          <div class="sk-docker-head">
            <div class="sk-dot sk-bone" />
            <div class="sk-line sk-bone mid" />
            <div class="sk-chip sk-bone" />
          </div>
          <div class="sk-line sk-bone" />
          <div class="sk-line sk-bone short" />
        </div>
      </div>
    </template>

    <!-- 通知历史列表 -->
    <template v-else-if="variant === 'notify'">
      <div class="sk-notify-list">
        <div v-for="i in 8" :key="i" class="sk-card sk-notify-item">
          <div class="sk-chip sk-bone" />
          <div class="sk-line sk-bone" />
          <div class="sk-line sk-bone short" />
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
withDefaults(
  defineProps<{
    /** 按页面结构选型的骨架形态 */
    variant?:
      | "status"
      | "overview"
      | "table"
      | "network"
      | "monitor"
      | "files"
      | "logs"
      | "sysinfo"
      | "nginx"
      | "cards"
      | "notify";
    /** table 变体：是否画顶部工具条（页面已有真实 toolbar 时可关） */
    showToolbar?: boolean;
    rows?: number;
    cols?: number;
  }>(),
  {
    variant: "table",
    showToolbar: true,
    rows: 8,
    cols: 5,
  }
);

function tdWidth(c: number): Record<string, string> {
  const widths = ["56px", "28%", "18%", "12%", "22%", "14%"];
  return { flex: `0 0 ${widths[(c - 1) % widths.length]}`, maxWidth: widths[(c - 1) % widths.length] };
}

function logWidth(r: number): string {
  const pool = [92, 78, 88, 64, 95, 70, 84, 58];
  return `${pool[(r - 1) % pool.length]}%`;
}
</script>

<style scoped lang="scss">
.page-skeleton {
  width: 100%;
  min-height: 200px;
  box-sizing: border-box;
}

.sk-bone {
  background: linear-gradient(
    90deg,
    var(--m3-surface-container-high, #e6e1e5) 0%,
    var(--m3-surface-container-highest, #e6e5ea) 40%,
    var(--m3-surface-container-high, #e6e1e5) 80%
  );
  background-size: 200% 100%;
  animation: sk-shimmer 1.35s ease-in-out infinite;
  border-radius: 6px;
}

@keyframes sk-shimmer {
  0% {
    background-position: 100% 0;
  }
  100% {
    background-position: -100% 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  .sk-bone {
    animation: none;
    background: var(--m3-surface-container-high, #e6e1e5);
  }
}

.sk-card {
  background: var(--m3-card, var(--m3-surface-container-lowest, #fff));
  border-radius: var(--m3-shape-m, 12px);
  box-shadow: inset 0 0 0 1px var(--m3-outline-variant, #cac4d0);
  padding: 14px 16px;
  box-sizing: border-box;
}

.sk-gap {
  margin-top: 12px;
}

.sk-title {
  width: 72px;
  height: 18px;
  margin-bottom: 14px;
}

.sk-line {
  height: 12px;
  width: 100%;

  &.tiny {
    width: 40%;
    height: 10px;
  }
  &.short {
    width: 55%;
  }
  &.mid {
    width: 70%;
  }
  &.xl {
    width: 42%;
    height: 28px;
  }
  &.title {
    width: 88px;
    height: 20px;
  }
  &.path {
    flex: 1;
    height: 32px;
    border-radius: 8px;
  }
  &.search {
    width: 160px;
    height: 32px;
    border-radius: 8px;
  }
}

.sk-rings {
  display: flex;
  justify-content: space-around;
  gap: 8px;
  flex-wrap: wrap;
}

.sk-ring-cell {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 72px;
}

.sk-ring {
  width: 88px;
  height: 88px;
  border-radius: 50%;
}

.sk-bars {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.sk-bar-row {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.sk-progress {
  height: 8px;
  width: 100%;
  border-radius: 999px;
}

.sk-charts {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.sk-chart,
.sk-chart-wide {
  min-height: 180px;
}

.sk-plot {
  height: 140px;
  width: 100%;
  border-radius: 8px;
}

.sk-stats {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
}

.sk-stat {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.sk-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
  flex-wrap: wrap;
}

.sk-tools {
  display: flex;
  gap: 8px;
  align-items: center;
}

.sk-chip {
  width: 64px;
  height: 28px;
  border-radius: 8px;
}

.sk-btn {
  width: 36px;
  height: 32px;
  border-radius: 8px;
}

.sk-btn-circle {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  flex-shrink: 0;
}

.sk-table {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 280px;
}

.sk-thead,
.sk-tr {
  display: flex;
  gap: 12px;
  align-items: center;
}

.sk-th {
  height: 14px;
  flex: 1;
  opacity: 0.7;
}

.sk-td {
  height: 12px;
  flex: 1;
}

.sk-egress {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.sk-facts {
  display: flex;
  gap: 24px;
  flex-wrap: wrap;
}

.sk-fact {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 100px;
}

.sk-filter {
  display: flex;
  align-items: center;
  gap: 12px;
}

.sk-iface-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 12px;
}

.sk-iface {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 96px;
}

.sk-monitor-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;

  .sk-card:last-child {
    grid-column: 1 / -1;
  }
}

.sk-file-nav {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
}

.sk-file-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.sk-file-row {
  display: flex;
  align-items: center;
  gap: 12px;
}

.sk-icon {
  width: 20px;
  height: 20px;
  border-radius: 4px;
  flex-shrink: 0;
}

.sk-log {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-height: 320px;
  font-family: var(--m3-font-mono, ui-monospace, Menlo, monospace);
}

.sk-log-line {
  height: 10px;
}

.sk-sysinfo {
  display: grid;
  grid-template-columns: 200px 1fr;
  gap: 12px;
  min-height: 360px;
}

.sk-sys-nav {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.sk-nav-item {
  height: 32px;
  width: 100%;
}

.sk-sys-main {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.sk-kv {
  display: grid;
  grid-template-columns: 120px 1fr;
  gap: 16px;
  align-items: center;
}

.sk-card-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 12px;
}

.sk-docker {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 110px;
}

.sk-docker-head {
  display: flex;
  align-items: center;
  gap: 8px;
}

.sk-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex-shrink: 0;
}

.sk-notify-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.sk-notify-item {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
</style>
