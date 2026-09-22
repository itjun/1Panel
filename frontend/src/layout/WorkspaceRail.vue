<template>
  <aside
    class="app-nav workspace-rail no-drag is-wide"
    :class="{ 'is-mac': isMac }"
    aria-label="应用导航"
  >
    <div
      class="app-nav__traffic drag-region"
      @dblclick="chrome.toggleMaximise()"
      @contextmenu.prevent="chrome.openMenu($event)"
    />
    <nav v-if="!terminalOnly" class="app-nav__main no-drag">
      <button
        type="button"
        class="app-nav__btn"
        :class="{ active: !app.settingsOpen && app.workspace === 'remote' }"
        @pointerdown="(e) => pointerAction(e, onHostsClick)"
        @click="clickAction(onHostsClick)"
      >
        <span class="app-nav__icon">
          <el-icon><Monitor /></el-icon>
        </span>
        <span class="app-nav__label">主机</span>
      </button>
      <button
        type="button"
        class="app-nav__btn"
        :class="{ active: !app.settingsOpen && app.workspace === 'terminal' }"
        @pointerdown="(e) => pointerAction(e, onTerminalClick)"
        @click="clickAction(onTerminalClick)"
        @contextmenu.prevent.stop="openTerminalNavMenu($event)"
        draggable="true"
        @dragstart="onTerminalNavDragStart"
      >
        <span class="app-nav__icon">
          <el-icon><Connection /></el-icon>
          <span v-if="deskCount > 0" class="app-nav__count">{{ deskCount > 99 ? "99+" : deskCount }}</span>
        </span>
        <span class="app-nav__label">终端</span>
      </button>
    </nav>

    <div
      class="app-nav__sessions no-drag"
      :class="{ 'is-host-drop-target': hostCardDropTarget }"
      :data-host-session-drop="listKind === 'hosts' ? 'true' : undefined"
      @contextmenu.prevent="onSessionsContextMenu"
    >
      <template v-if="listKind === 'terminal'">
        <button
          v-for="desk in app.terminalDesks"
          :key="desk.id"
          type="button"
          class="app-nav__sess"
          :class="{
            active: desk.id === app.activeTerminalId,
            'is-dragging': dragDeskId === desk.id,
            'is-drop-before': dropDeskId === desk.id && dropDeskPosition === 'before',
            'is-drop-after': dropDeskId === desk.id && dropDeskPosition === 'after',
          }"
          :title="desk.host ? deskLabel(desk) + '（同窗口可拖动排序；拖到其他窗口移动会话；拖出窗口移动到新窗口）' : deskLabel(desk)"
          :draggable="!!desk.host"
          @pointerdown="(e) => onDeskDown(e, desk)"
          @click="clickAction(() => pickDesk(desk.id))"
          @contextmenu.prevent="openDeskMenu($event, desk)"
          @dragstart="onDeskDragStart($event, desk)"
          @dragover.prevent="onDeskDragOver($event, desk)"
          @dragleave="onDeskDragLeave(desk)"
          @drop.stop.prevent="onDeskDrop($event, desk)"
          @dragend="onDeskDragEnd"
        >
          {{ deskLabel(desk) }}
        </button>
        <button
          type="button"
          class="app-nav__sess app-nav__sess--new"
          @pointerdown="(e) => pointerAction(e, onNewTerminal)"
          @click="clickAction(onNewTerminal)"
        >
          + 新建终端
        </button>
      </template>

      <template v-else-if="listKind === 'notify'">
        <button
          type="button"
          class="app-nav__sess"
          :class="{ active: app.notifySection === 'metricMessages' }"
          @pointerdown="(e) => pointerAction(e, () => app.setNotifySection('metricMessages'))"
          @click="clickAction(() => app.setNotifySection('metricMessages'))"
        >
          指标消息
          <span v-if="metricUnread > 0" class="app-nav__sess-count">{{ metricUnread > 99 ? "99+" : metricUnread }}</span>
        </button>
        <button
          type="button"
          class="app-nav__sess"
          :class="{ active: app.notifySection === 'appMessages' }"
          @pointerdown="(e) => pointerAction(e, () => app.setNotifySection('appMessages'))"
          @click="clickAction(() => app.setNotifySection('appMessages'))"
        >
          应用消息
          <span v-if="appUnread > 0" class="app-nav__sess-count">{{ appUnread > 99 ? "99+" : appUnread }}</span>
        </button>
        <button
          type="button"
          class="app-nav__sess"
          :class="{ active: app.notifySection === 'metricSubs' }"
          @pointerdown="(e) => pointerAction(e, () => app.setNotifySection('metricSubs'))"
          @click="clickAction(() => app.setNotifySection('metricSubs'))"
        >
          指标订阅
        </button>
        <button
          type="button"
          class="app-nav__sess"
          :class="{ active: app.notifySection === 'appSubs' }"
          @pointerdown="(e) => pointerAction(e, () => app.setNotifySection('appSubs'))"
          @click="clickAction(() => app.setNotifySection('appSubs'))"
        >
          应用订阅
        </button>
        <button
          type="button"
          class="app-nav__sess"
          :class="{ active: app.notifySection === 'setup' }"
          @pointerdown="(e) => pointerAction(e, () => app.setNotifySection('setup'))"
          @click="clickAction(() => app.setNotifySection('setup'))"
        >
          通知设置
        </button>
      </template>

      <template v-else-if="listKind === 'settings'">
        <button
          v-for="sec in settingSections"
          :key="sec.id"
          type="button"
          class="app-nav__sess"
          :class="{ active: app.settingsSection === sec.id }"
          @pointerdown="(e) => pointerAction(e, () => jumpSettings(sec.id))"
          @click="clickAction(() => jumpSettings(sec.id))"
        >
          {{ sec.label }}
        </button>
      </template>

      <template v-else>
        <template v-for="entry in app.railEntries" :key="entry.key">
          <button
            v-if="entry.kind === 'host'"
            type="button"
            class="app-nav__sess"
            :class="{
              active: entry.session.id === app.activeSessionId,
              'is-selected': selectedHostSessionIds.includes(entry.session.id),
              'is-dragging': railDragKey === entry.key,
              'is-drop-before': railDropKey === entry.key && railDropPos === 'before',
              'is-drop-after': railDropKey === entry.key && railDropPos === 'after',
            }"
            :title="entry.session.title || entry.session.host"
            @pointerdown="(e) => onHostSessionPointerDown(e, entry.session)"
            @click="clickAction(() => pickHostSession(entry.session.id))"
            @contextmenu.prevent.stop="openHostSessionMenu($event, entry.session)"
            draggable="true"
            @dragstart="onRailDragStart($event, entry.key)"
            @dragover.prevent="onRailDragOver($event, entry.key)"
            @dragleave="onRailDragLeave(entry.key)"
            @drop.prevent="onRailDrop($event, entry.key)"
            @dragend="onRailDragEnd"
          >
            <span class="app-nav__sess-label">{{ entry.session.title || entry.session.host }}</span>
          </button>
          <button
            v-else
            type="button"
            class="app-nav__sess app-nav__sess--group"
            :class="{
              active: app.isGroupVisible(entry.key),
              'is-dragging': railDragKey === entry.key,
              'is-drop-before': railDropKey === entry.key && railDropPos === 'before',
              'is-drop-after': railDropKey === entry.key && railDropPos === 'after',
            }"
            :title="app.groupNameOf(entry.key)"
            @pointerdown="(e) => pointerAction(e, () => app.openGroupTab(entry.key))"
            @click="clickAction(() => app.openGroupTab(entry.key))"
            @contextmenu.prevent="openGroupEntryMenu($event, entry.key)"
            draggable="true"
            @dragstart="onRailDragStart($event, entry.key)"
            @dragover.prevent="onRailDragOver($event, entry.key)"
            @dragleave="onRailDragLeave(entry.key)"
            @drop.prevent="onRailDrop($event, entry.key)"
            @dragend="onRailDragEnd"
          >
            <el-icon class="app-nav__sess-icon"><Folder /></el-icon>
            <span class="app-nav__sess-label">{{ app.groupNameOf(entry.key) }}</span>
          </button>
        </template>
      </template>
    </div>

    <div
      v-if="!terminalOnly"
      class="app-nav__gap drag-region"
      @dblclick="chrome.toggleMaximise()"
      @contextmenu.prevent="chrome.openMenu($event)"
    />
    <nav v-if="!terminalOnly" class="app-nav__side no-drag">
      <button
        type="button"
        class="app-nav__btn"
        :class="{ active: !app.settingsOpen && app.workspace === 'notify' }"
        @pointerdown="(e) => pointerAction(e, onNotifyClick)"
        @click="clickAction(onNotifyClick)"
      >
        <span class="app-nav__icon">
          <el-icon><Bell /></el-icon>
          <span v-if="alertHistory.unread > 0" class="app-nav__count">
            {{ alertHistory.unread > 99 ? "99+" : alertHistory.unread }}
          </span>
        </span>
        <span class="app-nav__label">通知</span>
      </button>
      <button
        type="button"
        class="app-nav__btn"
        :class="{ active: app.settingsOpen }"
        @pointerdown="(e) => pointerAction(e, onSettingsClick)"
        @click="clickAction(onSettingsClick)"
      >
        <span class="app-nav__icon">
          <el-icon><Setting /></el-icon>
        </span>
        <span class="app-nav__label">设置</span>
      </button>
    </nav>
  </aside>

  <Teleport to="body">
    <div
      v-if="deskMenu"
      class="host-ctx-backdrop"
      @mousedown="deskMenu = null"
      @contextmenu.prevent="deskMenu = null"
    />
    <div
      v-if="deskMenu"
      class="host-ctx-menu"
      :style="{ left: deskMenu.x + 'px', top: deskMenu.y + 'px' }"
      @mousedown.stop
    >
      <template v-if="deskMenu.host">
        <button type="button" class="ctx-item" @click="duplicateDeskInCurrentWindow">
          复制到新标签
        </button>
        <button type="button" class="ctx-item" @click="duplicateDeskInNewWindow">
          复制到新窗口
        </button>
        <button type="button" class="ctx-item" @click="moveDeskToNewWindow">
          移动到新窗口
        </button>
        <div class="ctx-divider" />
        <button
          v-for="tab in DESK_MENU_TABS"
          :key="tab.value"
          type="button"
          class="ctx-item"
          @click="openDeskTool(tab.value)"
        >
          打开{{ tab.label }}
        </button>
        <div class="ctx-divider" />
      </template>
      <button type="button" class="ctx-item" @click="renameDesk">重命名</button>
      <button type="button" class="ctx-item is-danger" @click="closeMenuDesk">关闭</button>
    </div>
  </Teleport>

  <Teleport to="body">
    <div
      v-if="terminalNavMenu"
      class="host-ctx-backdrop"
      @mousedown="terminalNavMenu = null"
      @contextmenu.prevent="terminalNavMenu = null"
    />
    <div
      v-if="terminalNavMenu"
      class="host-ctx-menu"
      :style="{ left: terminalNavMenu.x + 'px', top: terminalNavMenu.y + 'px' }"
      @mousedown.stop
    >
      <button type="button" class="ctx-item" @click="openTerminalNavInNewWindow">
        在新窗口打开终端
      </button>
      <template v-for="item in hiddenTerminalWindows" :key="item.windowId">
        <div class="ctx-divider" />
        <button type="button" class="ctx-item" @click="focusHiddenTerminalWindow(item.windowId)">
          恢复终端窗口 {{ item.windowId.replace('terminal-', '#') }}
        </button>
      </template>
    </div>
  </Teleport>

  <Teleport to="body">
    <div
      v-if="hostSessionMenu"
      class="host-ctx-backdrop"
      @mousedown="hostSessionMenu = null"
      @contextmenu.prevent="hostSessionMenu = null"
    />
    <div
      v-if="hostSessionMenu"
      class="host-ctx-menu"
      :style="{ left: hostSessionMenu.x + 'px', top: hostSessionMenu.y + 'px' }"
      @mousedown.stop
    >
      <div class="ctx-batch-hint">已选 {{ hostSessionMenu.ids.length }} 台主机</div>
      <button
        v-for="tab in batchOpenTabs"
        :key="tab.value"
        type="button"
        class="ctx-item"
        @click="batchOpenHostTab(tab.value)"
      >
        打开{{ tab.label }}
      </button>
      <div class="ctx-divider" />
      <button type="button" class="ctx-item" @click="openSelectedTerminals">
        单独打开终端
      </button>
      <button
        type="button"
        class="ctx-item"
        :disabled="hostSessionMenu.ids.length < 2"
        @click="mergeSelectedTerminals"
      >
        合并打开终端
      </button>
      <div class="ctx-divider" />
      <button type="button" class="ctx-item" @click="openSelectedTerminalsInNewWindow">
        在新窗口打开终端
      </button>
      <button
        type="button"
        class="ctx-item"
        :disabled="hostSessionMenu.ids.length < 2"
        @click="mergeSelectedTerminalsInNewWindow"
      >
        合并到新窗口终端
      </button>
      <div class="ctx-divider" />
      <button type="button" class="ctx-item is-danger" @click="closeHostSessionsFromMenu">
        关闭主机连接
      </button>
    </div>
  </Teleport>

  <!-- 分组条目右键：当前只提供关闭 -->
  <Teleport to="body">
    <div
      v-if="groupEntryMenu"
      class="host-ctx-backdrop"
      @mousedown="groupEntryMenu = null"
      @contextmenu.prevent="groupEntryMenu = null"
    />
    <div
      v-if="groupEntryMenu"
      class="host-ctx-menu"
      :style="{ left: groupEntryMenu.x + 'px', top: groupEntryMenu.y + 'px' }"
      @mousedown.stop
    >
      <button type="button" class="ctx-item" @click="closeGroupEntryFromMenu">
        关闭分组页
      </button>
    </div>
  </Teleport>

  <!-- 单台右键：与主机列表页共用同一份 HostContextMenu -->
  <HostContextMenu
    :menu="hostMenu"
    @close="hostMenu = null"
    @edit="(host) => (editHostName = host)"
    @move="onHostCtxMove"
  />
  <HostEditDrawer
    :host="editHost"
    :os-release="editOsRelease"
    @close="editHostName = null"
  />
