<template>
  <aside
    class="panel-sidebar"
    :class="{
      'is-resizing': resizing,
      'is-host-dragging': !!dragState,
      'is-fn-nav': hostNavMode,
    }"
    :style="{ width: width + 'px' }"
    @contextmenu="onBlankContext"
  >
    <SidebarDragCap />
    <HostFunctionNav
      v-if="hostNavHost"
      v-show="hostNavMode"
      :host="hostNavHost"
      :status-by-host="statusByHost"
    />
    <div v-show="!hostNavMode" class="menu-wrap" ref="menuWrapRef">
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

      <RunningHostsList title="已打开" :status-by-host="statusByHost" />

      <!-- 分组目录：只列分组名 + 在线/告警摘要，点分组滚动到看板对应区块 -->
      <div class="group-dir">
        <div class="group-dir__head">
          <span class="group-dir__title">分组</span>
          <button
            type="button"
            class="group-dir__add"
            v-tip="isMac ? '新建分组 (⌘⇧N)' : '新建分组 (Ctrl+Shift+N)'"
            @click="openCreateGroup()"
          >
            +
          </button>
        </div>
        <button
          type="button"
          class="group-dir__item home-item"
          :class="{
            'is-active': activeId === '__home__',
            'is-drop-target': dropTargetId === ROOT_DROP_ID,
            'is-flash': flashGroupId === ROOT_DROP_ID,
          }"
          data-drop-group="__root__"
          @click="onHomeClick"
        >
          <el-icon><Monitor /></el-icon>
          <span class="group-dir__name" data-drop-group="__root__">全部主机</span>
          <span
            class="group-dir__count"
            v-tip="`共 ${app.hosts.length} 台`"
          >
            {{ app.hosts.length }}
          </span>
        </button>
        <button
          v-for="entry in groupDirEntries"
          :key="entry.id"
          type="button"
          class="group-dir__item"
          :class="{
            'is-active': activeId === entry.id,
            'is-drop-target': dropTargetId === entry.id,
            'is-flash': flashGroupId === entry.id,
          }"
          :data-drop-group="entry.id"
          :style="{
            paddingLeft: `${10 + Math.max(entry.depth - 1, 0) * 10}px`,
            '--group-accent': entry.color.accent,
            '--group-ink': entry.color.ink,
            '--group-soft': entry.color.soft,
          }"
          @click="onGroupDirClick(entry.id, entry.name)"
          @contextmenu.prevent="onGroupContext($event, entry.id, entry.name)"
          @pointerdown="onGroupPointerDown($event, entry.id, entry.name)"
        >
          <span
            class="group-dir__dot"
            :style="{ backgroundColor: entry.color.accent }"
          />
          <span class="group-dir__name">{{ entry.name }}</span>
          <span
            class="group-dir__meta"
            :style="{ color: entry.color.ink }"
            v-tip="groupMetaTip(entry)"
          >
            {{ groupMetaLabel(entry) }}
          </span>
        </button>
      </div>
    </div>

    <div
      class="sidebar-resize-handle"
      v-tip="'拖动调整宽度；双击自适应'"
      @pointerdown="onResizeStart"
      @dblclick="onResizeDblClick"
    />

    <!-- 拖拽幽灵已提升到 App，侧栏与看板共用 -->

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
 * 侧栏：置顶 + 已打开主机 + 分组目录；主机详情时切 HostFunctionNav。
 * 侧栏开关在主区壳顶；⌘F 搜索在窗口正中弹出。
 * 拖拽与调宽逻辑在 composables，右键菜单与编辑弹窗在 components/sidebar。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import { Monitor } from "@element-plus/icons-vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { useAppStore, UNGROUPED_ID, ROOT_DROP_ID } from "@/stores/app";
