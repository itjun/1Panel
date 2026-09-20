<template>
  <div class="all-hosts">
    <ChromeTeleport :when="app.isHomeActive()" to="center">
      <el-input
        ref="searchInputRef"
        v-model="searchQuery"
        clearable
        class="host-filter__input"
        :placeholder="isMac ? '筛选主机名 / 地址 / 用户 (⌘F)' : '筛选主机名 / 地址 / 用户 (Ctrl+F)'"
        @keydown.esc="onSearchEsc"
      >
        <template #prefix>
          <el-icon class="host-filter__icon"><Search /></el-icon>
        </template>
      </el-input>
    </ChromeTeleport>

    <ChromeTeleport :when="app.isHomeActive()">
      <span class="chrome-meta">
        <template v-if="searchQuery.trim()">
          匹配 {{ filteredHostCount }} / {{ app.hosts.length }} 台 · 已打开
          {{ app.runningHosts.length }}
        </template>
        <template v-else>
          共 {{ app.hosts.length }} 台 · 在线 {{ fleetOnlineCount }} · 已打开
          {{ app.runningHosts.length }}
        </template>
      </span>
      <el-button :icon="Plus" @click="promptCreateRootGroup">
        新建分组
      </el-button>
      <el-button
        :icon="Refresh"
        :loading="app.loading"
        v-tip="isMac ? '刷新 (⌘R)' : '刷新 (Ctrl+R)'"
        @click="app.refresh()"
      >
        刷新
      </el-button>
      <el-button :icon="Picture" :loading="app.iconsRefreshing" @click="onRefreshIcons">
        检查图标
      </el-button>
    </ChromeTeleport>

    <el-empty
      v-if="app.hosts.length === 0 && app.groupList.length === 0"
      description="暂无主机，右键侧栏空白处可添加主机或新建分组"
    />

    <el-empty
      v-else-if="searchQuery.trim() && filteredHostCount === 0"
      description="无匹配主机"
    />

    <!-- 置顶主机：有置顶或正在拖主机时显示，可作为置顶落点 / 块内排序 -->
    <section
      v-if="showPinnedSection"
      class="pinned-section"
      :class="{ 'is-drop-target': dropTargetId === PINNED_DROP_ID }"
      :data-drop-group="PINNED_DROP_ID"
    >
      <div class="pinned-section__head">
        <span class="pinned-section__dot" />
        <span class="pinned-section__name">置顶</span>
        <span class="pinned-section__count">{{ visiblePinnedHosts.length }}</span>
        <span v-if="visiblePinnedHosts.length > 0" class="pinned-section__summary">
          {{ pinnedSummaryText }}
        </span>
      </div>
      <p v-if="visiblePinnedHosts.length === 0" class="pinned-section__hint">
        {{ searchQuery.trim() ? "无匹配的置顶主机" : "拖到此处置顶" }}
      </p>
      <div v-else class="pinned-grid">
        <HostCard
          v-for="h in visiblePinnedHosts"
          :key="'pin-' + h.name"
          dense
          :host="h"
          :reach="statusByHost.get(h.name)?.reach ?? null"
          :os-release="app.osReleaseMap.get(h.name) || ''"
          :running="app.isRunning(h.name)"
          :selected="selectedHostName === h.name"
          :drag-source="dragState?.kind === 'host' && dragState.id === h.name"
          :insert-before="
            pinInsertBefore === h.name &&
            dragState?.kind === 'host' &&
            dragState.id !== h.name
          "
          :data-pin-host="h.name"
          @pointerdown="onHostPointerDown($event, h.name)"
          @click="onSelectHost(h.name)"
          @dblclick="openHost(h.name)"
          @contextmenu="onHostContext($event, h.name)"
          @refresh-icon="onRefreshOneIcon(h.name)"
        />
      </div>
    </section>

    <!-- 按分组树渲染：子分组嵌在父节点下，树线对齐 -->
    <div v-if="filteredGroupTree.length > 0" class="group-sections">
      <AllHostsGroupBranch
        v-for="node in filteredGroupTree"
        :key="node.key"
        :node="node"
        :nested="false"
        :selected-host="selectedHostName"
        :is-running="(n) => app.isRunning(n)"
        :os-release="(n) => app.osReleaseMap.get(n) || ''"
        :status-by-host="statusByHost"
        @select-host="onSelectHost"
        @open-host="openHost"
        @refresh-icon="onRefreshOneIcon"
        @open-group="openGroup"
        @open-board="openBoard"
        @host-context="onHostContext"
        @group-context="onGroupHeadContext"
      />
    </div>

    <HostContextMenu
      :menu="ctxMenu"
      @close="closeCtxMenu"
      @edit="(host) => (editHostName = host)"
      @move="onCtxMove"
    />
    <GroupContextMenu
      :menu="groupCtxMenu"
      @close="groupCtxMenu = null"
      @open="onGroupMenuOpen"
      @open-board="openBoard"
      @settings="onGroupMenuSettings"
      @add-host="onGroupMenuAddHost"
      @delete="onGroupMenuDelete"
    />
    <EditHostDrawer
      :host="editHost"
      :os-release="editOsRelease"
      @close="editHostName = null"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { Picture, Plus, Refresh, Search } from "@element-plus/icons-vue";
