<template>
  <aside
    class="panel-sidebar"
    :class="{ 'is-resizing': resizing, 'is-host-dragging': !!dragState }"
    :style="{ width: width + 'px' }"
    @contextmenu="onBlankContext"
  >
    <div class="menu-wrap" ref="menuWrapRef">
      <!-- 不用 unique-opened：多分组可同时展开 -->
      <el-menu :default-active="activeId" :default-openeds="openedGroups">
        <!-- 固定首页项：回全部主机概览（与主机项同样走 el-menu 选中逻辑） -->
        <el-menu-item index="__home__" @click="app.goHome()">
          <el-icon><Monitor /></el-icon>
          <span class="menu-title">全部主机</span>
          <span
            class="menu-count home-count"
            :title="`已打开 ${openedCount(app.hosts)} / 共 ${app.hosts.length} 台`"
          >
            {{ countLabel(app.hosts) }}
          </span>
        </el-menu-item>
        <el-sub-menu
          v-for="(node, gIdx) in app.groupNodes"
          :key="node.group?.id || UNGROUPED_ID"
          :index="node.group?.id || UNGROUPED_ID"
          class="group-sub"
          :class="{
            'is-drop-target':
              dropTargetId === (node.group?.id || UNGROUPED_ID),
            'is-group-active':
              activeId === (node.group?.id || UNGROUPED_ID),
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
                :title="`已打开 ${openedCount(node.hosts)} / 共 ${node.hosts.length} 台`"
                :style="{
                  color: groupColor(node.group?.id || UNGROUPED_ID, gIdx).ink,
                  backgroundColor: groupColor(
                    node.group?.id || UNGROUPED_ID,
                    gIdx
                  ).soft,
                }"
              >
                {{ countLabel(node.hosts) }}
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
    </div>

    <div class="sidebar-footer">
      <button
        type="button"
        class="settings-entry"
        :class="{ active: app.settingsOpen }"
        :title="isMac ? '设置 (⌘,)' : '设置 (Ctrl+,)'"
        @click="app.toggleSettings()"
      >
        <el-icon><Setting /></el-icon>
        <span>设置</span>
      </button>
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
          <span class="ctx-kbd">{{ isMac ? "⌘N" : "Ctrl+N" }}</span>
        </button>
        <button type="button" class="ctx-item" @click="onBlankCreateGroup">
          新建分组…
        </button>
      </div>
    </Teleport>

    <!-- 编辑主机弹窗 -->
    <EditHostDialog ref="editRef" />

    <el-dialog
      v-model="createGroupOpen"
      title="新建分组"
      width="400px"
      append-to-body
      destroy-on-close
      class="m3-form-dialog"
      @opened="onCreateGroupOpened"
    >
      <el-form label-position="top" @submit.prevent="submitCreateGroup">
        <el-form-item label="分组名称" required>
          <el-input
            ref="createGroupInputRef"
            v-model="newGroupName"
            placeholder="如 prod"
            @keyup.enter="submitCreateGroup"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="createGroupOpen = false">取消</el-button>
        <el-button type="primary" @click="submitCreateGroup">创建</el-button>
      </template>
    </el-dialog>

    <!-- ⌘F / Ctrl+F：M3 搜索对话框 -->
    <el-dialog
      :model-value="app.sidebarSearchOpen"
      title="搜索主机"
      width="480px"
      append-to-body
      destroy-on-close
      class="host-search-dialog"
      @update:model-value="onSearchVisible"
      @opened="onSearchOpened"
    >
      <div class="host-search">
        <el-input
          ref="searchInputRef"
          v-model="query"
          clearable
          class="host-search__input"
          placeholder="主机名或地址"
          @keydown.enter="openFirstHit"
        >
          <template #prefix>
            <el-icon class="host-search__icon">
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

        <p v-if="!query.trim()" class="host-search__hint">
          输入关键字筛选侧栏主机，Enter 打开首个结果
        </p>

        <div v-else-if="searchHits.length === 0" class="host-search__empty">
          无匹配主机
        </div>

        <div v-else class="host-search__hits" role="listbox" aria-label="搜索结果">
          <button
            v-for="(h, idx) in searchHits"
            :key="h.name"
            type="button"
            role="option"
            class="host-search__hit"
            :class="{ 'is-first': idx === 0 }"
            @click="onHostClick(h.name)"
          >
            <DistroLogo
              :os-release="app.osReleaseMap.get(h.name) || ''"
              :size="18"
              class="host-ico"
            />
            <span class="host-search__name">{{ h.name }}</span>
            <span class="host-search__addr">{{ h.hostName }}</span>
          </button>
        </div>

        <div class="host-search__footer">
          <span><kbd>{{ isMac ? "↵" : "Enter" }}</kbd> 打开</span>
          <span><kbd>Esc</kbd> 关闭</span>
        </div>
      </div>
    </el-dialog>
  </aside>
</template>