</template>

<script setup lang="ts">
import { Bell, Connection, Folder, Monitor, Setting } from "@element-plus/icons-vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { Events } from "@wailsio/runtime";
import { api } from "@/api";
import type { main } from "@/api";
import { HOST_SUB_TABS } from "@/constants/hostSubTabs";
import {
  UNGROUPED_ID,
  useAppStore,
  type SubTab,
  type TerminalDesk,
  type WorkspaceSession,
} from "@/stores/app";
import HostContextMenu, {
  type CtxMenuState,
} from "@/components/sidebar/HostContextMenu.vue";
import HostEditDrawer from "@/components/sidebar/HostEditDrawer.vue";
import { useAlertHistoryStore } from "@/stores/alertHistory";
import type { SettingsSection } from "@/stores/settings";
import { parseAppAlertKind } from "@/utils/watchServices";
import { useChromeDrag } from "@/composables/useChromeDrag";
import { useInjectedHostDrag } from "@/composables/useHostDrag";
import { clickAction, pointerAction } from "@/utils/pointerAction";
import { clampContextMenuPos } from "@/utils/contextMenuPos";
import { SPLIT_TITLE } from "@/utils/workspaceMigrate";

const props = defineProps<{ terminalOnly?: boolean }>();
const terminalOnly = computed(() => props.terminalOnly === true);
const app = useAppStore();
const alertHistory = useAlertHistoryStore();
const chrome = useChromeDrag();
const { hostSessionDropTarget: hostCardDropTarget, moveHostToGroup } =
  useInjectedHostDrag();