import { ElMessage, ElMessageBox } from "element-plus";
import AllHostsGroupBranch, {
  type HostGroupTreeNode,
} from "@/components/AllHostsGroupBranch.vue";
import ChromeTeleport from "@/components/ChromeTeleport.vue";
import HostCard from "@/components/HostCard.vue";
import EditHostDrawer from "@/components/sidebar/HostEditDrawer.vue";
import HostContextMenu, {
  type CtxMenuState,
} from "@/components/sidebar/HostContextMenu.vue";
import GroupContextMenu, {
  type GroupCtxMenuState,
} from "@/components/sidebar/GroupContextMenu.vue";
import {
  summarizeFleet,
  useFleetStatus,
} from "@/composables/useFleetStatus";
import { useInjectedHostDrag } from "@/composables/useHostDrag";
import { api } from "@/api";
import {
  useAppStore,
  PINNED_DROP_ID,
  UNGROUPED_ID,
  type GroupNode,
} from "@/stores/app";
import { formatErr } from "@/utils/format";
import type { sshconfig } from "@/api";

const app = useAppStore();
const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
const {
  dragState,
  dropTargetId,
  pinInsertBefore,
  onHostPointerDown,
  cancelDrag,
  moveHostToGroup,
  suppressClick,
} = useInjectedHostDrag();
const ctxMenu = ref<CtxMenuState | null>(null);
const groupCtxMenu = ref<GroupCtxMenuState | null>(null);
const editHostName = ref<string | null>(null);
const editHost = computed(
  () => app.hosts.find((h) => h.name === editHostName.value) || null
);
const editOsRelease = computed(
  () => (editHostName.value && app.osReleaseMap.get(editHostName.value)) || ""
);
// 编辑抽屉跟随当前主机：切到其他主机即自动收起
watch(
  () => app.activeSession?.host,
  (host) => {
    if (editHostName.value && host !== editHostName.value) editHostName.value = null;
  }
);

// 首页不默认全量 listGroupOverview；缺状态时只显示台数
const fleetEnabled = computed(() => false);
const { statusByHost } = useFleetStatus({ enabled: fleetEnabled });

const fleetOnlineCount = computed(() => {
  const names = app.hosts.map((h) => h.name);
  return summarizeFleet(names, statusByHost.value).online;
});

/* ---------- 置顶主机区块 ---------- */

/** 有置顶主机，或正在拖主机（空落点提示）时显示；搜索无匹配则隐藏（拖拽时仍显示） */
const showPinnedSection = computed(() => {
  if (dragState.value?.kind === "host" && !!dragState.value.active) return true;
  if (app.pinnedHosts.length === 0) return false;
  if (searchQuery.value.trim() && visiblePinnedHosts.value.length === 0) {
    return false;
  }
  return true;
});

/** 按置顶顺序取主机配置；已删除的主机名跳过 */
const pinnedHostConfigs = computed(() => {
  const byName = new Map(app.hosts.map((h) => [h.name, h]));
  const out: sshconfig.HostConfig[] = [];
  for (const name of app.pinnedHosts) {
    const h = byName.get(name);
    if (h) out.push(h);
  }
  return out;
});

