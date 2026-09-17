<template>
  <aside
    class="panel-sidebar"
    :class="{
      'is-resizing': resizing,
      'is-host-dragging': !!dragState,
      'is-host-active': hostNavActive,
    }"
    :style="{ width: width + 'px' }"
    @contextmenu="onBlankContext"
  >
    <SidebarDragCap />

    <div
      class="menu-wrap"
      :class="{ 'is-collapsed': hostNavActive }"
      ref="menuWrapRef"
    >
      <div class="group-tree">
        <div class="group-tree__head">
          <span class="group-tree__title">分组</span>
          <button
            type="button"
            class="group-tree__add"
            v-tip="isMac ? '新建分组 (⌘⇧N)' : '新建分组 (Ctrl+Shift+N)'"
            @click="openCreateGroup()"
          >
            +
          </button>
        </div>

        <button
          type="button"
          class="tree-row tree-row--home"
          :class="{
            'is-active': activeId === '__home__',
            'is-drop-target': dropTargetId === ROOT_DROP_ID,
            'is-flash': flashGroupId === ROOT_DROP_ID,
          }"
          data-drop-group="__root__"
          @click="onHomeClick"
        >
          <el-icon class="tree-home-ico"><Monitor /></el-icon>
          <span class="tree-name" data-drop-group="__root__">全部主机</span>
          <span class="tree-badge" v-tip="`共 ${app.hosts.length} 台`">
            {{ app.hosts.length }}
          </span>
        </button>

        <template v-for="row in treeRows" :key="row.key">
          <!-- 分组行 -->
          <button
            v-if="row.kind === 'group'"
            type="button"
            class="tree-row tree-row--group"
            :class="{
              'is-active': activeId === row.id,
              'is-drop-target': dropTargetId === row.id,
              'is-flash': flashGroupId === row.id,
            }"
            :data-drop-group="row.id"
            :style="{
              paddingLeft: `${TREE_PAD + row.depth * 16}px`,
              '--group-accent': row.color.accent,
              '--group-ink': row.color.ink,
              '--group-soft': row.color.soft,
            }"
            @click="onGroupRowClick(row)"
            @contextmenu.prevent="onGroupContext($event, row.id, row.name)"
            @pointerdown="onGroupPointerDown($event, row.id, row.name)"
          >
            <span
              class="tree-chevron"
              :class="{ 'is-open': isExpanded(row.id) }"
              @click.stop="toggleExpanded(row.id)"
            >
              ›
            </span>
            <span
              class="tree-dot"
              :style="{ backgroundColor: row.color.accent }"
            />
            <span class="tree-name">{{ row.name }}</span>
            <span
              class="tree-badge"
              :style="{ color: row.color.ink }"
              v-tip="row.tip"
            >
              {{ row.badge }}
            </span>
          </button>

          <!-- 主机行（直属） -->
          <button
            v-else
            type="button"
            class="tree-row tree-row--host"
            :class="{
              'is-active': isHostRowActive(row.name),
              'is-running': app.isRunning(row.name),
              'is-drag-source':
                dragState?.kind === 'host' && dragState.id === row.name,
            }"
            :style="{ paddingLeft: `${TREE_PAD + row.depth * 16}px` }"
            @pointerdown="onHostPointerDown($event, row.name)"
            @dblclick="onHostDblClick(row.name)"
            @contextmenu.prevent="onHostContext($event, row.name)"
          >
            <DistroLogo
              :os-release="app.osReleaseMap.get(row.name) || ''"
              :size="16"
              class="tree-host-ico"
            />
            <span class="tree-name">{{ row.name }}</span>
            <span
              v-if="hostHasAlert(row.name)"
              class="tree-alert"
              v-tip="'有资源告警'"
            />
          </button>
        </template>
      </div>
    </div>

    <!-- 主机标签激活时：树在上，下方功能菜单 -->
    <HostFunctionNav v-if="hostNavHost" :host="hostNavHost" />

    <div
      class="sidebar-resize-handle"
      v-tip="'拖动调整宽度；双击自适应'"
      @pointerdown="onResizeStart"
      @dblclick="onResizeDblClick"
    />

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
            @click="onSearchHit(h.name)"
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
 * 远程侧栏：可展开分组树（全部主机 / 分组+直属主机）。置顶主机在「全部主机」页顶部展示。
 * 单击主机 → 右侧信息栏；双击 → 打开主机标签；单击分组 → 打开分组页。
 * 主机标签激活时树可压矮，下方挂 HostFunctionNav。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { Monitor } from "@element-plus/icons-vue";
