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
    <nav class="app-nav__main no-drag">
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
            'is-drop': dropDeskId === desk.id,
          }"
          :title="desk.host ? deskLabel(desk) + '（拖到另一个会话可合并分屏）' : deskLabel(desk)"
          :draggable="!!desk.host"
          @pointerdown="(e) => onDeskDown(e, desk)"
          @click="clickAction(() => pickDesk(desk.id))"
          @contextmenu.prevent="openDeskMenu($event, desk)"
          @dragstart="onDeskDragStart($event, desk)"
          @dragover.prevent="onDeskDragOver($event, desk)"
          @dragleave="onDeskDragLeave(desk)"
          @drop.prevent="onDeskDrop($event, desk)"
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
          :class="{ active: app.notifySection === 'messages' }"
          @pointerdown="(e) => pointerAction(e, () => app.setNotifySection('messages'))"
          @click="clickAction(() => app.setNotifySection('messages'))"
        >
          消息
          <span v-if="alertHistory.unread > 0" class="app-nav__sess-count">{{ alertHistory.unread }}</span>
        </button>
        <button
          type="button"
          class="app-nav__sess"
          :class="{ active: app.notifySection === 'setup' }"
          @pointerdown="(e) => pointerAction(e, () => app.setNotifySection('setup'))"
          @click="clickAction(() => app.setNotifySection('setup'))"
        >
          设置
        </button>
      </template>

      <template v-else-if="listKind === 'settings'">
        <button
          v-for="sec in settingSections"
          :key="sec.id"
          type="button"
          class="app-nav__sess"
          :class="{ active: settingsJump === sec.id }"
          @pointerdown="(e) => pointerAction(e, () => jumpSettings(sec.id))"
          @click="clickAction(() => jumpSettings(sec.id))"
        >
          {{ sec.label }}
        </button>
      </template>

      <template v-else>
        <button
          v-for="s in app.workspaceSessions"
          :key="s.id"
          type="button"
          class="app-nav__sess"
          :class="{
            active: s.id === app.activeSessionId,
            'is-selected': selectedHostSessionIds.includes(s.id),
            'is-dragging': hostSessionDragId === s.id,
            'is-drop': hostSessionDropId === s.id,
          }"
          :title="s.title || s.host"
          @pointerdown="(e) => onHostSessionPointerDown(e, s)"
          @click="clickAction(() => pickHostSession(s.id))"
          @contextmenu.prevent.stop="openHostSessionMenu($event, s)"
          draggable="true"
          @dragstart="onHostSessionDragStart($event, s)"
          @dragover.prevent="onHostSessionDragOver($event, s)"
          @dragleave="onHostSessionDragLeave(s)"
          @drop.prevent="onHostSessionDrop($event, s)"
          @dragend="onHostSessionDragEnd"
        >
          <span class="app-nav__sess-label">{{ s.title || s.host }}</span>
        </button>
      </template>
    </div>

    <div
      class="app-nav__gap drag-region"
      @dblclick="chrome.toggleMaximise()"
      @contextmenu.prevent="chrome.openMenu($event)"
    />
    <nav class="app-nav__side no-drag">
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
        <button
          v-for="tab in HOST_SUB_TABS"
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
      <button type="button" class="ctx-item is-danger" @click="closeHostSessionsFromMenu">
        关闭主机连接
      </button>
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
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { Bell, Connection, Monitor, Setting } from "@element-plus/icons-vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { computed, nextTick, ref, watch } from "vue";
import { HOST_SUB_TABS } from "@/constants/hostSubTabs";
import {
  useAppStore,
  type SubTab,
  type TerminalDesk,
  type WorkspaceSession,
} from "@/stores/app";
import { useAlertHistoryStore } from "@/stores/alertHistory";
import { useChromeDrag } from "@/composables/useChromeDrag";
import { useInjectedHostDrag } from "@/composables/useHostDrag";
import { clickAction, pointerAction } from "@/utils/pointerAction";
import { clampContextMenuPos } from "@/utils/contextMenuPos";
import { SPLIT_TITLE } from "@/utils/workspaceMigrate";

const app = useAppStore();
const alertHistory = useAlertHistoryStore();
const chrome = useChromeDrag();
const { hostSessionDropTarget: hostCardDropTarget } = useInjectedHostDrag();
const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
const deskCount = computed(() => app.terminalDesks.length);
const listKind = computed(() => {
  if (app.settingsOpen) return "settings";
  if (app.workspace === "notify") return "notify";
  if (app.workspace === "terminal") return "terminal";
  return "hosts";
});
const settingSections = [
  { id: "settings-look", label: "外观" },
  { id: "settings-session", label: "会话" },
  { id: "settings-app", label: "应用" },
];
const settingsJump = ref("settings-look");
function deskLabel(d: TerminalDesk): string {
  if (d.titleCustom && d.title) return d.title;
  if (!d.host) return d.title || "新建终端";
  if (d.crossHost) return d.title || SPLIT_TITLE;
  return `${d.host} · ${d.title || "终端"}`;
}

