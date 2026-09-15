<template>
  <el-sub-menu
    :index="nodeKey"
    class="group-sub"
    :class="{
      'is-drop-target': dropTargetId === nodeKey,
      'is-group-active': activeId === nodeKey,
      'is-drag-source':
        dragState?.kind === 'group' && dragState.id === nodeKey,
      'is-root-group': depth === 1 && !!node.group,
    }"
    :style="groupAccentStyle"
  >
    <template #title>
      <div
        class="group-title-row"
        :data-drop-group="nodeKey"
        :style="{ paddingLeft: `${Math.max(depth - 1, 0) * 8}px` }"
        @pointerdown="onTitlePointerDown"
        @click.stop="$emit('open-group', nodeKey, displayName)"
        @contextmenu.prevent="
          $emit('group-context', $event, nodeKey, displayName)
        "
      >
        <span
          class="group-color-dot"
          v-tip="'分组色'"
          :style="{ backgroundColor: color.accent }"
        />
        <el-icon
          class="group-folder-ico"
          :style="{ color: color.accent }"
        >
          <Folder />
        </el-icon>
        <span
          class="menu-title group-name"
          :style="{ color: color.ink }"
        >
          {{ displayName }}
        </span>
        <span
          class="menu-count"
          v-tip="`已打开 ${openedCount} / 共 ${hostCount} 台`"
          :style="{ color: color.ink, backgroundColor: color.soft }"
        >
          {{ countLabel }}
        </span>
      </div>
    </template>

    <!-- 子分组一律在前，本层主机在后，避免夹杂 -->
    <SidebarGroupNode
      v-for="child in node.children"
      :key="child.group!.id"
      :node="child"
      :active-id="activeId"
      :drop-target-id="dropTargetId"
      :drag-state="dragState"
      :is-running="isRunning"
      :os-release="osRelease"
      @open-group="(id, name) => $emit('open-group', id, name)"
      @group-context="(e, id, name) => $emit('group-context', e, id, name)"
      @host-pointer-down="(e, n) => $emit('host-pointer-down', e, n)"
      @host-click="(n) => $emit('host-click', n)"
      @host-dblclick="(n) => $emit('host-dblclick', n)"
      @host-context="(e, n) => $emit('host-context', e, n)"
      @group-pointer-down="(e, id, name) => $emit('group-pointer-down', e, id, name)"
    />

    <el-menu-item
      v-for="(h, hi) in node.hosts"
      :key="h.name"
      :index="h.name"
      class="host-item"
      :class="{
        'is-running': isRunning(h.name),
        'is-drag-source':
          dragState?.kind === 'host' && dragState.id === h.name,
        'is-after-groups': hi === 0 && node.children.length > 0,
      }"
      :style="{ paddingLeft: `${12 + depth * 8}px` }"
      v-tip="isRunning(h.name) ? '双击停止会话' : undefined"
      @pointerdown="$emit('host-pointer-down', $event, h.name)"
      @click="$emit('host-click', h.name)"
      @dblclick.stop="$emit('host-dblclick', h.name)"
      @contextmenu.prevent="$emit('host-context', $event, h.name)"
    >
      <DistroLogo
        :os-release="osRelease(h.name)"
        :size="16"
        class="host-ico"
        :title="osRelease(h.name) || '未识别发行版，打开主机或右键更新图标'"
      />
      <span class="menu-title">{{ h.name }}</span>
      <span
        v-if="isRunning(h.name)"
        class="run-dot"
        v-tip="'运行中（后台保持）'"
        :style="{ backgroundColor: color.accent }"
      />
    </el-menu-item>
  </el-sub-menu>
</template>

<script setup lang="ts">
/**
 * 侧栏递归分组节点：子分组一律在前、本层主机在后；顶层带分组色竖条。
 */
import { computed } from "vue";
import { Folder } from "@element-plus/icons-vue";
import DistroLogo from "@/components/DistroLogo.vue";
import { groupColor } from "@/components/sidebar/groupColors";
import { UNGROUPED_ID, type GroupNode } from "@/stores/app";
import type { DragState } from "@/composables/useHostDrag";

const props = defineProps<{
  node: GroupNode;
  activeId: string;
  dropTargetId: string | null;
  dragState: DragState | null;
  isRunning: (name: string) => boolean;
  osRelease: (name: string) => string;
}>();

