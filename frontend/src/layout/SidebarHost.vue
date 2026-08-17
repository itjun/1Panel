<template>
  <aside
    class="panel-sidebar"
    :class="{ 'is-resizing': resizing, 'is-host-dragging': !!dragState }"
    :style="{ width: width + 'px' }"
    @contextmenu="onBlankContext"
  >
    <!-- 顶部 header：红绿灯让位后紧挨收起 + 搜索（Cursor 同款左簇） -->
    <div class="sidebar-header drag-region" @dblclick="WindowToggleMaximise()">
      <el-button
        text
        class="sidebar-collapse-btn no-drag"
        title="收起侧栏"
        @click="emit('collapse')"
      >
        <el-icon>
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.75"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <path d="M9 3v18" />
          </svg>
        </el-icon>
      </el-button>
      <el-button
        text
        class="sidebar-search-btn no-drag"
        :class="{ 'is-active': searchActive }"
        :title="searchActive ? '收起搜索' : '搜索主机'"
        @click="toggleSearch"
      >
        <el-icon>
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.75"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.35-4.35" />
          </svg>
        </el-icon>
      </el-button>
    </div>

    <transition name="search-slide">
      <div v-show="searchActive" class="search-box">
      <el-input
        ref="searchInputRef"
        v-model="query"
        clearable
        class="host-search"
        placeholder="搜索主机..."
        @keydown.esc="closeSearch"
      >
        <template #prefix>
          <el-icon>
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.75"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.35-4.35" />
            </svg>
          </el-icon>
        </template>
      </el-input>
      </div>
    </transition>

    <div class="menu-wrap" ref="menuWrapRef">
      <!-- 不用 unique-opened：多分组可同时展开 -->
      <el-menu :default-active="activeId" :default-openeds="openedGroups">
        <!-- 固定首页项：回全部主机概览（与主机项同样走 el-menu 选中逻辑） -->
        <el-menu-item index="__home__" @click="app.goHome()">
          <el-icon><Monitor /></el-icon>
          <span>全部主机</span>
        </el-menu-item>
        <el-sub-menu
          v-for="(node, gIdx) in filtered"
          :key="node.group?.id || UNGROUPED_ID"
          :index="node.group?.id || UNGROUPED_ID"
          class="group-sub"
          :class="{
            'is-drop-target':
              dropTargetId === (node.group?.id || UNGROUPED_ID),
          }"
        >
          <template #title>
            <!-- data-drop-group：指针拖放命中区（整行标题） -->
            <div
              class="group-title-row"
              :data-drop-group="node.group?.id || UNGROUPED_ID"
            >
              <span
                class="group-color-dot"
                title="分组色"
                :style="{
                  backgroundColor: groupColor(
                    node.group?.id || UNGROUPED_ID,
                    gIdx
                  ).accent,
                }"
              />
              <el-icon class="group-folder-ico">
                <Folder />
              </el-icon>
              <span
                class="menu-title group-name"
                @click.stop="
                  openGroup(
                    node.group?.id || UNGROUPED_ID,
                    node.group?.name || '未分组'
                  )
                "
              >
                {{ node.group?.name || "未分组" }}
              </span>
              <span
                class="menu-count"
                :style="{
                  color: groupColor(node.group?.id || UNGROUPED_ID, gIdx).ink,
                  backgroundColor: groupColor(
                    node.group?.id || UNGROUPED_ID,
                    gIdx
                  ).soft,
                }"
              >
                {{ node.hosts.length }}
              </span>
            </div>
          </template>

          <el-menu-item
            v-for="h in node.hosts"
            :key="h.name"
            :index="h.name"
            class="host-item"
            :class="{
              'is-running': app.isRunning(h.name),
              'is-drag-source': dragState?.host === h.name,
            }"
            @pointerdown="onHostPointerDown($event, h.name)"
            @click="onHostClick(h.name)"
            @contextmenu.prevent="onHostContext($event, h.name)"
          >
            <DistroLogo
              :os-release="app.osReleaseMap.get(h.name) || ''"
              :size="16"
              class="host-ico"
              :title="app.osReleaseMap.get(h.name) || '未识别发行版，打开主机或右键更新图标'"
            />
            <span class="menu-title">{{ h.name }}</span>
            <span
              v-if="app.isRunning(h.name)"
              class="run-dot"
              title="运行中（后台保持）"
            />
          </el-menu-item>
        </el-sub-menu>
      </el-menu>
      <div v-if="searchActive && query && filtered.length === 0" class="search-empty">
        无匹配主机
      </div>
    </div>

    <div class="sidebar-footer">
      <div class="host-count">
        共 {{ app.hosts.length }} 台
        <template v-if="app.runningHosts.length">
          · 运行中 {{ app.runningHosts.length }}
        </template>
      </div>
      <div class="drag-hint">拖拽主机到分组标题可调整分组 · 右键空白处可添加</div>
    </div>

    <div
      class="sidebar-resize-handle"
      title="拖动调整宽度；双击自适应"
      @pointerdown="onResizeStart"
      @dblclick="onResizeDblClick"
    />

    <!-- 拖拽幽灵：跟随指针，不依赖 HTML5 DnD（Wails/EP 菜单更稳） -->
    <Teleport to="body">
      <div
        v-if="dragState?.active"
        class="host-drag-ghost"
        :style="{
          left: dragState.x + 12 + 'px',
          top: dragState.y + 12 + 'px',
        }"
      >
        <el-icon><Monitor /></el-icon>
        {{ dragState.host }}
      </div>
    </Teleport>

    <!-- 主机右键菜单（打开/重命名/编辑/删除/迁移分组等在子组件内处理） -->
    <HostContextMenu
      :menu="ctxMenu"
      @close="closeCtxMenu"
      @edit="(host) => editRef?.openFor(host)"
      @move="onCtxMove"
    />

    <!-- 侧栏空白处右键菜单：添加主机 / 新建分组 -->
    <Teleport to="body">
      <div
        v-if="blankCtx"
        class="host-ctx-backdrop"
        @mousedown="blankCtx = null"
        @contextmenu.prevent="blankCtx = null"
      />
      <div
        v-if="blankCtx"
        class="host-ctx-menu"
        :style="{ left: blankCtx.x + 'px', top: blankCtx.y + 'px' }"
        @mousedown.stop
      >
        <button type="button" class="ctx-item" @click="onBlankAddHost">
          添加主机…
        </button>
        <button type="button" class="ctx-item" @click="onBlankCreateGroup">
          新建分组…
        </button>
      </div>
    </Teleport>

    <!-- 编辑主机弹窗 -->
    <EditHostDialog ref="editRef" />
  </aside>
