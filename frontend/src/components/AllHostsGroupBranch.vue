<script setup lang="ts">
/**
 * 全部主机概览分组节点（仅一层分组，不支持嵌套）。
 * 单击高亮、双击打开；标题区表格/看板入口与分组管理菜单；
 * 仅主机可拖拽迁组/置顶；支持折叠（localStorage）。
 */
import HostCard from "@/components/HostCard.vue";
import { groupColor } from "@/components/sidebar/groupColors";
import type { sshconfig } from "@/api";
import {
  summarizeFleet,
  type FleetHostStatus,
  type FleetReach,
} from "@/composables/useFleetStatus";
import { useInjectedHostDrag } from "@/composables/useHostDrag";
import { UNGROUPED_ID } from "@/stores/app";
import { ArrowRight } from "@element-plus/icons-vue";
import { computed, onBeforeUnmount, onMounted, ref } from "vue";

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

const COLLAPSED_KEY_PREFIX = "allhosts.collapsed.";

function collapsedStorageKey(groupId: string): string {
  return COLLAPSED_KEY_PREFIX + groupId;
}

function readCollapsed(groupId: string): boolean {
  try {
    return localStorage.getItem(collapsedStorageKey(groupId)) === "1";
  } catch {
    return false;
  }
}

function writeCollapsed(groupId: string, value: boolean) {
  try {
    if (value) {
      localStorage.setItem(collapsedStorageKey(groupId), "1");
    } else {
      localStorage.removeItem(collapsedStorageKey(groupId));
    }
  } catch {
    /* ignore quota / private mode */
  }
}

const props = defineProps<{
  node: HostGroupTreeNode;
  nested: boolean;
  /** 整页唯一选中的主机名；由父组件统一管理 */
  selectedHost: string | null;
  isRunning: (name: string) => boolean;
  osRelease: (name: string) => string;
  statusByHost: Map<string, FleetHostStatus>;
}>();

const emit = defineEmits<{
  (e: "select-host", name: string): void;
  (e: "open-host", name: string): void;
  (e: "refresh-icon", name: string): void;
  (e: "open-group", id: string, title: string): void;
  (e: "open-board", id: string): void;
  (e: "host-context", ev: MouseEvent, name: string): void;
  (e: "group-context", ev: MouseEvent, id: string, title: string): void;
}>();

const {
  dragState,
  dropTargetId,
  suppressClick,
  onHostPointerDown,
} = useInjectedHostDrag();

const isUngrouped = computed(() => props.node.key === UNGROUPED_ID);

/** 分组区分色：选中高亮/拖拽反馈使用分组自己的颜色（与侧栏文字同色） */
const color = computed(() =>
  groupColor(props.node.key, props.node.rootIndex)
);

const collapsed = ref(readCollapsed(props.node.key));

function toggleCollapsed() {
  collapsed.value = !collapsed.value;
  writeCollapsed(props.node.key, collapsed.value);
}

function onExpandGroupEvent(ev: Event) {
  const detail = (ev as CustomEvent<{ ids?: string[] }>).detail;
  const ids = detail?.ids;
  if (!ids || !ids.includes(props.node.key)) return;
  if (!collapsed.value) return;
  collapsed.value = false;
  writeCollapsed(props.node.key, false);
}

onMounted(() => {
  window.addEventListener("allhosts:expand-group", onExpandGroupEvent);
});

onBeforeUnmount(() => {
  window.removeEventListener("allhosts:expand-group", onExpandGroupEvent);
});

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

/** 单击高亮：交给父组件统一选中，保证整页只有一张卡高亮 */
function onCardClick(name: string) {
  if (suppressClick.value) return;
  emit("select-host", name);
}

function onCardDblClick(name: string) {
  if (suppressClick.value) return;
  emit("open-host", name);
}

/** 分组标题右键：交给父组件统一弹出分组菜单（打开/看板/设置/添加主机/删除） */
function onHeadContext(ev: MouseEvent) {
  if (isUngrouped.value) return;
  emit("group-context", ev, props.node.key, props.node.title);
}
</script>

