<template>
  <div
    ref="tabsClipRef"
    class="main-tabs-bar drag-region"
    :class="{
      'is-mac-pad': false,
    }"
    role="tablist"
    aria-label="会话标签"
  >
    <button
      type="button"
      class="main-tab main-tab--pin no-drag"
      :class="{ 'is-active': !app.activeSessionId }"
      role="tab"
      :aria-selected="!app.activeSessionId"
      @click="app.goHome()"
    >
      <span class="main-tab__label">主机首页</span>
    </button>
    <button
      v-for="(s, idx) in app.workspaceSessions"
      v-show="!hiddenIds.includes(s.id)"
      :key="s.id"
      type="button"
      class="main-tab no-drag"
      :class="{
        'is-active': s.id === app.activeSessionId,
        'is-dragging': dragFrom === idx,
      }"
      role="tab"
      :aria-selected="s.id === app.activeSessionId"
      draggable="true"
      @click="app.activateWorkspaceSession(s.id)"
      @auxclick.middle.prevent="app.closeWorkspaceSession(s.id)"
      @contextmenu.prevent="onCtx($event, s.id)"
      @dragstart="onDragStart(idx, s, $event)"
      @dragover.prevent="onDragOver($event)"
      @drop.prevent="onDrop(idx)"
      @dragend="dragFrom = -1"
    >
      <span class="main-tab__label">{{ tabLabel(s) }}</span>
      <span
        class="main-tab__close"
        title="关闭主机页，终端会话会保留"
        @click.stop="app.closeWorkspaceSession(s.id)"
      >
        <el-icon><Close /></el-icon>
      </span>
    </button>
    <div v-if="hiddenIds.length" class="tab-more no-drag">
      <button
        type="button"
        class="main-tab main-tab--more"
        :aria-expanded="moreOpen"
        @click.stop="moreOpen = !moreOpen"
      >
        更多 {{ hiddenIds.length }}
      </button>
      <div v-if="moreOpen" class="tab-ctx tab-ctx--more" @click.stop>
        <button
          v-for="s in overflowSessions"
          :key="s.id"
          type="button"
          class="ctx-item"
          :class="{ 'is-active': s.id === app.activeSessionId }"
          @click="pickOverflow(s.id)"
        >
          {{ tabLabel(s) }}
        </button>
      </div>
    </div>

    <div
      v-if="ctx"
      class="tab-ctx"
      :style="{ left: ctx.x + 'px', top: ctx.y + 'px' }"
      @click.stop
    >
      <button type="button" class="ctx-item" @click="onRename">重命名</button>
      <button type="button" class="ctx-item ctx-item--danger" @click="onCloseCtx">关闭主机页</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { ElMessageBox } from "element-plus";
import { Close } from "@element-plus/icons-vue";
import { useAppStore, type WorkspaceSession } from "@/stores/app";

const app = useAppStore();
const tabsClipRef = ref<HTMLElement | null>(null);
const dragFrom = ref(-1);
const ctx = ref<{ id: string; x: number; y: number } | null>(null);
const moreOpen = ref(false);
const hiddenIds = ref<string[]>([]);
const overflowSessions = computed(() =>
  app.workspaceSessions.filter((s) => hiddenIds.value.includes(s.id))
);

function tabLabel(s: WorkspaceSession): string {
  return s.title || s.host;
}

function tabWidth(title: string): number {
  const chars = Array.from(title || "").length;
  return Math.min(220, 88 + chars * 12);
}

function layoutTabs() {
  const root = tabsClipRef.value;
  if (!root) return;
  const width = root.clientWidth;
  const list = app.workspaceSessions;
  const homeW = 108;
  const widths = list.map((s) => tabWidth(tabLabel(s)));
  const total = widths.reduce((sum, n) => sum + n, homeW);
  const reserve = total > width ? 88 : 0;
  let used = homeW + reserve;
  const visible: string[] = [];
  const hidden: string[] = [];
  for (let i = 0; i < list.length; i += 1) {
    const w = widths[i];
    const id = list[i].id;
    if (used + w <= width) {
      used += w;
      visible.push(id);
    } else {
      hidden.push(id);
    }
  }
  const active = app.activeSessionId;
  if (active && hidden.includes(active)) {
    const last = visible.pop();
    if (last) hidden.unshift(last);
    const at = hidden.indexOf(active);
    if (at >= 0) hidden.splice(at, 1);
    visible.push(active);
  }
  hiddenIds.value = hidden;
  if (hidden.length === 0) moreOpen.value = false;
}

function onWinResize() {
  layoutTabs();
}

onMounted(() => {
  document.addEventListener("click", closeCtx);
  window.addEventListener("resize", onWinResize);
  void nextTick(layoutTabs);
});
onBeforeUnmount(() => {
  document.removeEventListener("click", closeCtx);
  window.removeEventListener("resize", onWinResize);
});

watch(
  () => app.workspaceSessions.map((s) => s.id + s.title).join("|"),
  () => {
    void nextTick(layoutTabs);
  }
);

function pickOverflow(id: string) {
  moreOpen.value = false;
  app.activateWorkspaceSession(id);
}

