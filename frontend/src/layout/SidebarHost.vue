<template>
  <aside
    class="panel-sidebar"
    :class="{ 'is-resizing': resizing, 'is-host-dragging': !!dragState }"
    :style="{ width: width + 'px' }"
    @contextmenu="onBlankContext"
  >
    <div class="menu-wrap" ref="menuWrapRef">
      <PinnedHostsStrip
        :hosts="app.pinnedHosts"
        :active-id="activeId"
        :drop-target-id="dropTargetId"
        :drag-host-id="dragState?.kind === 'host' ? dragState.id : null"
        :insert-before="pinInsertBefore"
        :dragging-host="dragState?.kind === 'host' && !!dragState?.active"
        :is-running="(n) => app.isRunning(n)"
        :os-release="(n) => app.osReleaseMap.get(n) || ''"
        :suppress-click="suppressClick"
        @open="onHostClick"
        @context="onHostContext"
        @item-pointer-down="onHostPointerDown"
      />
      <!-- unique-opened=false：多分组可同时展开；标题行点开分组页，箭头才负责展开/收起 -->
      <el-menu
        :default-active="activeId"
        :default-openeds="openedGroups"
        :unique-opened="false"
      >
        <!-- 固定首页项：回全部主机概览（与主机项同样走 el-menu 选中逻辑） -->
        <el-menu-item
          index="__home__"
          class="home-item"
          :class="{ 'is-drop-target': dropTargetId === ROOT_DROP_ID }"
          data-drop-group="__root__"
          @click="app.goHome()"
        >
          <el-icon><Monitor /></el-icon>
          <span
            class="menu-title"
            data-drop-group="__root__"
          >全部主机</span>
          <span
            class="menu-count home-count"
            v-tip="`已打开 ${openedCount(app.hosts)} / 共 ${app.hosts.length} 台`"
          >
            {{ countLabel(app.hosts) }}
          </span>
        </el-menu-item>
        <SidebarGroupNode
          v-for="node in app.groupNodes"
          :key="node.group?.id || UNGROUPED_ID"
          :node="node"
          :active-id="activeId"
          :drop-target-id="dropTargetId"
          :drag-state="dragState"
          :is-running="(n) => app.isRunning(n)"
          :os-release="(n) => app.osReleaseMap.get(n) || ''"
          @open-group="openGroup"
          @group-context="onGroupContext"
          @host-pointer-down="onHostPointerDown"
          @host-click="onHostClick"
          @host-dblclick="onHostDblClick"
          @host-context="onHostContext"
          @group-pointer-down="onGroupPointerDown"
        />
      </el-menu>
    </div>

    <div
      class="sidebar-resize-handle"
      v-tip="'拖动调整宽度；双击自适应'"
      @pointerdown="onResizeStart"
      @dblclick="onResizeDblClick"
    />

    <!-- 拖拽幽灵：跟随指针，不依赖 HTML5 DnD（Wails/EP 菜单更稳） -->
    <Teleport to="body">
      <div
        v-if="dragState?.active"
        :class="dragState.kind === 'group' ? 'group-drag-ghost' : 'host-drag-ghost'"
        :style="{
          left: dragState.x + 12 + 'px',
          top: dragState.y + 12 + 'px',
        }"
      >
        <el-icon>
          <Folder v-if="dragState.kind === 'group'" />
          <Monitor v-else />
        </el-icon>
        {{ dragState.label }}
      </div>
    </Teleport>

    <!-- 主机右键菜单（打开/重命名/编辑/删除/迁移分组等在子组件内处理） -->
    <HostContextMenu
      :menu="ctxMenu"
      @close="closeCtxMenu"
      @edit="(host) => editRef?.openFor(host)"
      @move="onCtxMove"
    />

    <GroupContextMenu
      :menu="groupCtxMenu"
      @close="closeGroupCtxMenu"
      @open="onGroupCtxOpen"
      @settings="onGroupCtxSettings"
      @create-child="onGroupCtxCreateChild"
      @add-host="onGroupCtxAddHost"
      @move-to-root="onGroupCtxMoveToRoot"
      @delete="onGroupCtxDelete"
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
          <span class="ctx-kbd">{{ isMac ? "⌘⇧N" : "Ctrl+Shift+N" }}</span>
        </button>
      </div>
    </Teleport>

    <!-- 编辑主机弹窗 -->
    <EditHostDialog ref="editRef" />

    <el-dialog
      v-model="createGroupOpen"
      :title="createGroupParentId ? '新建子分组' : '新建分组'"
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

    <el-dialog
      v-model="groupSettingsOpen"
      title="分组设置"
      width="420px"
      append-to-body
      destroy-on-close
      class="m3-form-dialog"
      @opened="onGroupSettingsOpened"
    >
      <el-form label-position="top" @submit.prevent="saveGroupSettings">
        <el-form-item label="分组名称" required>
          <el-input
            ref="groupSettingsNameRef"
            v-model="settingsName"
            placeholder="侧栏与概览显示名"
            @keyup.enter="saveGroupSettings"
          />
        </el-form-item>
        <el-form-item label="看板标题">
          <el-input
            v-model="settingsBoardTitle"
            placeholder="看板正中标题，可空"
            @keyup.enter="saveGroupSettings"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="groupSettingsOpen = false">取消</el-button>
        <el-button
          type="primary"
          :loading="groupSettingsSaving"
          @click="saveGroupSettings"
        >
          保存
        </el-button>
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
import { Folder, Monitor } from "@element-plus/icons-vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { useAppStore, UNGROUPED_ID, ROOT_DROP_ID } from "@/stores/app";
import EditHostDialog from "@/components/sidebar/EditHostDialog.vue";
import HostContextMenu, {
  type CtxMenuState,
} from "@/components/sidebar/HostContextMenu.vue";
import GroupContextMenu, {
  type GroupCtxMenuState,
} from "@/components/sidebar/GroupContextMenu.vue";
import SidebarGroupNode from "@/components/sidebar/SidebarGroupNode.vue";
import PinnedHostsStrip from "@/components/sidebar/PinnedHostsStrip.vue";
import { useHostDrag } from "@/composables/useHostDrag";
import { useSidebarResize } from "@/composables/useSidebarResize";
import { confirmStopHostSession } from "@/utils/hostSession";
import { clampContextMenuPos } from "@/utils/contextMenuPos";
import { formatErr } from "@/utils/format";

