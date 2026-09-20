<template>
  <aside
    class="host-home"
    :class="{ 'is-host-dragging': !!dragState }"
    @contextmenu="onBlankContext"
  >
    <div class="host-home__split">
    <div class="host-home__main">
    <div class="host-home__stick">
    <div class="host-home__toolbar">
        <div class="host-home__tools-left">
          <el-input
            ref="searchInputRef"
            v-model="searchQuery"
            clearable
            class="host-filter__input"
            :placeholder="isMac ? '筛选主机 (⌘F)' : '筛选主机 (Ctrl+F)'"
            @keydown.esc="onSearchEsc"
          >
            <template #prefix>
              <el-icon class="host-filter__icon"><Search /></el-icon>
            </template>
          </el-input>
          <el-dropdown
            trigger="click"
            placement="bottom-end"
            @command="onCreateCommand"
          >
            <button
              type="button"
              class="host-home__add"
              aria-label="新建"
              aria-haspopup="menu"
            >
              +
            </button>
            <template #dropdown>
              <el-dropdown-menu aria-label="新建菜单">
                <el-dropdown-item command="group">新建分组</el-dropdown-item>
                <el-dropdown-item command="host">新建主机</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
      </div>

    </div>

    <div class="host-home__scroll">
      <p v-if="searchQuery.trim() && sections.length === 0" class="tree-empty">
        无匹配主机
      </p>
      <p v-else-if="sections.length === 0" class="tree-empty">
        暂无主机，右键空白处可添加主机或新建分组
      </p>

      <section
        v-for="sec in sections"
        :key="sec.id"
        class="group-section"
        :class="{ 'is-pinned': sec.isPinned, 'is-drop-target': dropTargetId === sec.id }"
        :data-drop-group="sec.id"
        :style="groupSectionStyle(sec)"
      >
        <div
          class="group-head"
          :class="groupHeadClass(sec)"
          :data-group-sort="
            !sec.isPinned && sec.id !== UNGROUPED_ID ? sec.id : undefined
          "
          @pointerdown="onGroupPointerDown($event, sec.id, sec.name)"
          @contextmenu.prevent="onSectionContext($event, sec)"
        >
          <button
            type="button"
            class="group-head__chev"
            :class="{ 'is-closed': sectionCollapsed(sec.id) }"
            :aria-expanded="!sectionCollapsed(sec.id)"
            aria-label="折叠或展开分组"
            @pointerdown.stop
            @click.stop="toggleGroupCollapsed(sec.id)"
          >
            <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 4.5 6 8l3.5-3.5" /></svg>
          </button>
          <button type="button" class="group-head__main" @click="onGroupHeadClick(sec)">
            <span class="group-head__name">{{ sec.name }}</span>
            <span class="group-head__count" v-tip="sec.tip">{{ sec.badge }}</span>
          </button>
        </div>

        <p
          v-if="!sectionCollapsed(sec.id) && sec.hosts.length === 0 && !searchQuery.trim()"
          class="group-empty"
        >
          {{ sec.isPinned ? "把主机拖到这里即可置顶" : "这个分组还没有主机" }}
        </p>
        <div v-else-if="!sectionCollapsed(sec.id)" class="host-strips">
          <HostCard
            v-for="h in sec.hosts"
            :key="`${sec.id}-${h.name}`"
            strip
            :host="h.raw"
            :reach="null"
            :os-release="app.osReleaseMap.get(h.name) || ''"
            :running="app.isRunning(h.name)"
            :selected="isHostRowActive(h.name) || isHostRowPicked(h.name)"
            :drag-source="dragState?.kind === 'host' && dragState.id === h.name"
            :insert-before="hostInsertMark(sec.id, h.name) === 'before'"
            :insert-after="hostInsertMark(sec.id, h.name) === 'after'"
            :data-pin-host="sec.isPinned ? h.name : undefined"
            :data-host-sort="h.name"
            :data-host-group="sec.id"
            data-host-axis="y"
            @pointerdown="onHostPointerDown($event, h.name, selectedHosts)"
            @click="onHostRowClick($event, h)"
            @dblclick="onHostRowDblClick($event, h)"
            @contextmenu="onHostContext($event, h.name)"
            @edit="openHostEdit(h.name)"
            @refresh-icon="onRefreshHostIcon(h.name)"
          />
        </div>
      </section>

      <p v-if="sections.length > 0" class="host-home__hint">{{ homeHint }}</p>
    </div>
    </div>

    <aside v-if="editingHost" class="host-detail is-editing">
      <HostEditPanel
        :key="editingHost.name"
        :host="editingHost"
        :os-release="app.osReleaseMap.get(editingHost.name) || ''"
        @close="closeHostEdit"
        @saved="closeHostEdit"
      />
    </aside>
    </div>

    <GroupContextMenu
      :menu="groupCtxMenu"
      @close="closeGroupCtxMenu"
      @open="onGroupCtxOpen"
      @open-board="onGroupCtxOpenBoard"
      @settings="onGroupCtxSettings"
      @add-host="onGroupCtxAddHost"
      @delete="onGroupCtxDelete"
    />
    <HostContextMenu
      :menu="hostCtxMenu"
      @close="closeHostCtxMenu"
      @edit="openHostEdit"
      @move="onHostCtxMove"
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

    <el-dialog
      v-model="createGroupOpen"
      :title="'新建分组'"
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
  </aside>
