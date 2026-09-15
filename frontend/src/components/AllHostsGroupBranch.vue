<script setup lang="ts">
/**
 * 全部主机概览分组节点。
 * 层级用缩进 + 左侧细色条表达，不用彩色底板，与无子分组的顶层视觉一致。
 */
import DistroLogo from "@/components/DistroLogo.vue";
import { groupColor, type GroupColor } from "@/components/sidebar/groupColors";
import type { sshconfig } from "@/api";

defineOptions({ name: "AllHostsGroupBranch" });

export type HostGroupTreeNode = {
  key: string;
  title: string;
  hosts: sshconfig.HostConfig[];
  /** 子树主机总数（本层+子孙），与侧栏计数一致 */
  totalCount: number;
  rootIndex: number;
  depth: number;
  children: HostGroupTreeNode[];
};

const props = defineProps<{
  node: HostGroupTreeNode;
  nested: boolean;
  isRunning: (name: string) => boolean;
  osRelease: (name: string) => string;
}>();

const emit = defineEmits<{
  (e: "open-host", name: string): void;
  (e: "refresh-icon", name: string): void;
}>();

const color: GroupColor = groupColor(props.node.key, props.node.rootIndex);

function showPort(port?: string): boolean {
  return !!port && port !== "22";
}
</script>

<template>
  <section
    class="group-branch"
    :class="{ 'is-nested': nested }"
    :style="{
      '--group-accent': color.accent,
      '--group-soft': color.soft,
      '--group-ink': color.ink,
    }"
  >
    <div class="group-branch__head">
      <span
        class="group-color-dot"
        :style="{ backgroundColor: color.accent }"
      />
      <span
        class="group-name"
        :class="{ 'is-nested-name': nested }"
        :style="{ color: color.ink }"
      >
        {{ node.title }}
      </span>
      <span
        class="group-count"
        :style="{ color: color.ink, backgroundColor: color.soft }"
      >
        {{ node.totalCount }}
      </span>
    </div>

    <div
      v-if="node.hosts.length === 0 && node.children.length === 0"
      class="group-empty"
    >
      该分组暂无主机
    </div>

    <div v-if="node.hosts.length > 0" class="host-grid">
      <div
        v-for="h in node.hosts"
        :key="h.name"
        class="host-card"
        :class="{ 'is-running': isRunning(h.name) }"
        @click="emit('open-host', h.name)"
      >
        <span
          class="host-ico-wrap"
          v-tip="
            osRelease(h.name)
              ? `${osRelease(h.name)}（右键重新识别）`
              : '未识别发行版，右键探测'
          "
          @click.stop
          @contextmenu.prevent="emit('refresh-icon', h.name)"
        >
          <DistroLogo
            :os-release="osRelease(h.name)"
            :size="22"
            class="host-ico"
          />
        </span>
        <div class="host-info">
          <div class="host-name">
            {{ h.name }}
            <span
              v-if="isRunning(h.name)"
              class="run-dot"
              v-tip="'运行中（后台保持）'"
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

    <div v-if="node.children.length > 0" class="nest-stack">
      <AllHostsGroupBranch
        v-for="child in node.children"
        :key="child.key"
        :node="child"
        nested
        :is-running="isRunning"
        :os-release="osRelease"
        @open-host="(n) => emit('open-host', n)"
        @refresh-icon="(n) => emit('refresh-icon', n)"
      />
    </div>
  </section>
</template>

<style scoped lang="scss">
.group-branch {
  position: relative;
  min-width: 0;
}

/*
 * 嵌套：与顶层同一套白底/卡片，只多「缩进 + 左侧细色条」。
 * 色条同侧栏语义，不铺彩色底板，避免子分组一块绿/紫突兀。
 */
.group-branch.is-nested {
  margin-left: 4px;
  padding-left: 18px;
  border-left: 2px solid
    color-mix(in srgb, var(--group-accent, var(--m3-outline)) 75%, transparent);
}

.group-branch__head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
  min-height: 28px;
}

.nest-stack {
  display: flex;
  flex-direction: column;
  gap: 18px;
  margin-top: 16px;
}

.group-color-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex-shrink: 0;
}

.group-name {
  font-size: 18px;
  font-weight: 650;
  letter-spacing: 0.02em;
  line-height: 1.3;

  &.is-nested-name {
    font-size: 15px;
    font-weight: 600;
  }
}

.group-count {
  font-size: 12px;
  font-weight: 600;
  min-width: 20px;
  height: 20px;
  line-height: 20px;
  text-align: center;
  padding: 0 7px;
  border-radius: 10px;
}

.group-empty {
  font-size: 12px;
  color: var(--el-text-color-placeholder);
  padding: 4px 0 8px;
}

.host-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 12px;
}

.host-card {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 16px;
  background: var(--m3-surface-container-lowest, #fff);
  border: none;
  border-radius: var(--m3-shape-m, 12px);
  box-sizing: border-box;
  cursor: pointer;
  outline: none;
  box-shadow: inset 0 0 0 1px var(--m3-outline-variant, #cac4d0);
  transition: box-shadow var(--m3-motion-select);

  &:hover {
    box-shadow: inset 0 0 0 2px var(--m3-primary);
  }
}

.host-ico-wrap {
  display: flex;
  flex-shrink: 0;
  cursor: context-menu;
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
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--group-accent, var(--m3-primary, #6750a4));
  flex-shrink: 0;
}

:global(html.dark) .host-card {
  background: var(--m3-surface-container-low, #1a1a1d);
}
</style>