const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
/** 未选主机的「新建终端」占位标签不计入角标。 */
const deskCount = computed(() => app.terminalDesks.filter((d) => d.host).length);

function isAppAlertEvent(kind: string): boolean {
  return !!parseAppAlertKind(kind) || (kind || "").startsWith("app:");
}

const metricUnread = computed(
  () => alertHistory.events.filter((e) => !e.read && !isAppAlertEvent(e.kind)).length
);
const appUnread = computed(
  () => alertHistory.events.filter((e) => !e.read && isAppAlertEvent(e.kind)).length
);
const listKind = computed(() => {
  if (terminalOnly.value) return "terminal";
  if (app.settingsOpen) return "settings";
  if (app.workspace === "notify") return "notify";
  if (app.workspace === "terminal") return "terminal";
  return "hosts";
});
const settingSections: { id: SettingsSection; label: string }[] = [
  { id: "look", label: "外观" },
  { id: "session", label: "会话" },
  { id: "app", label: "应用" },
];
function deskLabel(d: TerminalDesk): string {
  if (d.titleCustom && d.title) return d.title;
  if (!d.host) return d.title || "新建终端";
  if (d.crossHost) return d.title || SPLIT_TITLE;
  return `${d.host} · ${d.title || "终端"}`;
}

type DeskMenu = { id: string; host: string; title: string; x: number; y: number };
/** 终端标签右键只留常用跳转（概览/XFPT/监控），其余入口去主机管理页找。 */
const DESK_MENU_TABS = HOST_SUB_TABS.filter((t) =>
  ["overview", "files", "monitor"].includes(t.value)
);
const deskMenu = ref<DeskMenu | null>(null);
type TerminalNavMenu = { x: number; y: number };
const terminalNavMenu = ref<TerminalNavMenu | null>(null);
const hiddenTerminalWindows = ref<main.TerminalWindowInfo[]>([]);
type HostSessionMenu = { ids: string[]; x: number; y: number };
const hostSessionMenu = ref<HostSessionMenu | null>(null);
type GroupEntryMenu = { id: string; x: number; y: number };
const groupEntryMenu = ref<GroupEntryMenu | null>(null);

