<script setup lang="ts">
/**
 * 全部主机概览分组节点。
 * 单击高亮、双击打开；标题区表格/看板入口与分组管理菜单；底部可新建子分组 drop 区。
 */
import HostCard from "@/components/HostCard.vue";
import { groupColor, type GroupColor } from "@/components/sidebar/groupColors";
import type { sshconfig } from "@/api";
import {
  summarizeFleet,
  type FleetHostStatus,
  type FleetReach,
} from "@/composables/useFleetStatus";
import {
  NEW_CHILD_DROP_PREFIX,
  useInjectedHostDrag,
} from "@/composables/useHostDrag";
import {
  MAX_GROUP_DEPTH,
  UNGROUPED_ID,
  useAppStore,
} from "@/stores/app";
import { formatErr } from "@/utils/format";
import { Grid, Monitor, MoreFilled } from "@element-plus/icons-vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { computed, ref } from "vue";

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

const app = useAppStore();
const {
  dragState,
  dropTargetId,
  suppressClick,
  onHostPointerDown,
  onGroupPointerDown,
} = useInjectedHostDrag();

const color: GroupColor = groupColor(props.node.key, props.node.rootIndex);

const isUngrouped = computed(() => props.node.key === UNGROUPED_ID);

const canCreateChild = computed(() => {
  if (isUngrouped.value) return false;
  return props.node.depth < MAX_GROUP_DEPTH;
});

const hasParent = computed(() => {
  if (isUngrouped.value) return false;
  const g = app.groupList.find((x) => x.id === props.node.key);
  return !!(g?.parentId || "").trim();
});

const newChildDropId = computed(
  () => NEW_CHILD_DROP_PREFIX + props.node.key
);

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

/** 单击仅做卡片高亮（本组件内局部状态，递归分组各自独立） */
const selectedHost = ref<string | null>(null);

function onCardClick(name: string) {
  if (suppressClick.value) return;
  selectedHost.value = name;
}

function onCardDblClick(name: string) {
  if (suppressClick.value) return;
  emit("open-host", name);
}

async function onRename() {
  if (isUngrouped.value) return;
  try {
    const { value } = await ElMessageBox.prompt("请输入新的分组名称", "重命名", {
      inputValue: props.node.title,
      confirmButtonText: "确定",
      cancelButtonText: "取消",
      inputPattern: /\S+/,
      inputErrorMessage: "名称不能为空",
    });
    const next = (value || "").trim();
    if (!next || next === props.node.title) return;
    await app.renameGroup(props.node.key, next);
    ElMessage.success("已重命名");
  } catch (e) {
    if (e === "cancel" || e === "close") return;
    ElMessage.error(`重命名失败: ${formatErr(e)}`);
  }
}

async function onCreateChild() {
  if (!canCreateChild.value) return;
  try {
    const { value } = await ElMessageBox.prompt(
      `在「${props.node.title}」下新建子分组`,
      "新建子分组",
      {
        confirmButtonText: "创建",
        cancelButtonText: "取消",
        inputPattern: /\S+/,
        inputErrorMessage: "名称不能为空",
      }
    );
    const name = (value || "").trim();
    if (!name) return;
    await app.createGroup(name, props.node.key);
    ElMessage.success("已创建子分组");
  } catch (e) {
    if (e === "cancel" || e === "close") return;
    ElMessage.error(`创建失败: ${formatErr(e)}`);
  }
}

async function onMoveToRoot() {
  if (!hasParent.value) return;
  try {
    await app.moveGroup(props.node.key, "");
    ElMessage.success("已移到顶层");
  } catch (e) {
    ElMessage.error(`移动失败: ${formatErr(e)}`);
  }
}

async function onRelease() {
  if (isUngrouped.value) return;
  try {
    await ElMessageBox.confirm(
      "释放后主机回到未分组，分组本身删除",
      `释放分组「${props.node.title}」`,
      {
        type: "warning",
        confirmButtonText: "释放",
        cancelButtonText: "取消",
        confirmButtonClass: "el-button--danger",
      }
    );
  } catch {
    return;
  }
  try {
    await app.deleteGroup(props.node.key);
    ElMessage.success(`已释放分组 ${props.node.title}`);
  } catch (e) {
    ElMessage.error(`释放失败: ${formatErr(e)}`);
  }
}

function onMenuCommand(cmd: string) {
  if (cmd === "rename") void onRename();
  else if (cmd === "create-child") void onCreateChild();
  else if (cmd === "move-root") void onMoveToRoot();
  else if (cmd === "release") void onRelease();
}
</script>