function onDragStart(fromIndex: number, sess: WorkspaceSession, e: DragEvent) {
  dragFrom.value = fromIndex;
  if (!e.dataTransfer) return;
  e.dataTransfer.effectAllowed = "move";
  e.dataTransfer.setData("text/plain", String(fromIndex));
  e.dataTransfer.setData("application/x-term-session", sess.id);
  e.dataTransfer.setData("application/x-term-host", sess.host);
}

function onDragOver(e: DragEvent) {
  if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
}

function onDrop(toIndex: number) {
  if (dragFrom.value < 0) return;
  app.reorderWorkspaceSession(dragFrom.value, toIndex);
  dragFrom.value = -1;
}

function onCtx(e: MouseEvent, id: string) {
  ctx.value = { id, x: e.clientX, y: e.clientY };
}

function closeCtx() {
  ctx.value = null;
  moreOpen.value = false;
}

function onCloseCtx() {
  if (ctx.value) app.closeWorkspaceSession(ctx.value.id);
  ctx.value = null;
}

async function onRename() {
  const id = ctx.value?.id;
  ctx.value = null;
  if (!id) return;
  const sess = app.workspaceSessions.find((s) => s.id === id);
  if (!sess) return;
  try {
    const { value } = await ElMessageBox.prompt("标签名称", "重命名", {
      inputValue: sess.title,
      confirmButtonText: "确定",
      cancelButtonText: "取消",
      inputValidator: (v) => (v || "").trim().length > 0 || "名称不能为空",
    });
    app.setWorkspaceSessionTitle(id, (value || "").trim(), true);
  } catch {
    /* 取消 */
  }
}
</script>

<style scoped lang="scss">
.main-tabs-bar {
  flex-shrink: 0;
  display: flex;
  align-items: stretch;
  gap: 0;
  height: 40px;
  min-height: 40px;
  max-height: 40px;
  padding: 0;
  box-sizing: border-box;
  overflow: visible;
  background: var(--m3-content);
  border-bottom: 1px solid var(--m3-outline-variant);
  scrollbar-width: thin;

  &.is-mac-pad {
    padding-left: 78px;
  }

  &.is-terminal {
    background: #000;
    border-bottom-color: #2a2a2a;

    .main-tab {
      color: #bdbdbd;
      background: transparent;
      box-shadow: inset -1px 0 0 #2a2a2a;

      &:hover {
        color: #fff;
        background: rgba(255, 255, 255, 0.06);
      }

      &.is-active {
        color: #fff;
        background: #1a1a1a;
        box-shadow: inset -1px 0 0 #2a2a2a;
      }
    }

    .main-tab__idx {
      color: inherit;
    }
  }
}

.main-tab {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  max-width: 220px;
  height: 100%;
  padding: 0 14px;
  border: 0;
  border-radius: 0;
  background: transparent;
  box-shadow: inset -1px 0 0 var(--m3-outline-variant);
  color: var(--m3-on-surface-variant);
  font: var(--m3-title-small);
  cursor: pointer;
  user-select: none;
  box-sizing: border-box;

  &:hover {
    color: var(--m3-on-surface);
    background: color-mix(in srgb, var(--m3-on-surface) 4%, transparent);
  }

  &.is-active {
    color: var(--m3-nav-active-fg);
    background: var(--m3-nav-active-bg);
    font-weight: 600;

    .main-tab__idx {
      color: var(--m3-primary);
    }
  }

  &:focus-visible {
    outline: 2px solid var(--m3-primary);
    outline-offset: -2px;
  }

  &.is-dragging {
    opacity: 0.45;
  }
}

@media (max-width: 900px) {
  .main-tab {
    max-width: 148px;
    padding: 0 10px;
  }
}

.main-tab--pin,
.main-tab--more {
  flex-shrink: 0;
}

.tab-more {
  position: relative;
  flex-shrink: 0;
  display: flex;
  align-items: stretch;
}

.tab-ctx--more {
  position: absolute;
  top: 100%;
  right: 0;
  left: auto;
  z-index: 8;
  min-width: 180px;
  max-height: 280px;
  overflow: auto;
}

.main-tab__idx {
  flex-shrink: 0;
  color: var(--m3-on-surface-variant);
  font-size: 12px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.main-tab__label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.main-tab__close {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  margin-right: -4px;
  border-radius: 0;
  font-size: 12px;
  opacity: 0.55;

  .el-icon {
    font-size: 12px;
  }

  &:hover {
    opacity: 1;
    background: color-mix(in srgb, var(--m3-on-surface) 12%, transparent);
  }
}

.tab-ctx {
  position: fixed;
  z-index: 40;
  min-width: 140px;
  padding: 4px;
  background: var(--m3-surface);
  border: 1px solid var(--m3-outline-variant);
  border-radius: 8px;
}

.ctx-item {
  display: block;
  width: 100%;
  padding: 6px 10px;
  border: 0;
  background: transparent;
  text-align: left;
  cursor: pointer;
  &:hover {
    background: color-mix(in srgb, var(--m3-primary) 8%, transparent);
  }
}

.ctx-item--danger {
  color: var(--m3-error);
}
</style>
