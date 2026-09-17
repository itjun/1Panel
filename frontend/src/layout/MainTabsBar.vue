<template>
  <div ref="tabsClipRef" class="main-tabs-bar" role="tablist" aria-label="主区标签">
    <button
      type="button"
      class="main-tab main-tab--home"
      :class="{ 'is-active': isHomeActive }"
      role="tab"
      :aria-selected="isHomeActive"
      @click="app.goHome()"
    >
      <span class="main-tab__label">全部主机</span>
    </button>

    <button
      v-for="(gid, gIdx) in app.visitedGroupIds"
      :key="'g:' + gid"
      type="button"
      class="main-tab main-tab--group"
      :class="{
        'is-active': isGroupActive(gid),
        'is-dragging': drag?.kind === 'group' && drag.fromIndex === gIdx,
      }"
      role="tab"
      :aria-selected="isGroupActive(gid)"
      draggable="true"
      @click="app.openGroupTab(gid, app.groupNameOf(gid))"
      @auxclick.middle.prevent="app.closeGroupTab(gid)"
      @dragstart="onDragStart('group', gIdx, $event)"
      @dragover.prevent="onDragOver('group', gIdx, $event)"
      @drop.prevent="onDrop('group', gIdx)"
      @dragend="onDragEnd"
    >
      <span class="main-tab__idx">{{ gIdx + 1 }}</span>
      <span class="main-tab__label">{{ app.groupNameOf(gid) }}</span>
      <span
        class="main-tab__close"
        title="关闭"
        @click.stop="app.closeGroupTab(gid)"
      >
        ✕
      </span>
    </button>

    <button
      v-for="(name, hIdx) in app.runningHosts"
      :key="'h:' + name"
      type="button"
      class="main-tab main-tab--host"
      :class="{
        'is-active': isHostActive(name),
        'is-dragging': drag?.kind === 'host' && drag.fromIndex === hIdx,
      }"
      role="tab"
      :aria-selected="isHostActive(name)"
      draggable="true"
      @click="app.openHostTab(name)"
      @auxclick.middle.prevent="app.stopHost(name)"
      @dragstart="onDragStart('host', hIdx, $event)"
      @dragover.prevent="onDragOver('host', hIdx, $event)"
      @drop.prevent="onDrop('host', hIdx)"
      @dragend="onDragEnd"
    >
      <span class="main-tab__idx">{{ app.visitedGroupIds.length + hIdx + 1 }}</span>
      <span class="main-tab__dot" :class="hostDotClass(name)" />
      <span class="main-tab__label">{{ name }}</span>
      <span
        class="main-tab__close"
        title="关闭"
        @click.stop="app.stopHost(name)"
      >
        ✕
      </span>
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useAppStore } from "@/stores/app";
import { useFleetStatus } from "@/composables/useFleetStatus";
import { tabBarIsFull } from "@/composables/useTabStrip";

const app = useAppStore();

const tabsClipRef = ref<HTMLElement | null>(null);

/** 再塞一个与末枚同宽的标签是否会溢出栏宽（「全部主机」固定项也占宽，一并计入） */
function isFull(): boolean {
  return tabBarIsFull(tabsClipRef.value, ".main-tab");
}

onMounted(() => {
  app.registerTabBarFullChecker(isFull);
});

onBeforeUnmount(() => {
  app.registerTabBarFullChecker(null);
});

const fleetEnabled = computed(
  () => app.workspace === "remote" && !app.settingsOpen
);
const { statusByHost } = useFleetStatus({ enabled: fleetEnabled });

const isHomeActive = computed(
  () => !app.settingsOpen && app.workspace === "remote" && !app.activeView
);

function isGroupActive(id: string): boolean {
  return (
    !app.settingsOpen &&
    app.activeView?.kind === "group" &&
    app.activeView.id === id
  );
}

function isHostActive(name: string): boolean {
  return (
    !app.settingsOpen &&
    app.activeView?.kind === "host" &&
    app.activeView.id === name
  );
}

function hostDotClass(name: string): string {
  const reach = statusByHost.value.get(name)?.reach;
  if (reach === "online") return "is-online";
  if (reach === "no_agent") return "is-no-agent";
  if (reach === "ssh_down") return "is-ssh-down";
  return "is-unknown";
}

type DragKind = "group" | "host";
const drag = ref<{ kind: DragKind; fromIndex: number } | null>(null);

function onDragStart(kind: DragKind, fromIndex: number, e: DragEvent) {
  drag.value = { kind, fromIndex };
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", `${kind}:${fromIndex}`);
  }
}

function onDragOver(kind: DragKind, _toIndex: number, e: DragEvent) {
  if (!drag.value || drag.value.kind !== kind) return;
  if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
}

function onDrop(kind: DragKind, toIndex: number) {
  if (!drag.value || drag.value.kind !== kind) return;
  const fromIndex = drag.value.fromIndex;
  drag.value = null;
  if (kind === "host") {
    app.reorderRunningHost(fromIndex, toIndex);
  } else {
    app.reorderVisitedGroup(fromIndex, toIndex);
  }
}

function onDragEnd() {
  drag.value = null;
}
</script>

<style scoped lang="scss">
.main-tabs-bar {
  flex-shrink: 0;
  display: flex;
  align-items: stretch;
  gap: 2px;
  height: 36px;
  min-height: 36px;
  max-height: 36px;
  padding: 0 8px;
  box-sizing: border-box;
  overflow-x: auto;
  overflow-y: hidden;
  background: var(--m3-content);
  border-bottom: 1px solid var(--m3-outline-variant);
  scrollbar-width: thin;
}

.main-tab {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 180px;
  height: 100%;
  padding: 0 10px;
  border: 0;
  border-radius: 0;
  background: transparent;
  color: var(--m3-on-surface-variant);
  font: var(--m3-label-medium);
  cursor: pointer;
  user-select: none;
  border-bottom: 2px solid transparent;
  box-sizing: border-box;

  &:hover {
    color: var(--m3-on-surface);
    background: color-mix(in srgb, var(--m3-primary) 6%, transparent);
  }

  &.is-active {
    color: var(--m3-primary);
    border-bottom-color: var(--m3-primary);
  }

  &.is-dragging {
    opacity: 0.45;
  }
}

.main-tab__idx {
  flex-shrink: 0;
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  color: var(--m3-on-surface-variant);
  opacity: 0.7;
}

.main-tab.is-active .main-tab__idx {
  color: var(--m3-primary);
  opacity: 1;
}

.main-tab__label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.main-tab__dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex-shrink: 0;
  background: #9aa0a6;

  &.is-online {
    background: #1e8e3e;
  }
  &.is-no-agent {
    background: #f9ab00;
  }
  &.is-ssh-down {
    background: #d93025;
  }
  &.is-unknown {
    background: #9aa0a6;
  }
}

.main-tab__close {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  margin-left: 2px;
  border-radius: var(--m3-shape-xs);
  font-size: 10px;
  line-height: 1;
  color: var(--m3-on-surface-variant);
  opacity: 0.55;

  &:hover {
    opacity: 1;
    background: color-mix(in srgb, var(--m3-on-surface) 10%, transparent);
    color: var(--m3-on-surface);
  }
}

.main-tab:hover .main-tab__close,
.main-tab.is-active .main-tab__close {
  opacity: 0.85;
}
</style>