function openGroupEntryMenu(e: MouseEvent, id: string) {
  const pos = clampContextMenuPos(e.clientX, e.clientY, 180, 96);
  groupEntryMenu.value = { id, x: pos.x, y: pos.y };
}

function closeGroupEntryFromMenu() {
  const id = groupEntryMenu.value?.id;
  groupEntryMenu.value = null;
  if (id) app.closeGroupTab(id);
}
const hostMenu = ref<CtxMenuState | null>(null);
const editHostName = ref<string | null>(null);
const editHost = computed(
  () => app.hosts.find((h) => h.name === editHostName.value) || null
);
const editOsRelease = computed(
  () => (editHostName.value && app.osReleaseMap.get(editHostName.value)) || ""
);
// 编辑抽屉跟随当前主机：切到其他主机、或离开主机列表（终端/通知/设置）即自动收起
watch(
  () => [app.activeSession?.host, listKind.value] as const,
  ([host, kind]) => {
    if (!editHostName.value) return;
    if (host !== editHostName.value || kind !== "hosts") editHostName.value = null;
  }
);
const selectedHostSessionIds = ref<string[]>([]);
const suppressHostSessionClick = ref(false);
/** 侧栏条目统一拖拽排序：主机与分组条目可互拖换位 */
const RAIL_ENTRY_MIME = "application/x-rail-entry";
const railDragKey = ref("");
const railDropKey = ref("");
/** 落点在目标条目前还是后：按悬停上下半区判定，插入线跟着画 */
const railDropPos = ref<"before" | "after">("before");

function onRailDragStart(e: DragEvent, key: string) {
  if (!e.dataTransfer) return;
  suppressHostSessionClick.value = true;
  railDragKey.value = key;
  e.dataTransfer.effectAllowed = "move";
  e.dataTransfer.setData(RAIL_ENTRY_MIME, key);
  e.dataTransfer.setData("text/plain", key);
}

function isRailEntryDrag(e: DragEvent): boolean {
  return Array.from(e.dataTransfer?.types || []).includes(RAIL_ENTRY_MIME);
}

function onRailDragOver(e: DragEvent, key: string) {
  if (!isRailEntryDrag(e) || key === railDragKey.value) return;
  if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
  const rect = (e.currentTarget as HTMLElement | null)?.getBoundingClientRect();
  railDropPos.value =
    rect && e.clientY < rect.top + rect.height / 2 ? "before" : "after";
  railDropKey.value = key;
}

function onRailDragLeave(key: string) {
  if (railDropKey.value === key) railDropKey.value = "";
}

function onRailDrop(e: DragEvent, key: string) {
  railDropKey.value = "";
  const sourceKey = e.dataTransfer?.getData(RAIL_ENTRY_MIME) || "";
  if (sourceKey) app.moveRailEntry(sourceKey, key, railDropPos.value === "before");
}

function onRailDragEnd() {
  railDragKey.value = "";
  railDropKey.value = "";
  window.setTimeout(() => {
    suppressHostSessionClick.value = false;
  }, 0);
}

/** 范围选择锚点：普通 / Cmd 点击时更新，Shift 点击沿用 */
let hostSessionAnchorId = "";