</template>

<script setup lang="ts">
/**
 * 主机首页：整页按分组列出主机，分组全部展开。
 * 单击分组名只选中；箭头折叠分组。
 * 单击主机只高亮；点「终端」或双击开终端。
 * ⌘（Mac）或 Ctrl（Windows）+ 单击加减多选。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { Search } from "@element-plus/icons-vue";
import { ElMessage, ElMessageBox } from "element-plus";
import {
  useAppStore,
  PINNED_DROP_ID,
  UNGROUPED_ID,
  type GroupNode,
  type SubTab,
} from "@/stores/app";
import GroupContextMenu, {
  type GroupCtxMenuState,
} from "@/components/sidebar/GroupContextMenu.vue";
import HostContextMenu, {
  type CtxMenuState,
} from "@/components/sidebar/HostContextMenu.vue";
import HostEditPanel from "@/components/sidebar/HostEditPanel.vue";
import HostCard from "@/components/HostCard.vue";
import { groupColor, type GroupColor } from "@/components/sidebar/groupColors";
import {
  summarizeFleet,
  useFleetStatus,
} from "@/composables/useFleetStatus";
import {
  isAdditiveHostSelect,
  useInjectedHostDrag,
} from "@/composables/useHostDrag";
import { clampContextMenuPos } from "@/utils/contextMenuPos";
import { formatErr } from "@/utils/format";
import { api, type sshconfig } from "@/api";

const emit = defineEmits<{
  addHost: [groupId?: string];
}>();

const app = useAppStore();
const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
const createGroupInputRef = ref<{ focus: () => void } | null>(null);
const createGroupOpen = ref(false);
const newGroupName = ref("");
const searchQuery = ref("");
const COLLAPSE_KEY = "1pannel-host-group-collapsed";

function readStringList(key: string): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(key) || "[]");
    if (!Array.isArray(raw)) return [];
    return raw.filter((x) => typeof x === "string");
  } catch {
    return [];
  }
}

function writeStringList(key: string, list: string[]) {
  try {
    localStorage.setItem(key, JSON.stringify(list));
  } catch {
    /* ignore */
  }
}

const collapsedIds = ref<string[]>(readStringList(COLLAPSE_KEY));

const PINNED_COLOR: GroupColor = {
  accent: "var(--m3-primary)",
  soft: "var(--m3-primary-container)",
  ink: "var(--m3-primary)",
};

function sectionCollapsed(id: string): boolean {
  if (searchQuery.value.trim()) return false;
  return collapsedIds.value.includes(id);
}

function toggleGroupCollapsed(id: string) {
  const next = collapsedIds.value.includes(id)
    ? collapsedIds.value.filter((x) => x !== id)
    : [...collapsedIds.value, id];
  collapsedIds.value = next;
  writeStringList(COLLAPSE_KEY, next);
}