<template>
  <section
    class="group-branch"
    :class="{
      'is-nested': nested,
      'is-drop-target': dropTargetId === node.key,
      'is-drag-source':
        dragState?.kind === 'group' && dragState.id === node.key,
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
        v-if="!isUngrouped"
        class="group-drag-handle"
        data-drag-group
        title="拖动以调整分组层级"
        @pointerdown.stop="onGroupPointerDown($event, node.key, node.title)"
      >
        ⠿
      </span>
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
          class="group-head-icon-btn"
          v-tip="'打开分组表格页'"
          @click.stop="emit('open-group', node.key, node.title)"
        >
          <el-icon :size="14"><Grid /></el-icon>
          <span>表格</span>
        </button>
        <button
          type="button"
          class="group-head-icon-btn"
          v-tip="'打开看板窗口'"
          @click.stop="emit('open-board', node.key)"
        >
          <el-icon :size="14"><Monitor /></el-icon>
          <span>看板</span>
        </button>
        <el-dropdown
          v-if="!isUngrouped"
          trigger="click"
          @command="onMenuCommand"
        >
          <button
            type="button"
            class="group-head-icon-btn is-more"
            v-tip="'分组管理'"
            @click.stop
          >
            <el-icon :size="16"><MoreFilled /></el-icon>
          </button>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item command="rename">重命名</el-dropdown-item>
              <el-dropdown-item
                v-if="canCreateChild"
                command="create-child"
              >
                新建子分组
              </el-dropdown-item>
              <el-dropdown-item
                v-if="hasParent"
                command="move-root"
              >
                移到顶层
              </el-dropdown-item>
              <el-dropdown-item
                command="release"
                divided
                style="color: var(--el-color-danger)"
              >
                释放分组
              </el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
      </span>
    </div>

    <div
      v-if="node.hosts.length === 0 && node.children.length === 0"
      class="group-empty"
    >
      该分组暂无主机
    </div>

    <div v-if="node.hosts.length > 0" class="host-grid">
      <HostCard
        v-for="h in node.hosts"
        :key="h.name"
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

    <div
      v-if="canCreateChild"
      class="new-child-drop"
      :class="{ 'is-drop-target': dropTargetId === newChildDropId }"
      :data-drop-new-child="node.key"
    >
      拖到这里新建子分组
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

  &.is-drag-source {
    opacity: 0.55;
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

.group-drag-handle {
  flex-shrink: 0;
  width: 18px;
  height: 22px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  line-height: 1;
  letter-spacing: -1px;
  color: var(--group-ink, var(--m3-on-surface-variant));
  opacity: 0.45;
  cursor: grab;
  user-select: none;
  border-radius: 4px;
  touch-action: none;

  &:hover {
    opacity: 0.85;
    background: var(--group-soft, rgba(0, 0, 0, 0.05));
  }

  &:active {
    cursor: grabbing;
  }
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

.group-head-icon-btn {
  appearance: none;
  border: none;
  background: transparent;
  padding: 3px 8px;
  font-size: 12px;
  font-weight: 600;
  line-height: 20px;
  color: var(--group-ink, var(--m3-primary));
  opacity: 0.82;
  cursor: pointer;
  border-radius: 8px;
  display: inline-flex;
  align-items: center;
  gap: 4px;

  &:hover {
    opacity: 1;
    background: var(--group-soft, rgba(0, 0, 0, 0.05));
  }

  &.is-more {
    padding: 3px 6px;
  }
}

.group-empty {
  font-size: 12px;
  color: var(--el-text-color-placeholder);
  padding: 4px 0 8px;
}

.new-child-drop {
  margin-top: 14px;
  padding: 10px 12px;
  border: 1.5px dashed
    color-mix(in srgb, var(--group-accent, var(--m3-outline)) 55%, transparent);
  border-radius: 8px;
  font-size: 12px;
  font-weight: 500;
  color: var(--group-ink, var(--el-text-color-secondary));
  opacity: 0.72;
  text-align: center;
  transition:
    opacity 0.15s ease,
    background-color 0.15s ease,
    border-color 0.15s ease;

  &.is-drop-target {
    opacity: 1;
    background: color-mix(
      in srgb,
      var(--group-accent, var(--m3-primary)) 12%,
      transparent
    );
    border-color: var(--group-accent, var(--m3-primary));
    border-style: solid;
  }
}

.host-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 14px;
}
</style>