function onHostSessionPointerDown(e: PointerEvent, session: WorkspaceSession) {
  if (e.button !== 0 || suppressHostSessionClick.value) return;
  if (e.metaKey || e.ctrlKey) {
    // 修饰键选择也走 pointerAction，让随后的鼠标 click 由全局 mouseHandled 跳过
    pointerAction(e, () => {
      const next = new Set(selectedHostSessionIds.value);
      if (next.has(session.id)) next.delete(session.id);
      else next.add(session.id);
      selectedHostSessionIds.value = [...next];
      hostSessionAnchorId = session.id;
    });
    return;
  }
  if (e.shiftKey && hostSessionAnchorId) {
    pointerAction(e, () => {
      const ids = app.workspaceSessions.map((s) => s.id);
      const from = ids.indexOf(hostSessionAnchorId);
      const to = ids.indexOf(session.id);
      if (from < 0 || to < 0) return;
      const lo = Math.min(from, to);
      const hi = Math.max(from, to);
      selectedHostSessionIds.value = ids.slice(lo, hi + 1);
    });
    return;
  }
  pointerAction(e, () => {
    selectedHostSessionIds.value = [session.id];
    hostSessionAnchorId = session.id;
    app.activateWorkspaceSession(session.id);
  });
}

/** 列表空白处右键：清空主机多选（其他分支的空白右键不做处理） */
function onSessionsContextMenu() {
  if (listKind.value !== "hosts") return;
  selectedHostSessionIds.value = [];
  hostSessionAnchorId = "";
}

function openHostSessionMenu(e: MouseEvent, session: WorkspaceSession) {
  if (!selectedHostSessionIds.value.includes(session.id)) {
    selectedHostSessionIds.value = [session.id];
  }
  app.activateWorkspaceSession(session.id);
  const ids = selectedHostSessionIds.value.filter((id) =>
    app.workspaceSessions.some((item) => item.id === id)
  );
  // 单台右键走与主机列表一致的菜单；多台才出现批量终端菜单
  if (ids.length < 2) {
    hostMenu.value = { host: session.host, x: e.clientX, y: e.clientY };
    return;
  }
  const pos = clampContextMenuPos(e.clientX, e.clientY, 210, 340);
  hostSessionMenu.value = { ids, x: pos.x, y: pos.y };
}

/** 批量打开子页：文案与终端 desk 右键菜单的「打开X」格式保持一致，标签取自 HOST_SUB_TABS */
const batchOpenTabs: { value: SubTab; label: string }[] = [
  { value: "terminal", label: "终端" },
  ...HOST_SUB_TABS.filter((tab) => ["overview", "files", "monitor"].includes(tab.value)),
];

/** 批量打开子页：与列表页多选右键的逐台 openHostTab 一致 */
function batchOpenHostTab(sub: SubTab) {
  const hosts = selectedHostNames();
  hostSessionMenu.value = null;
  for (const host of hosts) {
    app.openHostTab(host, sub);
  }
  selectedHostSessionIds.value = [];
  hostSessionAnchorId = "";
}

async function onHostCtxMove(host: string, groupId: string) {
  await moveHostToGroup(host, groupId || UNGROUPED_ID);
}

async function closeHostSessionsFromMenu() {
  const ids = hostSessionMenu.value?.ids || [];
  hostSessionMenu.value = null;
  const sessions = ids
    .map((id) => app.workspaceSessions.find((item) => item.id === id))
    .filter((item): item is WorkspaceSession => !!item);
  let closed = 0;
  for (const session of sessions) {
    if (await app.closeHostTab(session.host)) closed += 1;
  }
  selectedHostSessionIds.value = selectedHostSessionIds.value.filter(
    (id) => !ids.includes(id)
  );
  if (closed > 1) ElMessage.success(`已关闭 ${closed} 个主机页，终端会话仍保留`);
  else if (closed === 1) ElMessage.success("已关闭主机页，终端会话仍保留");
}

function selectedHostNames(): string[] {
  const ids = hostSessionMenu.value?.ids || [];
  return ids
    .map((id) => app.workspaceSessions.find((item) => item.id === id)?.host || "")
    .filter(Boolean);
}

async function openSelectedTerminals() {
  const hosts = selectedHostNames();
  hostSessionMenu.value = null;
  for (const host of hosts) {
    // 普通批量打开仍留在主窗口；只有下方明确选择新窗口时才脱离。
    app.openAnotherTerminal(host);
    await waitForTerminalDeskRender();
  }
  // 批量动作完成后清空多选，避免选中高亮残留
  selectedHostSessionIds.value = [];
  hostSessionAnchorId = "";
}