<template>
  <section
    class="group-branch"
    :class="{
      'is-nested': nested,
      'is-collapsed': collapsed,
      'is-drop-target': dropTargetId === node.key,
    }"
    :data-group-anchor="node.key"
    :data-drop-group="node.key"
    :style="{
      '--group-accent': color.accent,
    }"
  >
    <div
      class="group-branch__head"
      @contextmenu.prevent="onHeadContext"
    >
      <button
        type="button"
        class="group-fold-btn"
        :class="{ 'is-expanded': !collapsed }"
        :aria-expanded="!collapsed"
        v-tip="collapsed ? '展开分组' : '折叠分组'"
        @click.stop="toggleCollapsed"
      >
        <el-icon :size="12"><ArrowRight /></el-icon>
      </button>
      <span class="group-name" :class="{ 'is-nested-name': nested }">
        {{ node.title }}
      </span>
      <span class="group-count">
        {{ node.totalCount }}
      </span>
      <span
        v-if="node.hostNames.length > 0"
        class="group-fleet-summary"
      >
        {{ fleetSummaryText }}
      </span>
    </div>

    <div
      v-if="!collapsed && node.hosts.length === 0 && node.children.length === 0"
      class="group-empty"
    >
      该分组暂无主机
    </div>

    <div v-if="!collapsed && node.hosts.length > 0" class="host-grid">
      <HostCard
        v-for="h in node.hosts"
        :key="h.name"
        dense
        :host="h"
        :reach="hostReach(h.name)"
        :os-release="osRelease(h.name)"
        :running="isRunning(h.name)"
        :selected="selectedHost === h.name"
        :drag-source="dragState?.kind === 'host' && dragState.id === h.name"
        @pointerdown="onHostPointerDown($event, h.name)"
        @click="onCardClick(h.name)"
        @dblclick="onCardDblClick(h.name)"
        @contextmenu="emit('host-context', $event, h.name)"
        @refresh-icon="emit('refresh-icon', h.name)"
      />
    </div>

    <!-- 历史嵌套数据兼容展示（启动时后端会拍平，正常为空） -->
    <div v-if="!collapsed && node.children.length > 0" class="nest-stack">
      <AllHostsGroupBranch
        v-for="child in node.children"
        :key="child.key"
        :node="child"
        nested
        :selected-host="selectedHost"
        :is-running="isRunning"
        :os-release="osRelease"
        :status-by-host="statusByHost"
        @select-host="(n) => emit('select-host', n)"
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
  padding: 12px 14px 14px;
  border-radius: 12px;
  /* 灰画布上不再铺区块底色，白卡直接浮在灰底上 */
  background: transparent;
  transition: box-shadow 0.35s ease, background-color 0.35s ease;

  &.is-collapsed {
    padding-bottom: 10px;
  }

  /* 点击定位后的持续高亮：用分组自己的颜色，鼠标移出区块才取消 */
  &.is-group-flash {
    background: color-mix(in srgb, var(--group-accent) 10%, transparent);
    box-shadow: inset 0 0 0 1.5px
      color-mix(in srgb, var(--group-accent) 45%, transparent);
  }

  &.is-drop-target {
    background: color-mix(in srgb, var(--group-accent) 12%, transparent);
    outline: 2px dashed var(--group-accent);
    outline-offset: 2px;
  }

}

.group-branch.is-nested {
  margin-left: 6px;
  padding: 4px 0 4px 12px;
  border-radius: 6px;
  border-left: 2px solid
    color-mix(in srgb, var(--m3-outline, #938f99) 70%, transparent);
  background: transparent;

  &.is-collapsed {
    padding-bottom: 4px;
  }

  &.is-group-flash {
    background: color-mix(in srgb, var(--group-accent) 8%, transparent);
  }

  &.is-drop-target {
    background: color-mix(in srgb, var(--group-accent) 10%, transparent);
  }
}

.group-branch__head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
  min-height: 24px;
  min-width: 0;

  .group-branch.is-collapsed & {
    margin-bottom: 0;
  }

}

.group-fold-btn {
  appearance: none;
  border: none;
  background: transparent;
  flex-shrink: 0;
  width: 18px;
  height: 18px;
  padding: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--m3-on-surface-variant);
  opacity: 0.65;
  cursor: pointer;
  border-radius: 4px;

  .el-icon {
    transition: transform 0.15s ease;
  }

  &.is-expanded .el-icon {
    transform: rotate(90deg);
  }

  &:hover {
    opacity: 1;
    background: color-mix(in srgb, var(--m3-on-surface, #000) 6%, transparent);
  }
}

.nest-stack {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 10px;
}

.group-name {
  font-size: 15px;
  font-weight: 650;
  letter-spacing: 0.02em;
  line-height: 1.3;
  flex-shrink: 0;

  &.is-nested-name {
    font-size: 13px;
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
  flex-shrink: 0;
  color: var(--m3-on-surface-variant);
  background: color-mix(in srgb, var(--m3-on-surface, #000) 6%, transparent);
}

.group-fleet-summary {
  font-size: 12px;
  font-weight: 500;
  color: var(--m3-on-surface-variant);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}

.group-empty {
  font-size: 12px;
  color: var(--el-text-color-placeholder);
  padding: 2px 0 4px;
}

.host-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(228px, 1fr));
  gap: 10px;
}
</style>