import EditHostDialog from "@/components/sidebar/EditHostDialog.vue";
import HostContextMenu, {
  type CtxMenuState,
} from "@/components/sidebar/HostContextMenu.vue";
import GroupContextMenu, {
  type GroupCtxMenuState,
} from "@/components/sidebar/GroupContextMenu.vue";
import PinnedHostsStrip from "@/components/sidebar/PinnedHostsStrip.vue";
import RunningHostsList from "@/components/sidebar/RunningHostsList.vue";
import DistroLogo from "@/components/DistroLogo.vue";
import { groupColor } from "@/components/sidebar/groupColors";
import HostFunctionNav from "@/layout/HostFunctionNav.vue";
import {
  summarizeFleet,
  useFleetStatus,
} from "@/composables/useFleetStatus";
import { useInjectedHostDrag } from "@/composables/useHostDrag";
import { useSidebarResize } from "@/composables/useSidebarResize";
import SidebarDragCap from "@/components/SidebarDragCap.vue";
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
const flashGroupId = ref("");
let flashTimer: ReturnType<typeof setTimeout> | null = null;

/** 远程侧栏可见即参与舰队轮询（与看板共享同一份 statusByHost） */
const fleetEnabled = computed(
  () => app.workspace === "remote" && !app.settingsOpen
);
const { statusByHost } = useFleetStatus({ enabled: fleetEnabled });

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
  onHostPointerDown: beginHostDrag,
  onGroupPointerDown: beginGroupDrag,
  cancelDrag,
  moveHostToGroup,
  moveGroupToParent,
} = useInjectedHostDrag();

/** 调宽中不启拖拽，避免与 resize 抢指针 */
function onHostPointerDown(e: PointerEvent, hostName: string) {
  if (resizing.value) return;
  beginHostDrag(e, hostName);
}

function onGroupPointerDown(e: PointerEvent, groupId: string, name: string) {
  if (resizing.value) return;
  beginGroupDrag(e, groupId, name);
}

const editRef = ref<InstanceType<typeof EditHostDialog> | null>(null);

/** 无激活主机时选中首页项；设置整页打开时取消菜单选中 */
const activeId = computed(() => {
  if (app.settingsOpen) return "__settings__";
  return app.activeTabId || "__home__";
});

const hostNavMode = computed(
  () => !app.settingsOpen && app.activeTab?.kind === "host"
);
const hostNavHost = computed(() =>
  hostNavMode.value ? app.activeTab?.id || "" : ""
);

type GroupDirEntry = {
  id: string;
  name: string;
  depth: number;
  hostNames: string[];
  total: number;
  color: ReturnType<typeof groupColor>;
};