async function waitForTerminalDeskRender() {
  await nextTick();
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

async function mergeSelectedTerminals() {
  const hosts = selectedHostNames();
  hostSessionMenu.value = null;
  if (hosts.length < 2) return;
  const deskIds: string[] = [];
  for (const host of hosts) {
    app.openAnotherTerminal(host);
    await waitForTerminalDeskRender();
    const id = app.activeTerminalId;
    if (id && !deskIds.includes(id)) deskIds.push(id);
  }
  const targetId = deskIds[0];
  if (!targetId) return;
  app.activateTerminalDesk(targetId);
  await waitForTerminalDeskRender();
  const jobs = deskIds.slice(1).flatMap((sourceId) => {
    const source = app.terminalDesks.find((desk) => desk.id === sourceId);
    return source ? [{ sourceId, targetId, host: source.host }] : [];
  });
  app.queueTerminalDeskMerges(jobs);
  // 批量动作完成后清空多选，避免选中高亮残留
  selectedHostSessionIds.value = [];
  hostSessionAnchorId = "";
}

async function openSelectedTerminalsInNewWindow() {
  const hosts = selectedHostNames();
  hostSessionMenu.value = null;
  if (hosts.length === 0) return;
  await api.openTerminalWindow({ action: "open-many", hosts });
  selectedHostSessionIds.value = [];
  hostSessionAnchorId = "";
}

async function mergeSelectedTerminalsInNewWindow() {
  const hosts = selectedHostNames();
  hostSessionMenu.value = null;
  if (hosts.length < 2) return;
  await api.openTerminalWindow({ action: "merge", hosts });
  selectedHostSessionIds.value = [];
  hostSessionAnchorId = "";
}

watch(
  () => app.workspaceSessions.map((session) => session.id),
  (ids) => {
    selectedHostSessionIds.value = selectedHostSessionIds.value.filter((id) => ids.includes(id));
  },
  { immediate: true }
);

function openDeskMenu(e: MouseEvent, desk: TerminalDesk) {
  app.activateTerminalDesk(desk.id);
  const approxH = desk.host ? 380 : 96;
  const pos = clampContextMenuPos(e.clientX, e.clientY, 180, approxH);
  deskMenu.value = {
    id: desk.id,
    host: desk.host,
    title: desk.title || "新建终端",
    x: pos.x,
    y: pos.y,
  };
}

function openDeskTool(sub: SubTab) {
  const host = deskMenu.value?.host;
  deskMenu.value = null;
  if (!host) return;
  if (terminalOnly.value) {
    void Events.Emit("terminal-return-host", { host, sub });
    return;
  }
  app.openHostTool(host, sub);
}

async function openDeskInNewWindow() {
  const host = (deskMenu.value?.host || "").trim();
  deskMenu.value = null;
  if (terminalOnly.value) return;
  if (host) await api.openTerminalWindow({ action: "connect", host });
  else await api.openTerminalWindow({ action: "new" });
}

function duplicateDeskInCurrentWindow() {
  const host = (deskMenu.value?.host || "").trim();
  deskMenu.value = null;
  if (host) app.runTermAction("duplicate-current");
}

function duplicateDeskInNewWindow() {
  deskMenu.value = null;
  app.runTermAction("duplicate-new-window");
}

function moveDeskToNewWindow() {
  deskMenu.value = null;
  app.runTermAction("move-new-window");
}

async function renameDesk() {
  const m = deskMenu.value;
  deskMenu.value = null;
  if (!m) return;
  try {
    const { value } = await ElMessageBox.prompt("标签名称", "重命名", {
      inputValue: m.title,
      confirmButtonText: "确定",
      cancelButtonText: "取消",
      inputValidator: (v) => (v || "").trim().length > 0 || "名称不能为空",
    });
    app.setWorkspaceSessionTitle(m.id, (value || "").trim(), true);
  } catch {
    /* 取消 */
  }
}

function closeMenuDesk() {
  const id = deskMenu.value?.id;
  deskMenu.value = null;
  if (id) app.closeTerminalDesk(id, true);
}

function onHostsClick() {
  if (app.workspace === "remote" && !app.settingsOpen) {
    app.goHome();
    return;
  }
  app.setWorkspace("remote");
}

function onTerminalClick() {
  if (terminalOnly.value) return;
  app.setWorkspace("terminal");
  if (!app.activeTerminalId && app.terminalDesks.length > 0) {
    const last = app.terminalDesks[app.terminalDesks.length - 1];
    if (last) app.activateTerminalDesk(last.id);
  }
}

function activeTerminalHost(): string {
  const active = app.terminalDesks.find((d) => d.id === app.activeTerminalId);
  return (active?.host || "").trim();
}

async function openTerminalNavMenu(e: MouseEvent) {
  if (terminalOnly.value) return;
  const pos = clampContextMenuPos(e.clientX, e.clientY, 220, 120);
  terminalNavMenu.value = { x: pos.x, y: pos.y };
  try {
    hiddenTerminalWindows.value = (await api.listTerminalWindows()).filter((item) => !item.visible);
  } catch {
    hiddenTerminalWindows.value = [];
  }
}

async function openTerminalNavInNewWindow() {
  terminalNavMenu.value = null;
  const host = activeTerminalHost();
  if (host) await api.openTerminalWindow({ action: "connect", host });
  else await api.openTerminalWindow({ action: "new" });
}

async function focusHiddenTerminalWindow(windowId: string) {
  terminalNavMenu.value = null;
  hiddenTerminalWindows.value = [];
  await api.focusTerminalWindow(windowId);
}

function onTerminalNavDragStart(e: DragEvent) {
  if (terminalOnly.value) {
    e.preventDefault();
    return;
  }
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = "copy";
    e.dataTransfer.setData("application/x-terminal-window", "terminal");
  }
  void openTerminalNavInNewWindow();
}

function onNotifyClick() {
  app.setWorkspace("notify");
}

function onSettingsClick() {
  app.toggleSettings();
}

function pickDesk(id: string) {
  app.activateTerminalDesk(id);
}

const dragDeskId = ref("");
const dropDeskId = ref("");
const dropDeskPosition = ref<"before" | "after">("after");
let deskDropHandled = false;
let draggedDeskHost = "";
let deskPress: { id: string; x: number; y: number; dragged: boolean } | null = null;
let offTerminalWindowDrop: (() => void) | null = null;