function expandGroup(id: string) {
  if (!collapsedIds.value.includes(id)) return;
  collapsedIds.value = collapsedIds.value.filter((x) => x !== id);
  writeStringList(COLLAPSE_KEY, collapsedIds.value);
}

function groupHeadClass(sec: GroupSection) {
  return {
    "is-active": app.homeSelectedGroupId === sec.id,
    "is-collapsed": sectionCollapsed(sec.id),
    "is-drop-target": dropTargetId.value === sec.id,
    "is-group-insert-before":
      groupInsertTargetId.value === sec.id && groupInsertPos.value === "before",
    "is-group-insert-after":
      groupInsertTargetId.value === sec.id && groupInsertPos.value === "after",
  };
}

function groupSectionStyle(sec: GroupSection) {
  return {
    "--group-accent": sec.color.accent,
    "--group-ink": sec.color.ink,
    "--group-soft": sec.color.soft,
    marginLeft: `${sec.depth * 16}px`,
  };
}

function findListedHost(name: string): SectionHost | null {
  for (const sec of sections.value) {
    const hit = sec.hosts.find((h) => h.name === name);
    if (hit) return hit;
  }
  return null;
}

async function locateHost(name: string) {
  if (!findListedHost(name) && searchQuery.value) {
    searchQuery.value = "";
    await nextTick();
  }
  const hit = findListedHost(name);
  if (!hit) return;
  expandGroup(hit.groupId);
  selectedHosts.value = [name];
  if (hit.groupId !== PINNED_DROP_ID) app.selectGroup(hit.groupId);
  await nextTick();
  const el = document.querySelector(`[data-host-sort="${CSS.escape(name)}"]`);
  el?.scrollIntoView({ block: "nearest" });
}

function workspaceOf(name: string) {
  return app.workspaceSessions.find((s) => s.role === "host" && s.host === name) || null;
}

function enterListedHost(row: SectionHost) {
  selectedHosts.value = [row.name];
  if (row.groupId !== PINNED_DROP_ID) app.selectGroup(row.groupId);
  app.openHostTab(row.name, "overview");
}

function openListedHost(row: SectionHost, sub: SubTab) {
  selectedHosts.value = [row.name];
  if (row.groupId !== PINNED_DROP_ID) app.selectGroup(row.groupId);
  app.openHostTab(row.name, sub);
}

async function openQuick(name: string) {
  if (!findListedHost(name) && searchQuery.value) {
    searchQuery.value = "";
    await nextTick();
  }
  const hit = findListedHost(name);
  if (!hit) return;
  expandGroup(hit.groupId);
  openListedHost(hit, "overview");
}

/** 单击替换为单选，⌘/Ctrl+单击加减；末项是多选锚点。 */
const selectedHosts = ref<string[]>([]);

const homeHint = computed(() => {
  const mod = isMac ? "⌘" : "Ctrl";
  return `单击或 Space 选中 · 双击或 Enter 进入概览 · 右键更多 · 拖动主机迁移或调整顺序 · ${mod}+单击多选`;
});

const searchInputRef = ref<{
  focus: () => void;
  select: () => void;
  input?: HTMLInputElement;
} | null>(null);
const editingHostName = ref<string | null>(null);
const editingHost = computed(() => {
  const name = editingHostName.value;
  if (!name) return null;
  return app.hosts.find((h) => h.name === name) || null;
});

function openHostEdit(name: string) {
  if (!app.hosts.some((h) => h.name === name)) return;
  selectedHosts.value = [name];
  editingHostName.value = name;
}

function closeHostEdit() {
  editingHostName.value = null;
}

// 侧栏不默认全舰队探活；缺状态时徽章只显示台数
const fleetEnabled = computed(() => false);
const { statusByHost } = useFleetStatus({ enabled: fleetEnabled });

const groupSettingsOpen = ref(false);
const groupSettingsSaving = ref(false);
const settingsGroupId = ref("");
const settingsName = ref("");
const settingsBoardTitle = ref("");
const groupSettingsNameRef = ref<{ focus: () => void } | null>(null);

