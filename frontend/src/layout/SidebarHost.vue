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
      <div class="my-egress" :title="egressTitle">
        <span v-if="egressLoading" class="egress-loading">检测中…</span>
        <template v-else-if="egress && egress.ip">
          <span class="egress-ip">{{ egress.ip }}</span>
          <span v-if="egress.location" class="egress-loc">{{ egress.location }}</span>
        </template>
        <span v-else class="egress-empty">出口 IP 未知</span>
      </div>
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
      width="440px"
      append-to-body
      destroy-on-close
      @opened="onCreateGroupOpened"
    >
      <el-form label-width="80px" @submit.prevent="submitCreateGroup">
        <el-form-item label="分组名称">
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

    <!-- ⌘F / Ctrl+F：与添加主机 / 新建分组同一套 Dialog -->
    <el-dialog
      :model-value="app.sidebarSearchOpen"
      title="搜索主机"
      width="440px"
      append-to-body
      destroy-on-close
      @update:model-value="onSearchVisible"
      @opened="onSearchOpened"
    >
      <el-input
        ref="searchInputRef"
        v-model="query"
        clearable
        placeholder="主机名或地址"
        @keydown.enter="openFirstHit"
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
      <div v-if="query.trim() && searchHits.length === 0" class="search-empty">
        无匹配主机
      </div>
      <div v-else-if="searchHits.length" class="search-hits">
        <button
          v-for="h in searchHits"
          :key="h.name"
          type="button"
          class="search-hit"
          @click="onHostClick(h.name)"
        >
          <DistroLogo
            :os-release="app.osReleaseMap.get(h.name) || ''"
            :size="16"
            class="host-ico"
          />
          <span class="search-hit-name">{{ h.name }}</span>
          <span class="search-hit-addr">{{ h.hostName }}</span>
        </button>
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
import { Folder, Monitor } from "@element-plus/icons-vue";
import { ElMessage } from "element-plus";
import { useAppStore, UNGROUPED_ID } from "@/stores/app";
import DistroLogo from "@/components/DistroLogo.vue";
import { api } from "@/api";
import type { monitor } from "@/api";
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

/** 无激活主机时选中首页项（与主机项一样由 el-menu 驱动高亮） */
const activeId = computed(() => app.activeTabId || "__home__");

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

// ---------- 侧栏底部：本机出口 IP 与归属地（应用启动时获取一次） ----------

const egress = ref<monitor.EgressInfo | null>(null);
const egressLoading = ref(false);

const egressTitle = computed(() => {
  if (egressLoading.value) return "正在查询 myip.ipip.net…";
  if (!egress.value || !egress.value.ip) return "本机出口公网 IP";
  return `${egress.value.ip}${egress.value.location ? " · " + egress.value.location : ""}\n来源：myip.ipip.net`;
});

async function refreshEgress() {
  if (egressLoading.value) return;
  egressLoading.value = true;
  try {
    const r = await api.getMyEgress();
    if (r && r.ip) {
      egress.value = r;
    } else {
      // 静默失败：保留旧值或显示「未识别」
      if (!egress.value) egress.value = r ?? null;
    }
  } catch {
    /* 启动期查询失败静默，避免弹窗打扰 */
  } finally {
    egressLoading.value = false;
  }
}

onMounted(() => {
  window.addEventListener("keydown", onWindowKeydown);
  window.addEventListener("keydown", onNumSwitchKeydown);
  void refreshEgress();
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
    transition: width 0.15s ease;
  }

  &.is-resizing,
  &.is-host-dragging {
    transition: none;
    user-select: none;
  }
}

.search-empty {
  padding: 16px 0 4px;
  text-align: center;
  font-size: 13px;
  color: var(--el-text-color-secondary);
}

.search-hits {
  margin-top: 12px;
  max-height: 320px;
  overflow: auto;
}

.search-hit {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--el-text-color-primary);
  text-align: left;
  cursor: pointer;
}

.search-hit:hover {
  background: color-mix(in srgb, var(--el-color-primary) 10%, transparent);
}

.search-hit-name {
  font-size: 13px;
  font-weight: 500;
}

.search-hit-addr {
  margin-left: auto;
  font-size: 12px;
  color: var(--el-text-color-secondary);
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

/* 「全部主机」汇总计数：主色系，区别于各分组色 */
.home-count {
  color: var(--el-color-primary);
  background: color-mix(in srgb, var(--el-color-primary) 12%, transparent);
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

/* 分组被打开为当前页：与「全部主机」选中一致的白底 + 主色描边 + 左竖线 */
:deep(.el-sub-menu.is-group-active > .el-sub-menu__title) {
  position: relative;
  background-color: var(--el-menu-item-bg-color-active) !important;
  box-shadow:
    0 0 4px rgba(0, 94, 235, 0.1),
    inset 0 0 0 2px var(--el-color-primary) !important;

  &::before {
    position: absolute;
    border-radius: 4px;
    left: 8px;
    width: 4px;
    height: 14px;
    content: "";
    background: var(--el-color-primary);
  }

  .group-name,
  .group-folder-ico {
    color: var(--el-color-primary);
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
  font-size: 11px;
  color: #909399;
}

.drag-hint {
  margin-top: 4px;
  text-align: center;
  font-size: 10px;
  color: #c0c4cc;
}

/* 侧栏底部：本机出口 IP 与归属地（无卡片底色，直接融入侧栏，仅展示） */
.my-egress {
  margin: 8px 14px 6px;
  padding: 2px 2px;
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  line-height: 1.4;
  color: var(--el-text-color-secondary);
  white-space: nowrap;
  overflow: hidden;
}
.egress-ip {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-variant-numeric: tabular-nums;
  font-weight: 600;
  color: var(--el-text-color-primary);
  flex-shrink: 0;
}
.egress-loc {
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
  min-width: 0;
}
.egress-empty,
.egress-loading {
  color: var(--el-text-color-placeholder);
  font-style: italic;
  flex: 1;
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