onMounted(() => {
  offTerminalWindowDrop = Events.On(
    "terminal-window-drop",
    (ev: {
      data?: { sourceWindowId?: string; sourceDeskId?: string; targetWindowId?: string };
    }) => {
      const data = ev?.data;
      if (
        data?.sourceWindowId === app.windowId &&
        data.sourceDeskId &&
        data.sourceDeskId === dragDeskId.value
      ) {
        deskDropHandled = true;
      }
    }
  ) as unknown as () => void;
});

onBeforeUnmount(() => {
  offTerminalWindowDrop?.();
  offTerminalWindowDrop = null;
});

function onDeskDown(e: PointerEvent, desk: TerminalDesk) {
  if (e.button !== 0) return;
  if (!desk.host) {
    pointerAction(e, () => pickDesk(desk.id));
    return;
  }
  deskPress = { id: desk.id, x: e.clientX, y: e.clientY, dragged: false };
  const move = (ev: PointerEvent) => {
    if (!deskPress) return;
    if (Math.hypot(ev.clientX - deskPress.x, ev.clientY - deskPress.y) > 6) {
      deskPress.dragged = true;
    }
  };
  const up = (ev: PointerEvent) => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    if (deskPress && !deskPress.dragged) {
      pointerAction(ev, () => pickDesk(deskPress!.id));
    }
    deskPress = null;
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
}

function onDeskDragStart(e: DragEvent, desk: TerminalDesk) {
  if (!desk.host || !e.dataTransfer) {
    e.preventDefault();
    return;
  }
  if (deskPress) deskPress.dragged = true;
  app.activateTerminalDesk(desk.id);
  dragDeskId.value = desk.id;
  draggedDeskHost = desk.host;
  deskDropHandled = false;
  e.dataTransfer.effectAllowed = "move";
  e.dataTransfer.setData(
    "application/x-terminal-desk",
    JSON.stringify({ sourceWindowId: app.windowId, sourceDeskId: desk.id })
  );
  e.dataTransfer.setData("application/x-term-session", desk.id);
  e.dataTransfer.setData("application/x-term-host", desk.host);
  e.dataTransfer.setData("text/plain", desk.id);
}

function isDeskDrag(e: DragEvent): boolean {
  const types = e.dataTransfer?.types;
  if (!types) return false;
  return Array.from(types).includes("application/x-terminal-desk");
}

function onDeskDragOver(e: DragEvent, desk: TerminalDesk) {
  if (!desk.host || !isDeskDrag(e) || desk.id === dragDeskId.value) return;
  if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
  dropDeskId.value = desk.id;
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
  dropDeskPosition.value = e.clientY < rect.top + rect.height / 2 ? "before" : "after";
}

function onDeskDragLeave(desk: TerminalDesk) {
  if (dropDeskId.value === desk.id) {
    dropDeskId.value = "";
    dropDeskPosition.value = "after";
  }
}

function onDeskDrop(e: DragEvent, desk: TerminalDesk) {
  dropDeskId.value = "";
  if (!desk.host || !e.dataTransfer) return;
  const raw = e.dataTransfer.getData("application/x-terminal-desk");
  if (!raw) return;
  let payload: { sourceWindowId?: string; sourceDeskId?: string };
  try {
    payload = JSON.parse(raw) as typeof payload;
  } catch {
    return;
  }
  const sourceId = (payload.sourceDeskId || "").trim();
  if (!sourceId || sourceId === desk.id) return;
  deskDropHandled = true;
  if (payload.sourceWindowId === app.windowId) {
    app.reorderTerminalDesk(sourceId, desk.id, dropDeskPosition.value === "before");
  } else {
    void Events.Emit("terminal-window-drop", {
      sourceWindowId: payload.sourceWindowId || "",
      sourceDeskId: sourceId,
      targetWindowId: app.windowId,
      targetDeskId: desk.id,
      insertBefore: dropDeskPosition.value === "before",
    });
  }
}

function onDeskDragEnd(e: DragEvent) {
  const droppedInsideApp = deskDropHandled || e.dataTransfer?.dropEffect === "move";
  if (draggedDeskHost && !droppedInsideApp) {
    app.runTermAction("move-new-window");
  }
  dragDeskId.value = "";
  dropDeskId.value = "";
  dropDeskPosition.value = "after";
  deskDropHandled = false;
  draggedDeskHost = "";
}

function pickHostSession(id: string) {
  if (suppressHostSessionClick.value) return;
  app.activateWorkspaceSession(id);
}

function jumpSettings(id: SettingsSection) {
  app.setSettingsSection(id);
  app.openSettings();
}

function onNewTerminal() {
  app.openNewTerminalPicker();
}

watch(
  () => app.termActionN,
  () => {
    if (app.termActionName === "new") app.openNewTerminalPicker();
  }
);
</script>

<style scoped lang="scss">
.app-nav {
  position: relative;
  z-index: 80;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  box-sizing: border-box;
  width: var(--m3-rail-width);
  min-width: var(--m3-rail-width);
  height: 100%;
  padding: 0 6px 10px;
  background: var(--m3-shell);
  color: var(--m3-on-surface);
  user-select: none;
  border-right: 1px solid var(--m3-outline-variant);
}

.app-nav.is-wide {
  width: 220px;
  min-width: 220px;
}