import { ElMessage, ElMessageBox } from "element-plus";
import {
  useAppStore,
  UNGROUPED_ID,
  ROOT_DROP_ID,
  type GroupNode,
} from "@/stores/app";
import EditHostDialog from "@/components/sidebar/EditHostDialog.vue";
import HostContextMenu, {
  type CtxMenuState,
} from "@/components/sidebar/HostContextMenu.vue";
import GroupContextMenu, {
  type GroupCtxMenuState,
} from "@/components/sidebar/GroupContextMenu.vue";
import DistroLogo from "@/components/DistroLogo.vue";
import { groupColor, type GroupColor } from "@/components/sidebar/groupColors";
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

const TREE_PAD = 10;
const EXPANDED_KEY = "1pannel-group-tree-expanded";

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
  suppressClick,
  onHostPointerDown: beginHostDrag,
  onGroupPointerDown: beginGroupDrag,
  cancelDrag,
  moveHostToGroup,
  moveGroupToParent,
} = useInjectedHostDrag();

function onHostPointerDown(e: PointerEvent, hostName: string) {
  if (resizing.value) return;
  beginHostDrag(e, hostName);
}

function onGroupPointerDown(e: PointerEvent, groupId: string, name: string) {
  if (resizing.value) return;
  beginGroupDrag(e, groupId, name);
}

const editRef = ref<InstanceType<typeof EditHostDialog> | null>(null);

const activeId = computed(() => {
  if (app.settingsOpen) return "__settings__";
  return app.activeTabId || "__home__";
});

const hostNavActive = computed(
  () => !app.settingsOpen && app.activeView?.kind === "host"
);
const hostNavHost = computed(() =>
  hostNavActive.value ? app.activeView?.id || "" : ""
);

function loadExpanded(): { set: Set<string>; hasStored: boolean } {
  try {
    const raw = localStorage.getItem(EXPANDED_KEY);
    if (raw === null) return { set: new Set(), hasStored: false };
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return { set: new Set(), hasStored: false };
    return {
      set: new Set(arr.filter((x): x is string => typeof x === "string")),
      hasStored: true,
    };
  } catch {
    return { set: new Set(), hasStored: false };
  }
}

const loadedExpanded = loadExpanded();
const expandedIds = ref<Set<string>>(loadedExpanded.set);
let expandedInitialized = loadedExpanded.hasStored;

function persistExpanded() {
  try {
    localStorage.setItem(
      EXPANDED_KEY,
      JSON.stringify([...expandedIds.value])
    );
  } catch {
    /* ignore */
  }
}

function isExpanded(id: string): boolean {
  return expandedIds.value.has(id);
}

