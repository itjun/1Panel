<script setup lang="ts">
/**
 * 全部主机概览分组节点。
 * 层级用缩进 + 左侧细色条表达；主机卡片支持右键菜单与拖拽迁组。
 */
import DistroLogo from "@/components/DistroLogo.vue";
import { groupColor, type GroupColor } from "@/components/sidebar/groupColors";
import type { sshconfig } from "@/api";
import {
  summarizeFleet,
  type FleetHostStatus,
  type FleetReach,
} from "@/composables/useFleetStatus";
import { useInjectedHostDrag } from "@/composables/useHostDrag";
import { computed } from "vue";

defineOptions({ name: "AllHostsGroupBranch" });

export type HostGroupTreeNode = {
  key: string;
  title: string;
  hosts: sshconfig.HostConfig[];
  /** 子树主机名（本层+子孙），用于状态汇总 */
  hostNames: string[];
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
  statusByHost: Map<string, FleetHostStatus>;
}>();

const emit = defineEmits<{
  (e: "open-host", name: string): void;
  (e: "refresh-icon", name: string): void;
  (e: "open-group", id: string, title: string): void;
  (e: "open-board", id: string): void;
  (e: "host-context", ev: MouseEvent, name: string): void;
}>();

const { dragState, dropTargetId, suppressClick, onHostPointerDown } =
  useInjectedHostDrag();

const color: GroupColor = groupColor(props.node.key, props.node.rootIndex);

const fleetSummary = computed(() =>
  summarizeFleet(props.node.hostNames, props.statusByHost)
);

const fleetSummaryText = computed(() => {
  const s = fleetSummary.value;
  const parts = [`${s.online} 台在线`];
  if (s.noAgent > 0) parts.push(`${s.noAgent} 台未装`);
  if (s.sshDown > 0) parts.push(`${s.sshDown} 台掉线`);
  if (s.alert > 0) parts.push(`${s.alert} 台告警`);
  return parts.join(" · ");
});

function hostReach(name: string): FleetReach | null {
  return props.statusByHost.get(name)?.reach ?? null;
}

function cardTip(name: string): string | undefined {
  const r = hostReach(name);
  if (r === "ssh_down") return "SSH 接不上";
  if (r === "no_agent") return "SSH 通，未装或未运行 Agent";
  return undefined;
}

function showPort(port?: string): boolean {
  return !!port && port !== "22";
}

function onCardClick(name: string) {
  if (suppressClick.value) return;
  emit("open-host", name);
}
</script>

<template>
  <section
    class="group-branch"
    :class="{
      'is-nested': nested,
      'is-drop-target': dropTargetId === node.key,
    }"
    :data-group-anchor="node.key"
    :data-drop-group="node.key"
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
      <span
        v-if="node.hostNames.length > 0"
        class="group-fleet-summary"
        :style="{ color: color.ink }"
      >
        {{ fleetSummaryText }}
      </span>
      <span class="group-head-actions">
        <button
          type="button"
          class="group-head-link"
          @click.stop="emit('open-group', node.key, node.title)"
        >
          分组页
        </button>
        <button
          type="button"
          class="group-head-link"
          @click.stop="emit('open-board', node.key)"
        >
          看板窗口
        </button>
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
        :class="{
          'is-running': isRunning(h.name),
          'is-ssh-down': hostReach(h.name) === 'ssh_down',
          'is-no-agent': hostReach(h.name) === 'no_agent',
          'is-drag-source':
            dragState?.kind === 'host' && dragState.id === h.name,
        }"
        :title="cardTip(h.name)"
        @pointerdown="onHostPointerDown($event, h.name)"
        @click="onCardClick(h.name)"
        @contextmenu.prevent="emit('host-context', $event, h.name)"
      >
        <span
          class="host-ico-wrap"
          v-tip="
            osRelease(h.name)
              ? `${osRelease(h.name)}（右键重新识别）`
              : '未识别发行版，右键探测'
          "
          @click.stop
          @contextmenu.prevent.stop="emit('refresh-icon', h.name)"
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
              v-tip="'已打开会话（后台保持）'"
            />
            <span
              v-if="hostReach(h.name) === 'no_agent'"
              class="no-agent-badge"
            >
              未装
            </span>
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
        :status-by-host="statusByHost"
        @open-host="(n) => emit('open-host', n)"
        @refresh-icon="(n) => emit('refresh-icon', n)"
        @open-group="(id, title) => emit('open-group', id, title)"
        @open-board="(id) => emit('open-board', id)"
        @host-context="(e, n) => emit('host-context', e, n)"
      />
    </div>
  </section>