/** 分组目录：树序展平，只列分组名（不含主机行）；末尾附未分组 */
const groupDirEntries = computed<GroupDirEntry[]>(() => {
  const out: GroupDirEntry[] = [];
  for (const n of app.flattenGroupNodes()) {
    const id = n.group!.id;
    const name = n.group!.name || "未命名";
    const hostNames = n.subtreeHosts.map((h) => h.name);
    out.push({
      id,
      name,
      depth: n.depth ?? 0,
      hostNames,
      total: hostNames.length,
      color: groupColor(id, n.rootIndex),
    });
  }
  const ug = app.groupNodes.find((n) => !n.group);
  if (ug) {
    const hostNames = ug.subtreeHosts.map((h) => h.name);
    out.push({
      id: UNGROUPED_ID,
      name: "未分组",
      depth: 0,
      hostNames,
      total: hostNames.length,
      color: groupColor(UNGROUPED_ID, -1),
    });
  }
  return out;
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

function groupMetaLabel(entry: GroupDirEntry): string {
  if (entry.total === 0) return "0";
  const sum = summarizeFleet(entry.hostNames, statusByHost.value);
  if (statusByHost.value.size === 0) return `${entry.total}`;
  return `${sum.online}/${entry.total}`;
}

function groupMetaTip(entry: GroupDirEntry): string {
  if (entry.total === 0) return "暂无主机";
  const sum = summarizeFleet(entry.hostNames, statusByHost.value);
  if (statusByHost.value.size === 0) {
    return `共 ${entry.total} 台`;
  }
  const parts = [`${sum.online} 台在线`];
  if (sum.noAgent > 0) parts.push(`${sum.noAgent} 台未装`);
  if (sum.sshDown > 0) parts.push(`${sum.sshDown} 台掉线`);
  if (sum.alert > 0) parts.push(`${sum.alert} 台告警`);
  parts.push(`共 ${entry.total} 台`);
  return parts.join(" · ");
}

function flashGroup(id: string) {
  flashGroupId.value = id;
  if (flashTimer) clearTimeout(flashTimer);
  flashTimer = setTimeout(() => {
    flashGroupId.value = "";
    flashTimer = null;
  }, 1200);
}

function onHomeClick() {
  app.goHome();
  flashGroup(ROOT_DROP_ID);
  void nextTick(() => {
    const el = document.querySelector(".all-hosts");
    el?.scrollTo?.({ top: 0, behavior: "smooth" });
  });
}

/** 优先滚动并高亮看板对应分组；找不到锚点时退回打开分组页 */
async function onGroupDirClick(id: string, name: string) {
  if (suppressClick.value) return;
  if (!app.isHomeActive()) {
    app.goHome();
    await nextTick();
    await nextTick();
  }
  const sel = `[data-group-anchor="${CSS.escape(id)}"]`;
  const el = document.querySelector(sel) as HTMLElement | null;
  if (el) {
    el.scrollIntoView({ behavior: "smooth", block: "start" });
    flashGroup(id);
    el.classList.add("is-group-flash");
    window.setTimeout(() => el.classList.remove("is-group-flash"), 1200);
    return;
  }
  openGroup(id, name);
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
  if (hostNavMode.value) return;
  // 命中主机行/置顶项/分组目录项/按钮/输入框等交互元素时不接管
  const el = (e.target as HTMLElement).closest(
    ".host-item, .pinned-item, .pinned-strip, .running-hosts__item, .group-dir__item, .group-dir__add, button, input, .sidebar-resize-handle"
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
  if (flashTimer) clearTimeout(flashTimer);
});
</script>

<style scoped lang="scss">
.panel-sidebar {
  position: relative;
  min-width: 180px;
  max-width: 320px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  min-height: 0;

  :deep(.host-fn) {
    flex: 1;
    min-height: 0;
  }

  &:not(.is-resizing) {
    transition: width var(--m3-motion-state);
  }

  &.is-resizing,
  &.is-host-dragging {
    transition: none;
    user-select: none;
  }

  &.is-fn-nav .menu-wrap {
    display: none;
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

/* ---------- 分组目录 ---------- */
.group-dir {
  padding: 4px 6px 12px;
  border-top: 1px solid var(--m3-outline-variant);
  margin-top: 4px;
}

.group-dir__head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 8px 4px;
}

.group-dir__title {
  flex: 1;
  min-width: 0;
  font: var(--m3-label-small);
  font-weight: 600;
  color: var(--m3-on-surface-variant);
}

.group-dir__add {
  appearance: none;
  width: 22px;
  height: 22px;
  padding: 0;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--m3-on-surface-variant);
  font-size: 16px;
  line-height: 1;
  cursor: pointer;

  &:hover {
    background: color-mix(in srgb, var(--m3-on-surface) 8%, transparent);
    color: var(--m3-on-surface);
  }
}

.group-dir__item {
  appearance: none;
  width: 100%;
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 36px;
  padding: 0 10px;
  margin: 1px 0;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--m3-on-surface-variant);
  font: var(--m3-label-large);
  cursor: pointer;
  text-align: left;
  box-sizing: border-box;
  transition: background-color var(--m3-motion-state);

  &:hover {
    background: color-mix(in srgb, var(--m3-on-surface) 6%, transparent);
    color: var(--m3-on-surface);
  }

  &.is-active,
  &.is-flash {
    background: color-mix(
      in srgb,
      var(--group-accent, var(--m3-primary)) 12%,
      transparent
    );
    color: var(--group-ink, var(--m3-primary));
  }

  &.is-drop-target {
    background: color-mix(in srgb, var(--m3-primary) 12%, transparent) !important;
    outline: 2px dashed var(--m3-primary);
    outline-offset: -2px;
  }
}

.group-dir__dot {
  flex-shrink: 0;
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

.group-dir__name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.group-dir__count,
.group-dir__meta {
  flex-shrink: 0;
  font-size: 11px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  min-width: 18px;
  height: 18px;
  line-height: 18px;
  text-align: center;
  padding: 0 6px;
  border-radius: 9px;
  background: var(--group-soft, var(--m3-sidebar-active-bg));
  color: var(--group-ink, var(--m3-sidebar-active-fg));
}

.home-item .group-dir__count {
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