const visiblePinnedHosts = computed(() =>
  pinnedHostConfigs.value.filter((h) => hostMatchesQuery(h, searchQuery.value))
);

const pinnedSummaryText = computed(() => {
  const names = visiblePinnedHosts.value.map((h) => h.name);
  if (names.length === 0) return "";
  if (statusByHost.value.size === 0) return `共 ${names.length} 台`;
  const s = summarizeFleet(names, statusByHost.value);
  const parts = [`${s.online} 台在线`];
  if (s.noAgent > 0) parts.push(`${s.noAgent} 台未装`);
  if (s.sshDown > 0) parts.push(`${s.sshDown} 台掉线`);
  if (s.alert > 0) parts.push(`${s.alert} 台告警`);
  return parts.join(" · ");
});

const selectedHostName = ref<string | null>(null);
const searchQuery = ref("");
const searchInputRef = ref<{ focus: () => void; select: () => void; input?: HTMLInputElement } | null>(null);

function onSelectHost(name: string) {
  if (suppressClick.value) return;
  selectedHostName.value = name;
}

function onSearchEsc(e: Event) {
  const ke = e as KeyboardEvent;
  if (searchQuery.value) {
    ke.stopPropagation();
    searchQuery.value = "";
    return;
  }
  (ke.target as HTMLElement | null)?.blur?.();
}

function hostMatchesQuery(h: sshconfig.HostConfig, raw: string): boolean {
  const q = raw.trim().toLowerCase();
  if (!q) return true;
  if (h.name.toLowerCase().includes(q)) return true;
  if ((h.hostName || "").toLowerCase().includes(q)) return true;
  if ((h.user || "").toLowerCase().includes(q)) return true;
  return false;
}

function filterTreeNode(
  node: HostGroupTreeNode,
  raw: string
): HostGroupTreeNode | null {
  const q = raw.trim().toLowerCase();
  if (!q) return node;
  const hosts = node.hosts.filter((h) => hostMatchesQuery(h, q));
  const children: HostGroupTreeNode[] = [];
  for (const child of node.children) {
    const next = filterTreeNode(child, q);
    if (next) children.push(next);
  }
  if (hosts.length === 0 && children.length === 0) return null;
  const hostNames = [
    ...hosts.map((h) => h.name),
    ...children.flatMap((c) => c.hostNames),
  ];
  return {
    ...node,
    hosts,
    children,
    hostNames,
    totalCount: hostNames.length,
  };
}

/**
 * 分组树：本层主机 + 子分组（与侧栏同色板，按顶层 rootIndex）。
 */
function toTreeNode(n: GroupNode): HostGroupTreeNode {
  return {
    key: n.group!.id,
    title: n.group!.name || "未命名",
    hosts: n.hosts,
    hostNames: n.subtreeHosts.map((h) => h.name),
    totalCount: n.subtreeHosts.length,
    rootIndex: n.rootIndex,
    depth: n.depth,
    children: (n.children || [])
      .filter((c) => !!c.group)
      .map((c) => toTreeNode(c)),
  };
}

const groupTree = computed<HostGroupTreeNode[]>(() => {
  const roots = app.groupNodes
    .filter((n) => !!n.group)
    .map((n) => toTreeNode(n));
  const ug = app.groupNodes.find((n) => !n.group);
  if (ug) {
    roots.push({
      key: UNGROUPED_ID,
      title: "未分组",
      hosts: ug.hosts,
      hostNames: ug.subtreeHosts.map((h) => h.name),
      totalCount: ug.subtreeHosts.length,
      rootIndex: -1,
      depth: 0,
      children: [],
    });
  }
  return roots;
});

const filteredGroupTree = computed(() => {
  const q = searchQuery.value;
  if (!q.trim()) return groupTree.value;
  const out: HostGroupTreeNode[] = [];
  for (const node of groupTree.value) {
    const next = filterTreeNode(node, q);
    if (next) out.push(next);
  }
  return out;
});

const filteredHostCount = computed(() => {
  if (!searchQuery.value.trim()) return app.hosts.length;
  let n = 0;
  for (const node of filteredGroupTree.value) {
    n += node.hostNames.length;
  }
  return n;
});

watch(
  () => app.homeSearchFocusSeq,
  async () => {
    await nextTick();
    searchInputRef.value?.focus();
    searchInputRef.value?.select();
  }
);