.app-nav__traffic {
  flex-shrink: 0;
  height: 10px;
}

.app-nav.is-mac .app-nav__traffic {
  height: 40px;
}

.app-nav__main,
.app-nav__side {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 4px;
}

.app-nav__sessions {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex: 1 1 auto;
  min-height: 0;
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--m3-outline-variant);
  overflow: auto;
}

.app-nav__sessions.is-host-drop-target {
  outline: 2px dashed var(--m3-primary);
  outline-offset: -3px;
  background: color-mix(in srgb, var(--m3-primary) 6%, transparent);
}

.app-nav__gap {
  flex: 0 0 12px;
  min-height: 12px;
}

.app-nav.is-wide .app-nav__gap {
  flex: 0 0 8px;
}

.app-nav__btn {
  appearance: none;
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  min-height: 56px;
  padding: 8px 4px;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  color: var(--m3-on-surface-variant);
  font: var(--m3-label-medium);
  cursor: pointer;

  .el-icon {
    font-size: 20px;
  }

  &:hover {
    color: var(--m3-on-surface);
    background: color-mix(in srgb, var(--m3-on-surface) 8%, transparent);
  }

  &.active {
    color: var(--m3-nav-active-fg);
    background: var(--m3-nav-active-bg);
    font-weight: 600;
  }

  &:focus-visible {
    outline: var(--m3-focus-ring);
    outline-offset: 1px;
  }
}

.app-nav.is-wide .app-nav__btn {
  flex-direction: row;
  justify-content: flex-start;
  min-height: 40px;
  padding: 0 10px;
  gap: 8px;
}

.app-nav__icon {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
}

.app-nav__label {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  line-height: 1.2;
}

.app-nav__count {
  position: absolute;
  top: -4px;
  right: -8px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  border-radius: 8px;
  background: var(--m3-error);
  color: #fff;
  font-size: 10px;
  font-weight: 700;
  line-height: 1;
}

.app-nav__sess {
  appearance: none;
  position: relative;
  display: flex;
  align-items: center;
  width: 100%;
  min-height: 40px;
  margin: 0;
  padding: 0 10px;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  color: var(--m3-on-surface-variant);
  font: var(--m3-label-large);
  text-align: left;
  overflow: hidden;
  white-space: nowrap;
  cursor: pointer;

  /* 拖拽换位用插入线标记落点，不用整框高亮 */
  &.is-drop-before::before,
  &.is-drop-after::after {
    content: "";
    position: absolute;
    left: 4px;
    right: 4px;
    height: 3px;
    border-radius: 2px;
    background: var(--m3-primary);
    pointer-events: none;
  }

  &.is-drop-before::before {
    top: 0;
  }

  &.is-drop-after::after {
    bottom: 0;
  }

  &:hover {
    color: var(--m3-on-surface);
    background: color-mix(in srgb, var(--m3-on-surface) 8%, transparent);
  }

  /* 多选项与单击选中的高亮保持一致：只用底色高亮，不加竖条 */
  &.active,
  &.is-selected {
    color: var(--m3-nav-active-fg);
    background: var(--m3-nav-active-bg);
    font-weight: 600;
  }

  &.is-dragging {
    opacity: 0.45;
  }

  &.is-drop {
    color: var(--m3-primary);
    border-color: var(--m3-primary);
    background: color-mix(in srgb, var(--m3-primary) 10%, transparent);
  }
}

.app-nav__sess-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.app-nav__sess--group .app-nav__sess-icon {
  flex-shrink: 0;
  margin-right: 6px;
  font-size: 14px;
}

.app-nav__sess-count {
  margin-left: auto;
  min-width: 16px;
  padding: 0 5px;
  border-radius: 8px;
  background: var(--m3-error);
  color: #fff;
  font-size: 10px;
  font-weight: 700;
  line-height: 16px;
}

.app-nav__sess--new {
  margin-top: 8px;
  justify-content: center;
  border: 1px dashed var(--m3-outline);
  color: var(--m3-on-surface-variant);
  background: transparent;
}
</style>

<style>
/* 与 HostContextMenu 同类名：终端页不会挂载主机菜单，这里自带一份以免样式丢失。 */
.host-ctx-backdrop {
  position: fixed;
  inset: 0;
  z-index: 100000;
}

.host-ctx-menu {
  position: fixed;
  z-index: 100001;
  min-width: 180px;
  padding: 8px;
  border-radius: var(--m3-shape-s);
  background: var(--m3-surface-container-lowest);
  border: none;
  box-shadow: var(--m3-elevation-2);
  font: var(--m3-label-large);
  color: var(--m3-on-surface);
  user-select: none;
}

.host-ctx-menu .ctx-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  min-height: 40px;
  margin: 0;
  padding: 8px 12px;
  border: none;
  border-radius: var(--m3-shape-xs);
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
  box-sizing: border-box;
  white-space: nowrap;
}

.host-ctx-menu .ctx-item:hover {
  background: color-mix(in srgb, var(--m3-primary) 8%, transparent);
}

.host-ctx-menu .ctx-item.is-danger {
  color: var(--m3-error);
}

.host-ctx-menu .ctx-item.is-danger:hover {
  background: color-mix(in srgb, var(--m3-error) 8%, transparent);
}

.host-ctx-menu .ctx-divider {
  height: 1px;
  margin: 4px 8px;
  background: var(--m3-outline-variant);
}
</style>