type DeskMenu = { id: string; host: string; title: string; x: number; y: number };
const deskMenu = ref<DeskMenu | null>(null);
type HostSessionMenu = { ids: string[]; x: number; y: number };
const hostSessionMenu = ref<HostSessionMenu | null>(null);
const selectedHostSessionIds = ref<string[]>([]);
const hostSessionDragId = ref("");
const hostSessionDropId = ref("");
const suppressHostSessionClick = ref(false);

function onHostSessionDragStart(e: DragEvent, session: WorkspaceSession) {
  if (!e.dataTransfer) return;
  hostSessionDragId.value = session.id;
  suppressHostSessionClick.value = true;
  e.dataTransfer.effectAllowed = "move";
  e.dataTransfer.setData("application/x-host-workspace-session", session.id);
  e.dataTransfer.setData("text/plain", session.id);
}

function isHostSessionDrag(e: DragEvent): boolean {
  return Array.from(e.dataTransfer?.types || []).includes(
    "application/x-host-workspace-session"
  );
}

function onHostSessionDragOver(e: DragEvent, session: WorkspaceSession) {
  if (!isHostSessionDrag(e) || session.id === hostSessionDragId.value) return;
  if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
  hostSessionDropId.value = session.id;
}

function onHostSessionDragLeave(session: WorkspaceSession) {
  if (hostSessionDropId.value === session.id) hostSessionDropId.value = "";
}

function onHostSessionDrop(e: DragEvent, target: WorkspaceSession) {
  const sourceId = e.dataTransfer?.getData("application/x-host-workspace-session") || "";
  hostSessionDropId.value = "";
  if (!sourceId || sourceId === target.id) return;
  const from = app.workspaceSessions.findIndex((s) => s.id === sourceId);
  const to = app.workspaceSessions.findIndex((s) => s.id === target.id);
  if (from >= 0 && to >= 0) app.reorderWorkspaceSession(from, to);
}

function onHostSessionDragEnd() {
  hostSessionDragId.value = "";
  hostSessionDropId.value = "";
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
  const pos = clampContextMenuPos(e.clientX, e.clientY, 210, 168);
  hostSessionMenu.value = { ids, x: pos.x, y: pos.y };
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
    // 批量打开明确新开标签，不复用已有终端会话
    app.openAnotherTerminal(host);
    await waitForTerminalDeskRender();
  }
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
  const approxH = desk.host ? 280 : 96;
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
  app.openHostTool(host, sub);
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
  app.setWorkspace("terminal");
  if (!app.activeTerminalId && app.terminalDesks.length > 0) {
    const last = app.terminalDesks[app.terminalDesks.length - 1];
    if (last) app.activateTerminalDesk(last.id);
  }
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
let deskPress: { id: string; x: number; y: number; dragged: boolean } | null = null;

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
  dragDeskId.value = desk.id;
  e.dataTransfer.effectAllowed = "move";
  e.dataTransfer.setData("application/x-term-session", desk.id);
  e.dataTransfer.setData("application/x-term-host", desk.host);
  e.dataTransfer.setData("text/plain", desk.id);
}

function isDeskDrag(e: DragEvent): boolean {
  const types = e.dataTransfer?.types;
  if (!types) return false;
  return Array.from(types).includes("application/x-term-session");
}

function onDeskDragOver(e: DragEvent, desk: TerminalDesk) {
  if (!desk.host || !isDeskDrag(e) || desk.id === dragDeskId.value) return;
  if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
  dropDeskId.value = desk.id;
}

function onDeskDragLeave(desk: TerminalDesk) {
  if (dropDeskId.value === desk.id) dropDeskId.value = "";
}

function onDeskDrop(e: DragEvent, desk: TerminalDesk) {
  dropDeskId.value = "";
  if (!desk.host || !e.dataTransfer) return;
  const sourceId = e.dataTransfer.getData("application/x-term-session");
  const host = e.dataTransfer.getData("application/x-term-host");
  if (!sourceId || sourceId === desk.id) return;
  app.mergeTerminalDesk(sourceId, desk.id, host);
}

function onDeskDragEnd() {
  dragDeskId.value = "";
  dropDeskId.value = "";
}

function pickHostSession(id: string) {
  if (suppressHostSessionClick.value) return;
  app.activateWorkspaceSession(id);
}

function jumpSettings(id: string) {
  settingsJump.value = id;
  app.openSettings();
  requestAnimationFrame(() => {
    document.getElementById(id)?.scrollIntoView({ block: "start" });
  });
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

  &:hover {
    color: var(--m3-on-surface);
    background: color-mix(in srgb, var(--m3-on-surface) 8%, transparent);
  }

  &.active {
    color: var(--m3-nav-active-fg);
    background: var(--m3-nav-active-bg);
    font-weight: 600;
  }

  &.is-selected:not(.active) {
    color: var(--m3-primary);
    background: color-mix(in srgb, var(--m3-primary) 16%, transparent);
    box-shadow: inset 3px 0 0 var(--m3-primary);
  }

  /* 当前激活页也在选中集时保留激活底色，但叠加选中竖条，保证 4 台都看得出被选中 */
  &.active.is-selected {
    box-shadow: inset 3px 0 0 var(--m3-primary);
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