const emit = defineEmits<{
  addHost: [groupId?: string];
}>();

const app = useAppStore();
const query = ref("");
const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
const searchInputRef = ref<{ focus: () => void; select: () => void } | null>(null);
const createGroupInputRef = ref<{ focus: () => void } | null>(null);
const createGroupOpen = ref(false);
const createGroupParentId = ref("");
const newGroupName = ref("");
const menuWrapRef = ref<HTMLElement | null>(null);

const groupSettingsOpen = ref(false);
const groupSettingsSaving = ref(false);
const settingsGroupId = ref("");
const settingsName = ref("");
const settingsBoardTitle = ref("");
const groupSettingsNameRef = ref<{ focus: () => void } | null>(null);

const { width, resizing, onResizeStart, onResizeDblClick } = useSidebarResize();

const {
  dragState,
  dropTargetId,
  pinInsertBefore,
  suppressClick,
  onHostPointerDown,
  onGroupPointerDown,
  cancelDrag,
  moveHostToGroup,
  moveGroupToParent,
} = useHostDrag({ isBlocked: () => resizing.value });

const editRef = ref<InstanceType<typeof EditHostDialog> | null>(null);

/** 无激活主机时选中首页项；设置整页打开时取消菜单选中 */
const activeId = computed(() => {
  if (app.settingsOpen) return "__settings__";
  return app.activeTabId || "__home__";
});