<script setup lang="ts">
/**
 * 侧栏：主机/分组树、搜索输入、拖拽分组、右键菜单、宽度调整。
 * 侧栏开关在 App 通栏；⌘F 搜索在窗口正中弹出。
 * 拖拽与调宽逻辑在 composables，右键菜单与编辑弹窗在 components/sidebar。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import { Folder, Monitor, Setting } from "@element-plus/icons-vue";
import { ElMessage } from "element-plus";
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
  addHost: [];
}>();

const app = useAppStore();
const query = ref("");
const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
const searchInputRef = ref<{ focus: () => void; select: () => void } | null>(null);
const createGroupInputRef = ref<{ focus: () => void } | null>(null);
const createGroupOpen = ref(false);
const newGroupName = ref("");
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

/** 无激活主机时选中首页项；设置整页打开时取消菜单选中 */
const activeId = computed(() => {
  if (app.settingsOpen) return "__settings__";
  return app.activeTabId || "__home__";
});

const openedGroups = computed(() =>
  app.groupNodes.map((n) => n.group?.id || UNGROUPED_ID)
);

const searchHits = computed(() => {
  const q = query.value.trim().toLowerCase();
  if (!q) return [];
  const out: { name: string; hostName: string }[] = [];
  for (const n of app.groupNodes) {
    for (const h of n.hosts) {
      if (
        h.name.toLowerCase().includes(q) ||
        (h.hostName || "").toLowerCase().includes(q)
      ) {
        out.push({ name: h.name, hostName: h.hostName || "" });
      }
    }
  }
  return out;
});

function openFirstHit() {
  const first = searchHits.value[0];
  if (!first) return;
  onHostClick(first.name);
}

function openGroup(id: string, name: string) {
  app.openGroupTab(id, name);
}

/** 已打开（后台保持会话）的主机数 */
function openedCount(list: { name: string }[]): number {
  return list.filter((h) => app.isRunning(h.name)).length;
}

/** 计数标记文案：有已打开时显示「已打开/总数」，否则仅总数 */
function countLabel(list: { name: string }[]): string {
  const opened = openedCount(list);
  return opened > 0 ? `${opened}/${list.length}` : `${list.length}`;
}

/** 收起搜索并清空 query（收起即重置） */
function closeSearch() {
  app.setSidebarSearchOpen(false);
  query.value = "";
}

function onSearchVisible(v: boolean) {
  if (v) app.setSidebarSearchOpen(true);
  else closeSearch();
}

function onSearchOpened() {
  nextTick(() => {
    searchInputRef.value?.focus();
    searchInputRef.value?.select();
  });
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
  newGroupName.value = "";
  createGroupOpen.value = true;
}

function onCreateGroupOpened() {
  nextTick(() => createGroupInputRef.value?.focus());
}

async function submitCreateGroup() {
  const name = newGroupName.value.trim();
  if (!name) {
    ElMessage.warning("名称不能为空");
    return;
  }
  const id = await app.createGroup(name);
  ElMessage.success("已创建");
  createGroupOpen.value = false;
  newGroupName.value = "";
  app.openGroupTab(id, name);
}

/** Cmd/Ctrl + 1~9：按侧栏纵向卡片顺序直接打开对应主机 */
function onNumSwitchKeydown(e: KeyboardEvent) {
  if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey) return;
  const n = Number(e.key);
  if (!Number.isInteger(n) || n < 1 || n > 9) return;
  const list = app.groupNodes.flatMap((node) => node.hosts);
  const host = list[n - 1];
  if (!host) return;
  e.preventDefault();
  app.openHostTab(host.name);
}

function onWindowKeydown(e: KeyboardEvent) {
  if ((e.metaKey || e.ctrlKey) && e.code === "KeyF" && app.sidebarSearchOpen) {
    searchInputRef.value?.focus();
    searchInputRef.value?.select();
    return;
  }
  if (e.key === "Escape") {
    if (app.sidebarSearchOpen) closeSearch();
    if (ctxMenu.value) closeCtxMenu();
    blankCtx.value = null;
  }
}

onMounted(() => {
  window.addEventListener("keydown", onWindowKeydown);
  window.addEventListener("keydown", onNumSwitchKeydown);
});

onBeforeUnmount(() => {
  window.removeEventListener("keydown", onWindowKeydown);
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
    transition: width var(--m3-motion-state);
  }

  &.is-resizing,
  &.is-host-dragging {
    transition: none;
    user-select: none;
  }
}

.host-search {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
}

.host-search__input {
  width: 100%;

  :deep(.el-input__wrapper) {
    min-height: 32px;
    height: 32px;
    padding: 0 11px;
    border-radius: var(--m3-shape-s);
    background: var(--m3-surface-container-lowest);
    box-shadow: none !important;
    border: 1px solid var(--m3-outline-variant);
  }

  :deep(.el-input__wrapper:hover) {
    border-color: var(--m3-outline);
  }

  :deep(.el-input__wrapper.is-focus) {
    border-color: var(--m3-primary);
    background: var(--m3-surface-container-lowest);
  }

  :deep(.el-input__inner) {
    height: 30px;
    line-height: 30px;
    font: var(--m3-body-medium);
    color: var(--m3-on-surface);
  }

  :deep(.el-input__prefix) {
    color: var(--m3-on-surface-variant);
  }
}