function toggleExpanded(id: string) {
  const next = new Set(expandedIds.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  expandedIds.value = next;
  persistExpanded();
}

function expandId(id: string) {
  if (expandedIds.value.has(id)) return;
  const next = new Set(expandedIds.value);
  next.add(id);
  expandedIds.value = next;
  persistExpanded();
}

/** 首次无记忆时：展开有内容的节点 */
function seedExpandedIfNeeded() {
  if (expandedInitialized) return;
  const next = new Set<string>();
  const walk = (list: GroupNode[]) => {
    for (const n of list) {
      const id = n.group?.id || UNGROUPED_ID;
      if (n.hosts.length > 0 || (n.children && n.children.length > 0)) {
        next.add(id);
      }
      if (n.children?.length) walk(n.children);
    }
  };
  walk(app.groupNodes);
  expandedIds.value = next;
  expandedInitialized = true;
  persistExpanded();
}

watch(
  () => app.groupNodes,
  () => seedExpandedIfNeeded(),
  { immediate: true }
);

type GroupTreeRow = {
  kind: "group";
  key: string;
  id: string;
  name: string;
  depth: number;
  color: GroupColor;
  badge: string;
  tip: string;
};

type HostTreeRow = {
  kind: "host";
  key: string;
  name: string;
  depth: number;
};

type TreeRow = GroupTreeRow | HostTreeRow;

function fleetBadge(directNames: string[], subtreeNames: string[]): {
  badge: string;
  tip: string;
} {
  const directTotal = directNames.length;
  const subTotal = subtreeNames.length;
  const directSum = summarizeFleet(directNames, statusByHost.value);
  const subSum = summarizeFleet(subtreeNames, statusByHost.value);
  const hasStatus = statusByHost.value.size > 0;

  let badge: string;
  if (directTotal === 0) {
    badge = "0";
  } else if (!hasStatus) {
    badge = `${directTotal}`;
  } else {
    badge = `${directSum.online}/${directTotal}`;
  }

  if (subTotal === 0) {
    return { badge, tip: "暂无主机" };
  }
  if (!hasStatus) {
    return {
      badge,
      tip:
        directTotal === subTotal
          ? `共 ${subTotal} 台`
          : `本级 ${directTotal} 台 · 含子树共 ${subTotal} 台`,
    };
  }
  const parts = [`本级 ${directSum.online}/${directTotal}`];
  if (subTotal !== directTotal) {
    parts.push(`含子树 ${subSum.online}/${subTotal}`);
  }
  if (subSum.noAgent > 0) parts.push(`${subSum.noAgent} 台未装`);
  if (subSum.sshDown > 0) parts.push(`${subSum.sshDown} 台掉线`);
  if (subSum.alert > 0) parts.push(`${subSum.alert} 台告警`);
  return { badge, tip: parts.join(" · ") };
}

/** 按展开状态生成可见行：分组 → 直属主机 → 子分组 */
const treeRows = computed<TreeRow[]>(() => {
  const out: TreeRow[] = [];
  const walk = (list: GroupNode[], depth: number) => {
    for (const n of list) {
      const id = n.group?.id || UNGROUPED_ID;
      const name = n.group?.name || "未分组";
      const color = groupColor(id, n.rootIndex);
      const directNames = n.hosts.map((h) => h.name);
      const subNames = n.subtreeHosts.map((h) => h.name);
      const meta = fleetBadge(directNames, subNames);
      out.push({
        kind: "group",
        key: `g-${id}`,
        id,
        name,
        depth,
        color,
        badge: meta.badge,
        tip: meta.tip,
      });
      if (!isExpanded(id)) continue;
      for (const h of n.hosts) {
        out.push({
          kind: "host",
          key: `h-${id}-${h.name}`,
          name: h.name,
          depth: depth + 1,
        });
      }
      if (n.children?.length) walk(n.children, depth + 1);
    }
  };
  walk(app.groupNodes, 0);
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

function hostHasAlert(name: string): boolean {
  return !!statusByHost.value.get(name)?.alert;
}

function isHostRowActive(name: string): boolean {
  if (app.activeView?.kind === "host" && app.activeView.id === name) return true;
  return false;
}

function openFirstHit() {
  const first = searchHits.value[0];
  if (!first) return;
  onSearchHit(first.name);
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
}

/** 单击分组名 → 打开分组页；点箭头只折叠 */
function onGroupRowClick(row: GroupTreeRow) {
  if (suppressClick.value) return;
  app.openGroupTab(row.id, row.name);
}

function onHostDblClick(name: string) {
  if (suppressClick.value) return;
  app.openHostTab(name);
  closeSearch();
}

function onSearchHit(name: string) {
  if (suppressClick.value) return;
  app.openHostTab(name);
  closeSearch();
}

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
  cancelDrag();
  closeGroupCtxMenu();
  blankCtx.value = null;

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
  app.openGroupTab(id, name);
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

function onBlankContext(e: MouseEvent) {
  const el = (e.target as HTMLElement).closest(
    ".tree-row, .tree-chevron, .group-tree__add, .host-fn, button, input, .sidebar-resize-handle"
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
  const parentId = createGroupParentId.value;
  try {
    const id = await app.createGroup(name, parentId || undefined);
    ElMessage.success("已创建");
    createGroupOpen.value = false;
    newGroupName.value = "";
    createGroupParentId.value = "";
    if (parentId) expandId(parentId);
    expandId(id);
    app.openGroupTab(id, name);
  } catch (err) {
    ElMessage.error(`创建失败: ${formatErr(err)}`);
  }
}

defineExpose({ openCreateGroup });

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
}

.menu-wrap {
  flex: 1;
  min-height: 0;
  overflow: auto;
  display: flex;
  flex-direction: column;

  &.is-collapsed {
    flex: 0 1 auto;
    max-height: 42%;
    border-bottom: 1px solid var(--m3-outline-variant);
  }
}

.group-tree {
  padding: 4px 6px 12px;
  min-width: 0;
}

.group-tree__head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 8px 4px;
}

.group-tree__title {
  flex: 1;
  min-width: 0;
  font: var(--m3-label-small);
  font-weight: 600;
  color: var(--m3-on-surface-variant);
}

.group-tree__add {
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

.tree-row {
  appearance: none;
  position: relative;
  width: 100%;
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 34px;
  padding: 0 8px 0 10px;
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

  &.is-drag-source {
    opacity: 0.45;
  }

}

.tree-chevron {
  flex-shrink: 0;
  width: 16px;
  height: 16px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  line-height: 1;
  color: var(--m3-on-surface-variant);
  transform: rotate(0deg);
  transition: transform var(--m3-motion-state);
  border-radius: 4px;

  &.is-open {
    transform: rotate(90deg);
  }

  &:hover {
    background: color-mix(in srgb, var(--m3-on-surface) 8%, transparent);
    color: var(--m3-on-surface);
  }
}

.tree-dot {
  flex-shrink: 0;
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

.tree-home-ico {
  flex-shrink: 0;
  font-size: 16px;
  margin-left: 2px;
}

.tree-host-ico {
  flex-shrink: 0;
  margin-left: 16px;
}

.tree-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tree-badge {
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

.tree-row--home .tree-badge {
  color: var(--m3-sidebar-active-fg);
  background: var(--m3-sidebar-active-bg);
}

.tree-alert {
  flex-shrink: 0;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #dc2626;
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