</template>

<script setup lang="ts">
/**
 * 侧栏：主机/分组树、搜索、拖拽分组、右键菜单、宽度调整。
 * 拖拽与调宽逻辑在 composables，右键菜单与编辑弹窗在 components/sidebar。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { WindowToggleMaximise } from "@wailsjs/runtime/runtime";
import { Folder, Monitor } from "@element-plus/icons-vue";
import { ElMessageBox, ElMessage } from "element-plus";
import { useAppStore, UNGROUPED_ID } from "@/stores/app";
import DistroLogo from "@/components/DistroLogo.vue";
import EditHostDialog from "@/components/sidebar/EditHostDialog.vue";
import HostContextMenu, {
  type CtxMenuState,
} from "@/components/sidebar/HostContextMenu.vue";
import { groupColor } from "@/components/sidebar/groupColors";
import { useHostDrag } from "@/composables/useHostDrag";
import { useSidebarResize } from "@/composables/useSidebarResize";

const emit = defineEmits<{
  collapse: [];
  addHost: [];
}>();

const app = useAppStore();
const query = ref("");
/** 搜索框展开态：收起即清空 query（无残留过滤） */
const searchActive = ref(false);
const searchInputRef = ref<{ focus: () => void } | null>(null);
const menuWrapRef = ref<HTMLElement | null>(null);