const {
  dragState,
  dropTargetId,
  hostInsert,
  groupInsertPos,
  groupInsertTargetId,
  suppressClick,
  cancelDrag,
  onHostPointerDown,
  onGroupPointerDown,
  moveHostToGroup,
} = useInjectedHostDrag();

/** 拖主机悬停在同组另一台主机上时，显示前插/后插线 */
function hostInsertMark(groupId: string, host: string): "before" | "after" | null {
  const mark = hostInsert.value;
  if (!mark) return null;
  if (dragState.value?.kind !== "host" || !dragState.value.active) return null;
  if (mark.groupId !== groupId || mark.target !== host) return null;
  if (dragState.value.id === host) return null;
  if (mark.after) return "after";
  return "before";
}

watch(
  () => app.homeSearchFocusSeq,
  async () => {
    await nextTick();
    searchInputRef.value?.focus();
    searchInputRef.value?.select();
  }
);

type SectionHost = {
  name: string;
  hostName: string;
  user: string;
  groupId: string;
  raw: sshconfig.HostConfig;
};

type GroupSection = {
  id: string;
  name: string;
  isPinned: boolean;
  depth: number;
  color: GroupColor;
  badge: string;
  tip: string;
  hosts: SectionHost[];
};

function fleetBadge(directNames: string[], subtreeNames: string[]): {
  badge: string;
  tip: string;
} {
  const directTotal = directNames.length;
  const subTotal = subtreeNames.length;
  const directSum = summarizeFleet(directNames, statusByHost.value);
  const subSum = summarizeFleet(subtreeNames, statusByHost.value);
  const hasStatus = statusByHost.value.size > 0;

  // 徽标只显示主机数量；在线/掉线/未装等状态放悬停提示
  const badge = `${directTotal}`;

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
  const parts = [`本级 ${directSum.online}/${directTotal} 在线`];
  if (subTotal !== directTotal) {
    parts.push(`含子树 ${subSum.online}/${subTotal}`);
  }
  if (subSum.noAgent > 0) parts.push(`${subSum.noAgent} 台未装`);
  if (subSum.sshDown > 0) parts.push(`${subSum.sshDown} 台掉线`);
  if (subSum.alert > 0) parts.push(`${subSum.alert} 台告警`);
  return { badge, tip: parts.join(" · ") };
}

function hostMatchesQuery(h: sshconfig.HostConfig, raw: string): boolean {
  const q = raw.trim().toLowerCase();
  if (!q) return true;
  if (h.name.toLowerCase().includes(q)) return true;
  if ((h.hostName || "").toLowerCase().includes(q)) return true;
  if ((h.user || "").toLowerCase().includes(q)) return true;
  return false;
}

/** 全部分组及其直属主机，始终展开。搜索时只留有匹配主机的分组。 */
const sections = computed<GroupSection[]>(() => {
  const q = searchQuery.value;
  const searching = !!q.trim();
  const out: GroupSection[] = [];

  const hostByName = new Map(app.hosts.map((h) => [h.name, h]));
  const pinned = app.pinnedHosts
    .map((name) => hostByName.get(name))
    .filter((h): h is sshconfig.HostConfig => !!h);
  const visiblePinned = pinned.filter((h) => hostMatchesQuery(h, q));

  // 置顶是一个虚拟分组：不改变主机原分组，只在首页作为第一组展示。
  if (app.hosts.length > 0 && (!searching || visiblePinned.length > 0)) {
    const pinnedHosts = searching ? visiblePinned : pinned;
    out.push({
      id: PINNED_DROP_ID,
      name: "置顶",
      isPinned: true,
      depth: 0,
      color: PINNED_COLOR,
      badge: `${pinned.length}`,
      tip: pinned.length > 0 ? `共 ${pinned.length} 台` : "把主机拖到这里即可置顶",
      hosts: pinnedHosts.map((h) => ({
        name: h.name,
        hostName: h.hostName || "",
        user: h.user || "",
        groupId: PINNED_DROP_ID,
        raw: h,
      })),
    });
  }

  const walk = (list: GroupNode[], depth: number) => {
    for (const n of list) {
      const id = n.group?.id || UNGROUPED_ID;
      const name = n.group?.name || "未分组";
      if (searching) {
        const hit = n.subtreeHosts.some((h) => hostMatchesQuery(h, q));
        if (!hit) continue;
      }
      const color = groupColor(id, n.rootIndex);
      const directNames = n.hosts.map((h) => h.name);
      const subNames = n.subtreeHosts.map((h) => h.name);
      const meta = fleetBadge(directNames, subNames);
      const hostsHere = searching
        ? n.hosts.filter((h) => hostMatchesQuery(h, q))
        : n.hosts;
      out.push({
        id,
        name,
        isPinned: false,
        depth,
        color,
        badge: meta.badge,
        tip: meta.tip,
        hosts: hostsHere.map((h) => ({
          name: h.name,
          hostName: h.hostName || "",
          user: h.user || "",
          groupId: id,
          raw: h,
        })),
      });
      if (n.children?.length) walk(n.children, depth + 1);
    }
  };
  walk(app.groupNodes, 0);
  return out;
});