</template>

<style scoped lang="scss">
.group-branch {
  position: relative;
  min-width: 0;
  /* 色块内边距：卡片与色块边缘、底部不再粘连 */
  padding: 16px 16px 20px;
  border-radius: 12px;
  background: color-mix(
    in srgb,
    var(--group-soft, rgba(0, 0, 0, 0.04)) 88%,
    transparent
  );
  transition: box-shadow 0.35s ease, background-color 0.35s ease;

  &.is-group-flash {
    background: color-mix(
      in srgb,
      var(--group-accent, var(--m3-primary)) 16%,
      transparent
    );
    box-shadow: inset 0 0 0 2px
      color-mix(in srgb, var(--group-accent, var(--m3-primary)) 55%, transparent);
  }

  &.is-drop-target {
    background: color-mix(
      in srgb,
      var(--group-accent, var(--m3-primary)) 14%,
      transparent
    );
    outline: 2px dashed var(--group-accent, var(--m3-primary));
    outline-offset: 2px;
  }
}

/*
 * 嵌套：与顶层同一套色块，只多「缩进 + 左侧细色条」。
 */
.group-branch.is-nested {
  margin-left: 4px;
  padding-left: 18px;
  border-left: 2px solid
    color-mix(in srgb, var(--group-accent, var(--m3-outline)) 75%, transparent);
  background: color-mix(
    in srgb,
    var(--group-soft, rgba(0, 0, 0, 0.03)) 55%,
    transparent
  );
}

.group-branch__head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 14px;
  min-height: 28px;
  flex-wrap: wrap;
}

.nest-stack {
  display: flex;
  flex-direction: column;
  gap: 16px;
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

.group-fleet-summary {
  font-size: 12px;
  font-weight: 500;
  opacity: 0.78;
  white-space: nowrap;
}

.group-head-actions {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-left: auto;
}

.group-head-link {
  appearance: none;
  border: none;
  background: transparent;
  padding: 2px 8px;
  font-size: 12px;
  font-weight: 550;
  line-height: 20px;
  color: var(--group-ink, var(--m3-primary));
  opacity: 0.72;
  cursor: pointer;
  border-radius: 6px;

  &:hover {
    opacity: 1;
    background: var(--group-soft, rgba(0, 0, 0, 0.05));
  }
}

.group-empty {
  font-size: 12px;
  color: var(--el-text-color-placeholder);
  padding: 4px 0 8px;
}

.host-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 14px;
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
  cursor: grab;
  outline: none;
  touch-action: none;
  box-shadow: inset 0 0 0 1px var(--m3-outline-variant, #cac4d0);
  transition:
    box-shadow var(--m3-motion-select),
    opacity var(--m3-motion-state),
    background-color 0.2s ease;

  &:hover {
    box-shadow: inset 0 0 0 2px var(--m3-primary);
  }

  &:active {
    cursor: grabbing;
  }

  &.is-drag-source {
    opacity: 0.45;
  }

  /* SSH 接不上：整卡红 */
  &.is-ssh-down {
    background: color-mix(in srgb, #d93025 12%, #fff);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, #d93025 45%, transparent);

    &:hover {
      box-shadow: inset 0 0 0 2px #d93025;
    }
  }

  /* SSH 通但未装 Agent：灰卡 */
  &.is-no-agent {
    background: color-mix(in srgb, #9aa0a6 14%, #fff);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, #9aa0a6 40%, transparent);

    &:hover {
      box-shadow: inset 0 0 0 2px #80868b;
    }
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

/* 仅「已打开」显示绿色小点，不作在线指示 */
.run-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #1e8e3e;
  flex-shrink: 0;
}

.no-agent-badge {
  flex-shrink: 0;
  font-size: 11px;
  font-weight: 600;
  line-height: 16px;
  padding: 0 6px;
  border-radius: 8px;
  color: #5f6368;
  background: color-mix(in srgb, #9aa0a6 22%, #fff);
}

:global(html.dark) .host-card {
  background: var(--m3-surface-container-low, #1a1a1d);

  &.is-ssh-down {
    background: color-mix(in srgb, #d93025 22%, #1a1a1d);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, #d93025 55%, transparent);
  }

  &.is-no-agent {
    background: color-mix(in srgb, #9aa0a6 18%, #1a1a1d);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, #9aa0a6 45%, transparent);
  }
}

:global(html.dark) .no-agent-badge {
  color: #dadce0;
  background: color-mix(in srgb, #9aa0a6 28%, #1a1a1d);
}
</style>