const { width, resizing, onResizeStart, onResizeDblClick } = useSidebarResize();

const {
  dragState,
  dropTargetId,
  suppressClick,
  onHostPointerDown,
  cancelDrag,
  moveHostToGroup,
} = useHostDrag({ isBlocked: () => resizing.value });

const editRef = ref<InstanceType<typeof EditHostDialog> | null>(null);

/** 无激活主机时选中首页项（与主机项一样由 el-menu 驱动高亮） */
const activeId = computed(() => app.activeTabId || "__home__");

const openedGroups = computed(() =>
  app.groupNodes.map((n) => n.group?.id || UNGROUPED_ID)
);

const filtered = computed(() => {
  const q = query.value.trim().toLowerCase();
  if (!q) return app.groupNodes;
  return app.groupNodes
    .map((n) => ({
      ...n,
      hosts: n.hosts.filter(
        (h) =>
          h.name.toLowerCase().includes(q) ||
          (h.hostName || "").toLowerCase().includes(q)
      ),
    }))
    .filter((n) => n.hosts.length > 0 || !!n.group);
});

function openGroup(id: string, name: string) {
  app.openGroupTab(id, name);
}

/** 展开/收起搜索：展开时聚焦输入框，收起时清空 */
function toggleSearch() {
  if (searchActive.value) {
    closeSearch();
  } else {
    searchActive.value = true;
    nextTick(() => searchInputRef.value?.focus());
  }
}

/** 收起搜索并清空 query（收起即重置） */
function closeSearch() {
  searchActive.value = false;
  query.value = "";
}

function onHostClick(name: string) {
  if (suppressClick.value) return;
  app.openHostTab(name);
  // 打开主机即收起搜索、清空过滤（搜索目的达成）
  closeSearch();
}

// ---------- 主机右键菜单（菜单体在 HostContextMenu） ----------

const ctxMenu = ref<CtxMenuState | null>(null);

function closeCtxMenu() {
  ctxMenu.value = null;
}

function onHostContext(e: MouseEvent, name: string) {
  // 先关掉拖拽态，避免右键后幽灵残留
  cancelDrag();

  // 预估菜单位置，避免贴边溢出（实际 DOM 挂载后再微调）
  const pad = 8;
  let x = e.clientX;
  let y = e.clientY;
  const approxW = 168;
  const approxH = 192;
  if (x + approxW > window.innerWidth - pad) x = window.innerWidth - approxW - pad;
  if (y + approxH > window.innerHeight - pad) y = window.innerHeight - approxH - pad;
  if (x < pad) x = pad;
  if (y < pad) y = pad;

  ctxMenu.value = { host: name, x, y };
}

async function onCtxMove(host: string, groupId: string) {
  await moveHostToGroup(host, groupId || UNGROUPED_ID);
}

/** 侧栏空白处右键：添加主机 / 新建分组 */
const blankCtx = ref<{ x: number; y: number } | null>(null);
function onBlankContext(e: MouseEvent) {
  // 命中主机行/分组标题/按钮/输入框等交互元素时不接管
  const el = (e.target as HTMLElement).closest(
    ".host-item, .el-menu-item, .el-sub-menu__title, button, input, .sidebar-resize-handle"
  );
  if (el) return;
  e.preventDefault();
  blankCtx.value = { x: e.clientX, y: e.clientY };
}
function onBlankAddHost() {
  blankCtx.value = null;
  emit("addHost");
}
function onBlankCreateGroup() {
  blankCtx.value = null;
  void onCreateGroup();
}

// 系统菜单「主机 → 新建分组…」经 store 标志转发到此处弹窗
watch(
  () => app.pendingCreateGroup,
  (v) => {
    if (v) {
      app.pendingCreateGroup = false;
      void onCreateGroup();
    }
  }
);