function isHostRowActive(name: string): boolean {
  const list = selectedHosts.value;
  if (list.length === 0) return app.activeSession?.host === name;
  return list[list.length - 1] === name;
}

/** 多选里除锚点外的主机：浅色高亮 */
function isHostRowPicked(name: string): boolean {
  const list = selectedHosts.value;
  if (list.length < 2) return false;
  return list.includes(name) && list[list.length - 1] !== name;
}

/** 单击分组 → 只选中该组（添加主机时作为默认分组） */
function onGroupHeadClick(sec: GroupSection) {
  if (suppressClick.value) return;
  closeHostEdit();
  selectedHosts.value = [];
  if (!sec.isPinned) app.selectGroup(sec.id);
}

function onHostRowClick(e: MouseEvent | KeyboardEvent, row: SectionHost) {
  if (suppressClick.value) return;
  if (editingHostName.value && editingHostName.value !== row.name) {
    closeHostEdit();
  }
  if (isAdditiveHostSelect(e)) {
    let list = selectedHosts.value.slice();
    // 还没点过时，当前会话主机已经高亮，⌘/Ctrl 再点另一台应加进去而不是换成单选
    if (list.length === 0) {
      const current = app.activeSession?.host || "";
      if (current) list = [current];
    }
    const i = list.indexOf(row.name);
    if (i >= 0) list.splice(i, 1);
    else list.push(row.name);
    selectedHosts.value = list;
    if (row.groupId !== PINNED_DROP_ID) app.selectGroup(row.groupId);
    return;
  }
  selectedHosts.value = [row.name];
  if (row.groupId !== PINNED_DROP_ID) app.selectGroup(row.groupId);
}

/** 双击主机：进入这台主机的工作区（已打开则回到上次工具） */
function onHostRowDblClick(e: MouseEvent, row: SectionHost) {
  if (suppressClick.value) return;
  if (isAdditiveHostSelect(e)) return;
  closeHostEdit();
  enterListedHost(row);
}