.host-search__icon {
  font-size: 16px;
}

.host-search__hint,
.host-search__empty {
  margin: 0;
  padding: 8px 4px;
  font: var(--m3-body-small);
  color: var(--m3-on-surface-variant);
  text-align: center;
}

.host-search__hits {
  max-height: 320px;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin: 0 -4px;
  padding: 0 4px;
}

.host-search__hit {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 36px;
  padding: 6px 12px;
  border: 0;
  border-radius: var(--m3-shape-s);
  background: transparent;
  color: var(--m3-on-surface);
  text-align: left;
  cursor: pointer;
  box-sizing: border-box;
  transition: background-color var(--m3-motion-state);

  &:hover,
  &.is-first {
    background: color-mix(in srgb, var(--m3-primary) 8%, transparent);
  }

  &.is-first .host-search__name {
    color: var(--m3-primary);
    font-weight: 600;
  }
}

.host-search__name {
  font: var(--m3-label-large);
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.host-search__addr {
  margin-left: auto;
  flex-shrink: 0;
  max-width: 45%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font: var(--m3-body-small);
  color: var(--m3-on-surface-variant);
  font-family: var(--m3-font-mono);
}

.host-search__footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 16px;
  padding-top: 4px;
  border-top: 1px solid var(--m3-outline-variant);
  font: var(--m3-label-small);
  color: var(--m3-on-surface-variant);

  kbd {
    display: inline-block;
    margin-right: 4px;
    padding: 1px 6px;
    border-radius: var(--m3-shape-xs);
    border: 1px solid var(--m3-outline-variant);
    background: var(--m3-surface-container);
    font: var(--m3-label-small);
    font-family: var(--m3-font-mono);
    color: var(--m3-on-surface);
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

/* 「全部主机」汇总计数：secondary 色系胶囊（磨砂下跟选中半透明） */
.home-count {
  color: var(--m3-sidebar-active-fg);
  background: var(--m3-sidebar-active-bg);
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
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--m3-primary);
  flex-shrink: 0;
  margin-left: 6px;
}

:deep(.el-sub-menu.is-drop-target > .el-sub-menu__title) {
  background: color-mix(in srgb, var(--m3-primary) 12%, transparent) !important;
  outline: 2px dashed var(--m3-primary);
  outline-offset: -2px;
  border-radius: var(--m3-shape-xl);
}

/* 分组被打开为当前页：与主机项一致的选中胶囊（磨砂下半透明） */
:deep(.el-sub-menu.is-group-active > .el-sub-menu__title) {
  background-color: var(--m3-sidebar-active-bg) !important;
  box-shadow: inset 0 0 0 1px var(--m3-sidebar-active-stroke);

  .group-name,
  .group-folder-ico {
    color: var(--m3-sidebar-active-fg);
  }
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
  font: var(--m3-label-small);
  color: var(--m3-on-surface-variant);
}

.drag-hint {
  margin-top: 4px;
  text-align: center;
  font: var(--m3-label-small);
  font-size: 10px;
  color: var(--m3-outline);
}

.settings-entry {
  appearance: none;
  width: 100%;
  display: flex;
  align-items: center;
  gap: 8px;
  height: 40px;
  padding: 0 12px;
  border: none;
  border-radius: var(--m3-shape-xl);
  background: transparent;
  color: var(--m3-on-surface-variant);
  font: var(--m3-label-large);
  cursor: pointer;
  transition: background-color var(--m3-motion-state),
    color var(--m3-motion-state);

  .el-icon {
    font-size: 16px;
  }

  &:hover {
    background: color-mix(in srgb, var(--m3-on-surface) 6%, transparent);
    color: var(--m3-on-surface);
  }

  &.active {
    background: var(--m3-sidebar-active-bg);
    color: var(--m3-sidebar-active-fg);
    font-weight: 600;
    box-shadow: inset 0 0 0 1px var(--m3-sidebar-active-stroke);
  }
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
    transition: background var(--m3-motion-state);
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
  gap: 8px;
  padding: 8px 16px;
  border-radius: var(--m3-shape-m);
  background: var(--m3-surface-container-high);
  color: var(--m3-on-surface);
  font: var(--m3-label-large);
  box-shadow: var(--m3-elevation-3);
  border: 1px solid var(--m3-outline-variant);
  pointer-events: none;
  max-width: 240px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
html.dark .host-drag-ghost {
  background: var(--m3-surface-container-high);
  color: var(--m3-on-surface);
}

/* ⌘F 搜索对话框（append-to-body） */
.host-search-dialog.el-dialog {
  border-radius: var(--m3-shape-xl);
  box-shadow: var(--m3-elevation-3);
}
.host-search-dialog .el-dialog__header {
  padding-bottom: 12px;
}
.host-search-dialog .el-dialog__body {
  padding-top: 0;
}
</style>