const emit = defineEmits<{
  (e: "open-group", id: string, name: string): void;
  (e: "group-context", ev: MouseEvent, id: string, name: string): void;
  (e: "host-pointer-down", ev: PointerEvent, name: string): void;
  (e: "host-click", name: string): void;
  (e: "host-dblclick", name: string): void;
  (e: "host-context", ev: MouseEvent, name: string): void;
  (e: "group-pointer-down", ev: PointerEvent, id: string, name: string): void;
}>();

const depth = computed(() => props.node.depth ?? 0);
const nodeKey = computed(() => props.node.group?.id || UNGROUPED_ID);
const displayName = computed(() => props.node.group?.name || "未分组");
const color = computed(() =>
  groupColor(nodeKey.value, props.node.rootIndex)
);
const hostCount = computed(() => props.node.subtreeHosts.length);
const openedCount = computed(
  () => props.node.subtreeHosts.filter((h) => props.isRunning(h.name)).length
);
const countLabel = computed(() => {
  const opened = openedCount.value;
  const total = hostCount.value;
  return opened > 0 ? `${opened}/${total}` : `${total}`;
});

const groupAccentStyle = computed(() => {
  return {
    "--group-accent": color.value.accent,
    "--group-soft": color.value.soft,
    "--group-ink": color.value.ink,
  } as Record<string, string>;
});

function onTitlePointerDown(e: PointerEvent) {
  if (!props.node.group) return;
  emit("group-pointer-down", e, nodeKey.value, displayName.value);
}
</script>

<style scoped lang="scss">
.group-title-row {
  display: flex;
  align-items: center;
  width: 100%;
  min-width: 0;
  flex: 1;
  gap: 6px;
  min-height: 100%;
  pointer-events: auto;
  cursor: pointer;
  box-sizing: border-box;
}

.group-color-dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  flex-shrink: 0;
}

.group-folder-ico {
  flex-shrink: 0;
}

.group-name {
  font-weight: 600;
}

.menu-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.menu-count {
  margin-left: auto;
  margin-right: 4px;
  font-size: 11px;
  font-weight: 600;
  flex-shrink: 0;
  min-width: 18px;
  height: 18px;
  line-height: 18px;
  text-align: center;
  padding: 0 6px;
  border-radius: 9px;
}

.host-item {
  cursor: grab;
  touch-action: none;

  .host-ico {
    margin-right: 8px;
    opacity: 0.9;
  }

  &:active {
    cursor: grabbing;
  }

  &.is-running .menu-title {
    font-weight: 500;
  }

  &.is-drag-source {
    opacity: 0.45;
  }

  /* 子分组块与本层主机之间留一点空隙 */
  &.is-after-groups {
    margin-top: 6px;
  }
}

.run-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--group-accent, var(--m3-primary));
  flex-shrink: 0;
  margin-left: 6px;
}

/* 标题行铺满，计数顶到箭头左侧 */
:deep(.el-sub-menu__title) {
  display: flex !important;
  align-items: center;

  .group-title-row {
    flex: 1;
    min-width: 0;
  }
}

.is-drop-target > :deep(.el-sub-menu__title) {
  background: color-mix(in srgb, var(--m3-primary) 12%, transparent) !important;
  outline: 2px dashed var(--m3-primary);
  outline-offset: -2px;
  border-radius: 0 8px 8px 0;
}

.is-drag-source > :deep(.el-sub-menu__title) {
  opacity: 0.45;
}

/* 顶层分组竖条：只画在标题行，不贯穿子主机（避免选中主机时左侧再叠一条） */
.is-root-group {
  position: relative;
  box-sizing: border-box;

  > :deep(.el-sub-menu__title) {
    padding-left: 16px !important;

    &::before {
      content: "";
      position: absolute;
      left: 4px;
      top: 10px;
      bottom: 10px;
      width: 4px;
      border-radius: 2px;
      background: var(--group-accent, var(--m3-primary));
      z-index: 1;
      pointer-events: none;
    }
  }
}

/* 分组页选中：soft 底 + 字色；色点保持 accent，计数用白底避免融进 soft */
.is-group-active > :deep(.el-sub-menu__title) {
  background-color: var(--group-soft, var(--m3-sidebar-active-bg)) !important;
  color: var(--group-ink, var(--m3-primary));
  border-radius: 0 8px 8px 0;

  .group-name,
  .group-folder-ico {
    color: var(--group-ink, var(--m3-primary));
  }

  .menu-count {
    color: var(--group-ink, var(--m3-primary)) !important;
    background-color: var(--m3-surface-container-lowest, #fff) !important;
  }
}
</style>