const openedGroups = computed(() => {
  // 只默认展开顶层分组，嵌套子目录保持收起，避免「文件夹 / 主机 / 文件夹」夹杂
  const ids = app.groupNodes
    .filter((n) => n.group && (n.depth ?? 0) === 1)
    .map((n) => n.group!.id);
  if (app.groupNodes.some((n) => !n.group)) ids.push(UNGROUPED_ID);
  return ids;
});

const searchHits = computed(() => {
  const q = query.value.trim().toLowerCase();
  if (!q) return [];
  const out: { name: string; hostName: string }[] = [];
  for (const h of app.flattenHostsInTreeOrder()) {
    if (
      h.name.toLowerCase().includes(q) ||
      (h.hostName || "").toLowerCase().includes(q)
    ) {
      out.push({ name: h.name, hostName: h.hostName || "" });
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
  if (suppressClick.value) return;
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

/** 双击运行中主机：与右键「停止会话」同一确认流 */
async function onHostDblClick(name: string) {
  cancelDrag();
  await confirmStopHostSession(app, name);
}

// ---------- 主机 / 分组右键菜单 ----------

const ctxMenu = ref<CtxMenuState | null>(null);
const groupCtxMenu = ref<GroupCtxMenuState | null>(null);
const blankCtx = ref<{ x: number; y: number } | null>(null);

function closeCtxMenu() {
  ctxMenu.value = null;
}

function closeGroupCtxMenu() {
  groupCtxMenu.value = null;
}

function onHostContext(e: MouseEvent, name: string) {
  // 先关掉拖拽态，避免右键后幽灵残留
  cancelDrag();
  closeGroupCtxMenu();
  blankCtx.value = null;

  // 粗估：真实高度由 HostContextMenu 挂载后按 DOM 再钳一次
  const pad = 8;
  let x = e.clientX;
  let y = e.clientY;
  const approxW = 200;
  const approxH = 480;
  if (x + approxW > window.innerWidth - pad) x = window.innerWidth - approxW - pad;
  if (y + approxH > window.innerHeight - pad) y = window.innerHeight - approxH - pad;
  if (x < pad) x = pad;
  if (y < pad) y = pad;

  ctxMenu.value = { host: name, x, y };
}

function onGroupContext(e: MouseEvent, id: string, name: string) {
  cancelDrag();
  closeCtxMenu();
  blankCtx.value = null;
  const next = clampContextMenuPos(e.clientX, e.clientY, 180, 220);
  groupCtxMenu.value = { id, name, x: next.x, y: next.y };
}

function onGroupCtxOpen(id: string, name: string) {
  openGroup(id, name);
}

function onGroupCtxSettings(id: string, name: string) {
  settingsGroupId.value = id;
  settingsName.value = name;
  const g = app.groupList.find((x) => x.id === id);
  settingsBoardTitle.value = (g?.boardTitle || "").trim();
  groupSettingsOpen.value = true;
}

function onGroupSettingsOpened() {
  nextTick(() => groupSettingsNameRef.value?.focus());
}

async function saveGroupSettings() {
  const id = settingsGroupId.value.trim();
  if (!id || id === UNGROUPED_ID || groupSettingsSaving.value) return;
  const nextName = settingsName.value.trim();
  if (!nextName) {
    ElMessage.warning("分组名称不能为空");
    return;
  }
  groupSettingsSaving.value = true;
  try {
    const g = app.groupList.find((x) => x.id === id);
    if (!g || g.name !== nextName) {
      await app.renameGroup(id, nextName);
    }
    const nextBoard = settingsBoardTitle.value.trim();
    const curBoard = (g?.boardTitle || "").trim();
    if (nextBoard !== curBoard) {
      await app.setBoardTitle(id, nextBoard);
    }
    ElMessage.success("已保存");
    groupSettingsOpen.value = false;
  } catch (err) {
    ElMessage.error(`保存失败: ${formatErr(err)}`);
  } finally {
    groupSettingsSaving.value = false;
  }
}

function onGroupCtxAddHost(groupId: string) {
  emit("addHost", groupId || undefined);
}

function onGroupCtxCreateChild(parentId: string, _parentName: string) {
  openCreateGroup(parentId);
}

async function onGroupCtxMoveToRoot(id: string) {
  await moveGroupToParent(id, ROOT_DROP_ID);
}

async function onGroupCtxDelete(id: string, name: string) {
  let detail = `确定删除分组「${name}」及其全部子分组？子树内主机将回到未分组，主机本身不会被删除。`;
  try {
    const stats = await app.previewDeleteGroup(id);
    detail = `确定删除分组「${name}」？\n将删除 ${stats.groupCount} 个分组（含自身与子分组），${stats.hostCount} 台主机回到未分组。主机本身不会被删除。`;
  } catch {
    /* 预览失败仍允许确认删除 */
  }
  try {
    await ElMessageBox.confirm(detail, "删除分组", {
      type: "warning",
      confirmButtonText: "删除",
      cancelButtonText: "取消",
      confirmButtonClass: "el-button--danger",
    });
  } catch {
    return;
  }
  try {
    await app.deleteGroup(id);
    ElMessage.success(`已删除分组 ${name}`);
  } catch (err) {
    ElMessage.error(`删除失败: ${formatErr(err)}`);
  }
}

async function onCtxMove(host: string, groupId: string) {
  await moveHostToGroup(host, groupId || UNGROUPED_ID);
}

/** 侧栏空白处右键：添加主机 / 新建分组 */
function onBlankContext(e: MouseEvent) {
  // 命中主机行/置顶项/分组标题/按钮/输入框等交互元素时不接管
  const el = (e.target as HTMLElement).closest(
    ".host-item, .pinned-item, .pinned-strip, .el-menu-item, .el-sub-menu__title, .group-title-row, button, input, .sidebar-resize-handle"
  );
  if (el) return;
  e.preventDefault();
  closeCtxMenu();
  closeGroupCtxMenu();
  const next = clampContextMenuPos(e.clientX, e.clientY, 220, 100);
  blankCtx.value = next;
}
function onBlankAddHost() {
  blankCtx.value = null;
  emit("addHost");
}
function onBlankCreateGroup() {
  blankCtx.value = null;
  openCreateGroup();
}

function openCreateGroup(parentId?: string) {
  createGroupParentId.value = (parentId || "").trim();
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
  try {
    const id = await app.createGroup(
      name,
      createGroupParentId.value || undefined
    );
    ElMessage.success("已创建");
    createGroupOpen.value = false;
    newGroupName.value = "";
    createGroupParentId.value = "";
    app.openGroupTab(id, name);
  } catch (err) {
    ElMessage.error(`创建失败: ${formatErr(err)}`);
  }
}

defineExpose({ openCreateGroup });

/** Cmd/Ctrl + 1~9：按侧栏树序展平后的主机顺序打开 */
function onNumSwitchKeydown(e: KeyboardEvent) {
  if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey) return;
  const n = Number(e.key);
  if (!Number.isInteger(n) || n < 1 || n > 9) return;
  const list = app.flattenHostsInTreeOrder();
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
    if (groupCtxMenu.value) closeGroupCtxMenu();
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

/* ---------- 首页「全部主机」计数靠右 ---------- */
.menu-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.home-item.is-drop-target {
  background: color-mix(in srgb, var(--m3-primary) 12%, transparent) !important;
  outline: 2px dashed var(--m3-primary);
  outline-offset: -2px;
  border-radius: 8px;
}

.menu-count {
  margin-left: auto;
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

.home-count {
  color: var(--m3-sidebar-active-fg);
  background: var(--m3-sidebar-active-bg);
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
.host-drag-ghost,
.group-drag-ghost {
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
html.dark .host-drag-ghost,
html.dark .group-drag-ghost {
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