/** Cmd/Ctrl + 1~9：按侧栏纵向卡片顺序直接打开对应主机 */
function onNumSwitchKeydown(e: KeyboardEvent) {
  if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey) return;
  const n = Number(e.key);
  if (!Number.isInteger(n) || n < 1 || n > 9) return;
  // 用过滤后的列表：与当前看到的纵向卡片顺序一致（搜索时同样生效）
  const list = filtered.value.flatMap((node) => node.hosts);
  const host = list[n - 1];
  if (!host) return;
  e.preventDefault();
  app.openHostTab(host.name);
}

/** / 键唤起搜索：仅当焦点不在输入框/终端时触发 */
function onSearchKeydown(e: KeyboardEvent) {
  if (e.key !== "/" || searchActive.value) return;
  const el = document.activeElement;
  if (!el) return;
  const tag = el.tagName;
  // 焦点在输入类元素：放行（正常输入 /）
  if (tag === "INPUT" || tag === "TEXTAREA") return;
  if (el instanceof HTMLElement && el.isContentEditable) return;
  // 焦点在终端（xterm）：放行（终端输入 /）
  if (el.closest(".xterm-helper-textarea, .terminal-wrap")) return;
  e.preventDefault();
  searchActive.value = true;
  nextTick(() => searchInputRef.value?.focus());
}

function onCtxKeydown(e: KeyboardEvent) {
  if (e.key === "Escape") {
    if (ctxMenu.value) closeCtxMenu();
    blankCtx.value = null;
  }
}

async function onCreateGroup() {
  try {
    const { value } = await ElMessageBox.prompt("分组名称", "新建分组", {
      confirmButtonText: "创建",
      cancelButtonText: "取消",
      inputPattern: /\S+/,
      inputErrorMessage: "名称不能为空",
    });
    const id = await app.createGroup(value.trim());
    ElMessage.success("已创建");
    app.openGroupTab(id, value.trim());
  } catch {
    /* cancel */
  }
}

onMounted(() => {
  window.addEventListener("keydown", onCtxKeydown);
  window.addEventListener("keydown", onSearchKeydown);
  window.addEventListener("keydown", onNumSwitchKeydown);
});

onBeforeUnmount(() => {
  window.removeEventListener("keydown", onCtxKeydown);
  window.removeEventListener("keydown", onSearchKeydown);
  window.removeEventListener("keydown", onNumSwitchKeydown);
});
</script>

<style scoped lang="scss">
.panel-sidebar {
  position: relative;
  min-width: 180px;
  max-width: 320px;
  flex-shrink: 0;

  &:not(.is-resizing) {
    transition: width 0.15s ease;
  }

  &.is-resizing,
  &.is-host-dragging {
    transition: none;
    user-select: none;
  }
}

.sidebar-header {
  flex-shrink: 0;
  /* 与 macOS 隐藏标题栏红绿灯同一行（TitleBarHidden 红绿灯约在 28–32px 带内居中） */
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: 4px;
  padding: 0 8px 0 78px;
  background: transparent;
}

.sidebar-collapse-btn,
.sidebar-search-btn {
  width: 24px;
  height: 24px;
  min-height: 24px;
  padding: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--el-text-color-regular);
  --el-button-hover-text-color: var(--el-text-color-primary);
  --el-button-hover-bg-color: color-mix(
    in srgb,
    var(--el-color-primary) 10%,
    transparent
  );

  :deep(.el-icon) {
    font-size: 18px;
  }
}

.sidebar-search-btn.is-active {
  color: var(--el-color-primary);
}

/* 搜索框展开/收起动画（配合 <transition name="search-slide">） */
.search-slide-enter-active,
.search-slide-leave-active {
  transition: max-height 0.15s ease, opacity 0.15s ease;
}
.search-slide-enter-from,
.search-slide-leave-to {
  max-height: 0;
  opacity: 0;
}