async function onRefreshHostIcon(name: string) {
  try {
    const os = await app.refreshHostIcon(name);
    ElMessage.success(`${name}：${os || "图标已更新"}`);
  } catch (err) {
    ElMessage.error(`更新图标失败: ${formatErr(err)}`);
  }
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

const groupCtxMenu = ref<GroupCtxMenuState | null>(null);
const hostCtxMenu = ref<CtxMenuState | null>(null);
const blankCtx = ref<{ x: number; y: number } | null>(null);

function closeGroupCtxMenu() {
  groupCtxMenu.value = null;
}

function closeHostCtxMenu() {
  hostCtxMenu.value = null;
}

function onGroupContext(e: MouseEvent, id: string, name: string) {
  cancelDrag();
  blankCtx.value = null;
  hostCtxMenu.value = null;
  const next = clampContextMenuPos(e.clientX, e.clientY, 180, 220);
  groupCtxMenu.value = { id, name, x: next.x, y: next.y };
}

function onSectionContext(e: MouseEvent, sec: GroupSection) {
  if (sec.isPinned) return;
  onGroupContext(e, sec.id, sec.name);
}

function onHostContext(e: MouseEvent, host: string) {
  cancelDrag();
  blankCtx.value = null;
  groupCtxMenu.value = null;
  if (editingHostName.value && editingHostName.value !== host) {
    closeHostEdit();
  }
  // 右键未选中的主机：收成单选。右键已选中的：保留多选，菜单作用在全部已选主机上
  if (!selectedHosts.value.includes(host)) {
    selectedHosts.value = [host];
  }
  const hosts = selectedHosts.value.slice();
  const approxH = hosts.length > 1 ? 220 : 520;
  const next = clampContextMenuPos(e.clientX, e.clientY, 200, approxH);
  hostCtxMenu.value = { host, hosts, x: next.x, y: next.y };
}

async function onHostCtxMove(host: string, groupId: string) {
  await moveHostToGroup(host, groupId || UNGROUPED_ID);
}

/** 右键「打开」→ 打开该分组主机列表 */
function onGroupCtxOpen(id: string, name: string) {
  app.openGroupTab(id, name);
}

/** 右键「打开看板」→ 打开或聚焦该分组的看板窗 */
async function onGroupCtxOpenBoard(id: string) {
  try {
    await api.openBoardWindow(id);
  } catch (err) {
    ElMessage.error(`打开看板失败: ${formatErr(err)}`);
  }
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

function onBlankContext(e: MouseEvent) {
  const el = (e.target as HTMLElement).closest(
    ".group-head, .host-card, .host-detail, .host-home__add, .host-filter__input, button, input"
  );
  if (el) return;
  e.preventDefault();
  closeGroupCtxMenu();
  closeHostCtxMenu();
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

function onCreateCommand(command: "group" | "host") {
  if (command === "group") {
    openCreateGroup();
    return;
  }
  emit("addHost");
}

function openCreateGroup(_parentId?: string) {
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
    const id = await app.createGroup(name);
    ElMessage.success("已创建");
    createGroupOpen.value = false;
    newGroupName.value = "";
    app.locateGroupOnHome(id);
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
  if (e.key === "Escape") {
    if (groupCtxMenu.value) closeGroupCtxMenu();
    if (hostCtxMenu.value) closeHostCtxMenu();
    blankCtx.value = null;
  }
}

/** 内容区分组标题右键「分组设置…」：转发到这里打开设置对话框 */
function onGroupSettingsEvent(ev: Event) {
  const detail = (ev as CustomEvent<{ id?: string; name?: string }>).detail;
  if (!detail?.id) return;
  onGroupCtxSettings(detail.id, detail.name || "");
}

onMounted(() => {
  window.addEventListener("keydown", onWindowKeydown);
  window.addEventListener("keydown", onNumSwitchKeydown);
  window.addEventListener("allhosts:group-settings", onGroupSettingsEvent);
});

onBeforeUnmount(() => {
  window.removeEventListener("keydown", onWindowKeydown);
  window.removeEventListener("keydown", onNumSwitchKeydown);
  window.removeEventListener("allhosts:group-settings", onGroupSettingsEvent);
});
</script>

<style scoped lang="scss">
.host-home {
  container-type: inline-size;
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: #fff;

  &.is-host-dragging {
    user-select: none;
  }
}

.host-home__main {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.host-home__stick {
  flex-shrink: 0;
  padding: 12px 24px 8px;
  background: var(--m3-card);
  border-bottom: 1px solid var(--m3-outline-variant);
}

.host-home__scroll {
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow: auto;
  padding: 0 24px 24px;
  box-sizing: border-box;
}

.host-home__split {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
}

.host-detail {
  flex-shrink: 0;
  width: 380px;
  min-height: 0;
  overflow: auto;
  box-sizing: border-box;
  padding: 16px;
  border-left: 1px solid var(--m3-outline-variant);
  background: var(--m3-surface-container);
}

@container (max-width: 860px) {
  .host-home__split {
    flex-direction: column;
  }

  .host-detail {
    width: 100%;
    max-height: none;
    border-left: 0;
    border-bottom: 1px solid var(--m3-outline-variant);
    order: -1;
  }

}

.host-home__toolbar {
  display: flex;
  align-items: center;
  width: 100%;
}

.host-home__tools-left {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 0;
  width: 100%;
}

.host-home__add {
  appearance: none;
  flex-shrink: 0;
  width: 32px;
  height: 32px;
  padding: 0;
  border: 1px solid var(--m3-outline-variant, #e4e7ed);
  border-radius: 10px;
  background: #fff;
  color: var(--m3-on-surface-variant);
  font-size: 18px;
  line-height: 1;
  cursor: pointer;

  &:hover {
    background: color-mix(in srgb, var(--m3-on-surface) 6%, transparent);
    color: var(--m3-on-surface);
  }

  &:focus-visible {
    outline: var(--m3-focus-ring);
    outline-offset: 2px;
  }
}

.host-filter__input {
  flex: 1;
  min-width: 0;

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
}

.host-filter__icon {
  font-size: 16px;
  color: var(--m3-on-surface-variant);
}

.tree-empty,
.group-empty {
  margin: 12px 0 0;
  font-size: 13px;
  color: var(--m3-on-surface-variant);
}

.group-section {
  position: relative;
  margin-top: 20px;
  padding: 0;
  border-radius: 0;
  background: transparent;
  box-shadow: none;

  &:first-child {
    margin-top: 16px;
  }

  &.is-drop-target {
    .group-head {
      background: color-mix(in srgb, var(--group-accent) 8%, transparent);
      outline: 1px dashed var(--group-accent);
      outline-offset: 3px;
    }
  }
}

.group-head {
  position: relative;
  display: flex;
  align-items: center;
  gap: 2px;
  width: 100%;
  min-height: 40px;
  margin: 0;
  padding: 0;
  border-radius: var(--m3-shape-s);
  box-sizing: border-box;

  &.is-drop-target {
    background: color-mix(in srgb, var(--m3-primary) 12%, transparent) !important;
    outline: 2px dashed var(--m3-primary);
    outline-offset: -2px;
  }

  &.is-group-insert-before::before,
  &.is-group-insert-after::after {
    content: "";
    position: absolute;
    left: 0;
    right: 0;
    height: 3px;
    border-radius: 2px;
    background: var(--m3-primary);
    pointer-events: none;
  }

  &.is-group-insert-before::before {
    top: -6px;
  }

  &.is-group-insert-after::after {
    bottom: -6px;
  }

}

.group-head__chev,
.group-head__main {
  appearance: none;
  border: 0;
  background: transparent;
  color: inherit;
  cursor: pointer;

  &:focus-visible {
    outline: var(--m3-focus-ring);
    outline-offset: -2px;
  }
}

.group-head__chev {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  flex-shrink: 0;
  border-radius: var(--m3-shape-xs);
  color: var(--m3-on-surface-variant);

  svg {
    width: 12px;
    height: 12px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.6;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  &.is-closed svg {
    transform: rotate(-90deg);
  }

  &:hover {
    background: color-mix(in srgb, var(--m3-on-surface) 6%, transparent);
  }
}

.group-head__main {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 0;
  min-height: 40px;
  padding: 0 8px 0 0;
  border-radius: var(--m3-shape-s);
  text-align: left;

  &:hover {
    background: color-mix(in srgb, var(--m3-on-surface) 5%, transparent);
  }
}

.group-head.is-active .group-head__name {
  font-weight: 650;
}

.group-head__name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font: var(--m3-title-medium);
  font-weight: 650;
  color: var(--group-ink);
}

.group-head__count {
  flex-shrink: 0;
  min-width: 20px;
  height: 22px;
  padding: 0 7px;
  border-radius: 10px;
  background: color-mix(in srgb, #fff 55%, var(--group-soft));
  color: var(--group-ink);
  font-size: 12px;
  font-weight: 600;
  line-height: 22px;
  text-align: center;
  font-variant-numeric: tabular-nums;
}

.host-strips {
  display: flex;
  flex-direction: column;
  gap: 0;
  margin-top: 4px;
  overflow: hidden;
  border-radius: 12px;
}

.host-home__hint {
  margin: 18px 0 0;
  font-size: 12px;
  color: var(--m3-on-surface-variant);
}
</style>