function openHost(name: string) {
  if (suppressClick.value) return;
  app.openHostTab(name);
}

function closeCtxMenu() {
  ctxMenu.value = null;
}

function onHostContext(e: MouseEvent, name: string) {
  cancelDrag();
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

async function onCtxMove(host: string, groupId: string) {
  await moveHostToGroup(host, groupId || UNGROUPED_ID);
}

/* ---------- 内容区分组标题右键菜单 ---------- */

function onGroupHeadContext(e: MouseEvent, id: string, title: string) {
  cancelDrag();
  groupCtxMenu.value = { id, name: title, x: e.clientX, y: e.clientY };
}

function onGroupMenuOpen(id: string, _title: string) {
  app.openGroupTab(id, _title);
}

function onGroupMenuSettings(id: string, name: string) {
  // 设置对话框在侧栏组件里，通过全局事件转给它打开
  window.dispatchEvent(
    new CustomEvent("allhosts:group-settings", { detail: { id, name } })
  );
}

function onGroupMenuAddHost(groupId: string) {
  window.dispatchEvent(
    new CustomEvent("app-add-host", { detail: { groupId } })
  );
}

async function onGroupMenuDelete(id: string, title: string) {
  try {
    const stats = await app.previewDeleteGroup(id);
    await ElMessageBox.confirm(
      `确定删除分组「${title}」？\n将删除 ${stats.groupCount} 个分组（含自身与子分组），${stats.hostCount} 台主机回到未分组。主机本身不会被删除。`,
      "删除分组",
      {
        type: "warning",
        confirmButtonText: "删除",
        cancelButtonText: "取消",
        confirmButtonClass: "el-button--danger",
      }
    );
  } catch {
    return;
  }
  try {
    await app.deleteGroup(id);
    ElMessage.success(`已删除分组 ${title}`);
  } catch (e) {
    ElMessage.error(`删除失败: ${formatErr(e)}`);
  }
}

function openGroup(id: string, title: string) {
  app.openGroupTab(id, title);
}

async function openBoard(groupId: string) {
  try {
    await api.openBoardWindow(groupId);
  } catch (e) {
    ElMessage.error(`打开看板失败: ${formatErr(e)}`);
  }
}

async function promptCreateRootGroup() {
  try {
    const { value } = await ElMessageBox.prompt("请输入分组名称", "新建分组", {
      confirmButtonText: "创建",
      cancelButtonText: "取消",
      inputPattern: /\S+/,
      inputErrorMessage: "名称不能为空",
    });
    const name = (value || "").trim();
    if (!name) return;
    await app.createGroup(name);
    ElMessage.success("已创建分组");
  } catch (e) {
    if (e === "cancel" || e === "close") return;
    ElMessage.error(`创建失败: ${formatErr(e)}`);
  }
}

async function onRefreshOneIcon(name: string) {
  try {
    const os = await app.refreshHostIcon(name);
    ElMessage.success(`${name}：${os || "图标已更新"}`);
  } catch (e) {
    ElMessage.error(`更新图标失败: ${formatErr(e)}`);
  }
}

async function onRefreshIcons() {
  try {
    const r = await app.refreshAllHostIcons();
    if (r.failed.length > 0) {
      ElMessage.warning(
        `已更新 ${r.ok} 台，失败 ${r.failed.length} 台`
      );
    } else {
      ElMessage.success(`已检查并更新 ${r.ok} 台主机图标`);
    }
  } catch (e) {
    ElMessage.error(`检查图标失败: ${formatErr(e)}`);
  }
}

/* ---------- 侧栏分组点击定位 ---------- */

/** 收集目标分组及其祖先 id（含自身），用于展开折叠链 */
function collectGroupAncestorIds(groupId: string): string[] {
  const ids: string[] = [groupId];
  if (groupId === UNGROUPED_ID) return ids;
  let current = app.groupList.find((g) => g.id === groupId);
  const seen = new Set<string>([groupId]);
  while (current) {
    const parentId = (current.parentId || "").trim();
    if (!parentId || seen.has(parentId)) break;
    ids.push(parentId);
    seen.add(parentId);
    current = app.groupList.find((g) => g.id === parentId);
  }
  return ids;
}

/**
 * 滚动到分组区块并高亮（供侧栏「点击分组」调用）。
 * 高亮不自动消失：鼠标移入再移出该区块后才取消（配合侧栏选中态）。
 */
let locateEl: HTMLElement | null = null;

function clearLocateHighlight() {
  locateEl?.classList.remove("is-group-flash");
  locateEl?.removeEventListener("mouseleave", onLocateMouseLeave);
  locateEl = null;
}

function onLocateMouseLeave() {
  clearLocateHighlight();
  app.clearHomeSelectedGroup();
}

async function locateGroup(groupId: string) {
  const ids = collectGroupAncestorIds(groupId);
  window.dispatchEvent(
    new CustomEvent("allhosts:expand-group", { detail: { ids } })
  );
  await nextTick();

  const root = document.querySelector(".all-hosts");
  if (!root) return;
  const el = root.querySelector<HTMLElement>(
    `[data-group-anchor="${CSS.escape(groupId)}"]`
  );
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "start" });

  clearLocateHighlight();
  locateEl = el;
  // 先移后加：若鼠标本就悬停在该区块内，不触发 mouseleave，保持常亮直到移出
  el.addEventListener("mouseleave", onLocateMouseLeave);
  el.classList.add("is-group-flash");
}