.search-empty {
  padding: 20px 12px;
  text-align: center;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.search-box {
  flex-shrink: 0;
  /* 与顶栏约 48px 视觉对齐：更大内边距 + 默认尺寸输入框 */
  padding: 12px 12px 10px;
  box-sizing: border-box;
  /* 配合 search-slide 动画：max-height 可过渡 */
  max-height: 100px;
  overflow: hidden;
}

.host-search {
  width: 100%;

  :deep(.el-input__wrapper) {
    min-height: 34px;
    padding: 4px 10px;
    border-radius: 8px;
    background: color-mix(in srgb, var(--el-color-primary) 8%, transparent);
    box-shadow: 0 0 0 1px
      color-mix(in srgb, var(--el-color-primary) 14%, transparent) inset;
    transition: box-shadow 0.15s ease, background 0.15s ease;

    &:hover {
      box-shadow: 0 0 0 1px
        color-mix(in srgb, var(--el-color-primary) 28%, transparent) inset;
    }
    &.is-focus {
      background: color-mix(in srgb, var(--el-color-primary) 12%, transparent);
      box-shadow: 0 0 0 1px var(--el-color-primary) inset;
    }
  }

  :deep(.el-input__inner) {
    height: 26px;
    line-height: 26px;
    font-size: 13px;
    color: var(--el-text-color-primary);
  }

  :deep(.el-input__inner::placeholder) {
    color: var(--el-text-color-secondary);
  }

  :deep(.el-input__prefix),
  :deep(.el-input__suffix) {
    font-size: 16px;
    color: var(--el-text-color-regular);
  }
}

/* ---------- 分组标题行内容 ---------- */
.group-title-row {
  display: flex;
  align-items: center;
  width: 100%;
  min-width: 0;
  gap: 6px;
  min-height: 100%;
  pointer-events: auto;
}

.group-color-dot {
  width: 8px;
  height: 8px;
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
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.menu-count {
  margin-left: 6px;
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

/* 主机项：仅保留拖拽与运行态标记，视觉完全走全局 panel-sidebar 样式 */
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
}

.run-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #67c23a;
  flex-shrink: 0;
  margin-left: 6px;
  box-shadow: 0 0 0 2px rgba(103, 194, 58, 0.2);
}

:deep(.el-sub-menu.is-drop-target > .el-sub-menu__title) {
  background: var(--el-color-primary-light-9) !important;
  outline: 2px dashed var(--el-color-primary);
  outline-offset: -2px;
  border-radius: 4px;
}

/* 让标题行内 data-drop-group 区域尽量铺满 */
:deep(.el-sub-menu__title) {
  .group-title-row {
    flex: 1;
    min-width: 0;
  }
}

.host-count {
  margin-top: 6px;
  text-align: center;
  font-size: 11px;
  color: #909399;
}

.drag-hint {
  margin-top: 4px;
  text-align: center;
  font-size: 10px;
  color: #c0c4cc;
}

.sidebar-resize-handle {
  position: absolute;
  top: 0;
  right: 0;
  z-index: 20;
  width: 5px;
  height: 100%;
  cursor: col-resize;
  touch-action: none;

  &::after {
    content: "";
    position: absolute;
    top: 0;
    right: 1px;
    width: 2px;
    height: 100%;
    border-radius: 1px;
    background: transparent;
    transition: background 0.15s ease;
  }

  &:hover::after,
  .is-resizing &::after {
    background: var(--el-color-primary);
    opacity: 0.45;
  }
}
</style>

<style>
/* 幽灵挂 body，非 scoped；右键菜单样式在 HostContextMenu.vue 中统一提供 */
.host-drag-ghost {
  position: fixed;
  z-index: 99999;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border-radius: 6px;
  background: #fff;
  color: #303133;
  font-size: 13px;
  font-weight: 500;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.18);
  border: 1px solid var(--el-color-primary, #005eeb);
  pointer-events: none;
  max-width: 240px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
html.dark .host-drag-ghost {
  background: #2e313d;
  color: #e5eaf3;
}
</style>
