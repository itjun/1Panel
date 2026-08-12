<template>
  <div class="all-hosts">
    <!-- 顶栏 -->
    <div class="summary-bar">
      <div class="summary-left">
        <span class="panel-section-title">全部主机</span>
        <span class="meta">共 {{ app.hosts.length }} 台</span>
        <el-tag
          v-if="app.runningHosts.length"
          size="small"
          type="success"
          effect="dark"
        >
          运行中 {{ app.runningHosts.length }}
        </el-tag>
      </div>
      <div class="summary-right">
        <el-button
          link
          type="primary"
          :icon="Refresh"
          :loading="app.loading"
          @click="app.refresh()"
        >
          刷新
        </el-button>
      </div>
    </div>

    <el-empty
      v-if="app.hosts.length === 0"
      description="暂无主机，点击右上角「添加主机」"
    />

    <!-- 按分组分段 -->
    <div v-else class="group-sections">
      <section
        v-for="(node, idx) in groups"
        :key="node.key"
        class="group-section"
      >
        <div class="group-head">
          <span
            class="group-color-dot"
            :style="{ backgroundColor: colorOf(node, idx).accent }"
          />
          <span
            class="group-name"
            :style="{ color: colorOf(node, idx).ink }"
          >
            {{ node.title }}
          </span>
          <span
            class="group-count"
            :style="{
              color: colorOf(node, idx).ink,
              backgroundColor: colorOf(node, idx).soft,
            }"
          >
            {{ node.hosts.length }}
          </span>
        </div>

        <div v-if="node.hosts.length === 0" class="group-empty">
          该分组暂无主机
        </div>
        <div v-else class="host-grid">
          <div
            v-for="h in node.hosts"
            :key="h.name"
            class="host-card panel-hover-card"
            :class="{ 'is-running': app.isRunning(h.name) }"
            :style="{ borderLeftColor: colorOf(node, idx).accent }"
            @click="openHost(h.name)"
          >
            <DistroLogo
              :os-release="app.osReleaseMap.get(h.name) || ''"
              :size="22"
              class="host-ico"
            />
            <div class="host-info">
              <div class="host-name">
                {{ h.name }}
                <span
                  v-if="app.isRunning(h.name)"
                  class="run-dot"
                  title="运行中（后台保持）"
                />
              </div>
              <div class="host-sub">
                {{ h.user || "?" }}@{{ h.hostName || "?" }}
              </div>
              <div v-if="showPort(h.port)" class="host-port">
                端口 {{ h.port }}
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { Refresh } from "@element-plus/icons-vue";
import DistroLogo from "@/components/DistroLogo.vue";
import { useAppStore, UNGROUPED_ID } from "@/stores/app";
import type { sshconfig } from "@/api";

const app = useAppStore();

/**
 * 分组色板：与 SidebarHost 保持一致，概览页分组色与侧栏呼应。
 * accent=色条/圆点，soft=浅底，ink=文字/图标
 */
const GROUP_PALETTE = [
  { accent: "#005eeb", soft: "rgba(0, 94, 235, 0.12)", ink: "#005eeb" },
  { accent: "#3375f6", soft: "rgba(51, 117, 246, 0.12)", ink: "#2a62d4" },
  { accent: "#1a7fd4", soft: "rgba(26, 127, 212, 0.12)", ink: "#176bae" },
  { accent: "#3d8bfd", soft: "rgba(61, 139, 253, 0.12)", ink: "#2f6fd4" },
  { accent: "#4c6ef5", soft: "rgba(76, 110, 245, 0.12)", ink: "#3b5bdb" },
  { accent: "#5c7cfa", soft: "rgba(92, 124, 250, 0.12)", ink: "#4c6ef5" },
  { accent: "#228be6", soft: "rgba(34, 139, 230, 0.12)", ink: "#1c7ed6" },
  { accent: "#15aabf", soft: "rgba(21, 170, 191, 0.12)", ink: "#1098ad" },
  { accent: "#4263eb", soft: "rgba(66, 99, 235, 0.12)", ink: "#364fc7" },
  { accent: "#748ffc", soft: "rgba(116, 143, 252, 0.12)", ink: "#5c7cfa" },
] as const;

/** 未分组：同色系低饱和灰蓝 */
const UNGROUPED_COLOR = {
  accent: "#868e96",
  soft: "rgba(134, 142, 150, 0.12)",
  ink: "#495057",
} as const;

type GroupColor = {
  accent: string;
  soft: string;
  ink: string;
};

interface GroupSection {
  key: string;
  title: string;
  hosts: sshconfig.HostConfig[];
  ungrouped: boolean;
}

/** 分组结构 + 主机基本信息（含端口）来自 store，本地即时数据 */
const groups = computed<GroupSection[]>(() =>
  app.groupNodes.map((n) => ({
    key: n.group?.id || UNGROUPED_ID,
    title: n.group?.name || "未分组",
    hosts: n.hosts,
    ungrouped: !n.group,
  }))
);

function colorOf(node: GroupSection, index: number): GroupColor {
  if (node.ungrouped) return UNGROUPED_COLOR;
  return GROUP_PALETTE[index % GROUP_PALETTE.length];
}

/** 默认 22 端口不展示，减少视觉噪音 */
function showPort(port?: string): boolean {
  return !!port && port !== "22";
}

function openHost(name: string) {
  app.openHostTab(name);
}
</script>

<style scoped lang="scss">
.all-hosts {
  min-height: 200px;
}
.summary-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 16px;
  flex-wrap: wrap;
}
.summary-left,
.summary-right {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.meta {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

/* ---------- 分组分段 ---------- */
.group-sections {
  display: flex;
  flex-direction: column;
  gap: 22px;
}
.group-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
}
.group-color-dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  flex-shrink: 0;
}
.group-name {
  font-size: 14px;
  font-weight: 600;
  letter-spacing: 0.02em;
}
.group-count {
  font-size: 11px;
  font-weight: 600;
  min-width: 18px;
  height: 18px;
  line-height: 18px;
  text-align: center;
  padding: 0 6px;
  border-radius: 9px;
}
.group-empty {
  font-size: 12px;
  color: var(--el-text-color-placeholder);
  padding: 4px 0 8px;
}

/* ---------- 主机卡片网格 ---------- */
.host-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 12px;
}
.host-card {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  background: var(--el-bg-color, #fff);
  border: 1px solid transparent;
  border-left: 3px solid var(--g-accent, #005eeb);
  border-radius: 4px;
  cursor: pointer;
  transition: transform 0.15s ease;
  &:hover {
    transform: translateY(-1px);
  }
}
.host-ico {
  flex-shrink: 0;
}
.host-info {
  min-width: 0;
  flex: 1;
}
.host-name {
  font-size: 14px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  display: flex;
  align-items: center;
  gap: 6px;
}
.host-sub {
  margin-top: 2px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.host-port {
  margin-top: 2px;
  font-size: 11px;
  color: var(--el-text-color-placeholder);
}
.run-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #67c23a;
  flex-shrink: 0;
  box-shadow: 0 0 0 2px rgba(103, 194, 58, 0.2);
}
.host-card.is-running {
  border-color: rgba(103, 194, 58, 0.35);
  border-left-color: #67c23a;
}

html.dark .host-card {
  background: var(--panel-main-bg-color-9, #2e313d);
}
</style>