onMounted(() => {
  app.registerHomeGroupLocator(locateGroup);
});

onBeforeUnmount(() => {
  if (app) app.registerHomeGroupLocator(null);
  clearLocateHighlight();
});
</script>

<style scoped lang="scss">
.all-hosts {
  min-height: 200px;
}

.host-filter__input {
  width: min(360px, 42vw);

  :deep(.el-input__wrapper) {
    min-height: 32px;
    border-radius: 10px;
    background: var(--m3-surface-container-lowest, #fff);
    box-shadow: none !important;
    border: 1px solid var(--m3-outline-variant, #e4e7ed);
  }

  :deep(.el-input__wrapper:hover) {
    border-color: var(--m3-outline, #646a73);
  }

  :deep(.el-input__wrapper.is-focus) {
    border-color: var(--m3-primary);
  }

  :deep(.el-input__inner) {
    font: var(--m3-body-medium);
  }
}

.host-filter__icon {
  font-size: 16px;
  color: var(--m3-on-surface-variant);
}

/* ---------- 置顶主机：轻量分隔行，拖拽落点时再强调 ---------- */
.pinned-section {
  position: relative;
  min-width: 0;
  padding: 6px 0 10px;
  margin-bottom: 14px;
  border-bottom: 1px solid var(--m3-outline-variant, #e4e7ed);
  border-radius: 0;
  background: transparent;
  transition: box-shadow 0.2s ease, background-color 0.2s ease;

  &.is-drop-target {
    padding: 8px 12px;
    border-radius: 10px;
    border-bottom-color: transparent;
    background: color-mix(in srgb, var(--m3-primary) 14%, transparent);
    outline: 2px dashed var(--m3-primary);
    outline-offset: 2px;
  }
}

.pinned-section__head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
  min-height: 24px;
}

.pinned-section__dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
  background: var(--m3-primary);
}

.pinned-section__name {
  font-size: 13px;
  font-weight: 650;
  letter-spacing: 0.02em;
  line-height: 1.3;
  color: var(--m3-primary);
}

.pinned-section__count {
  font-size: 12px;
  font-weight: 600;
  min-width: 20px;
  height: 20px;
  line-height: 20px;
  text-align: center;
  padding: 0 7px;
  border-radius: 10px;
  color: var(--m3-primary);
  background: color-mix(in srgb, var(--m3-primary) 14%, transparent);
}

.pinned-section__summary {
  font-size: 12px;
  font-weight: 500;
  opacity: 0.78;
  white-space: nowrap;
  color: var(--m3-primary);
}

.pinned-section__hint {
  margin: 0;
  padding: 8px;
  border: 1.5px dashed color-mix(in srgb, var(--m3-primary) 55%, transparent);
  border-radius: 8px;
  font-size: 12px;
  font-weight: 500;
  text-align: center;
  color: var(--el-text-color-secondary);
  pointer-events: none;
}

.pinned-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 8px;
}

/* ---------- 分组树 ---------- */
.group-sections {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
</style>
