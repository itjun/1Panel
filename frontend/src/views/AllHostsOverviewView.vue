<template>
  <div class="all-hosts">
    <ChromeTeleport :when="app.isHomeActive()">
      <span class="chrome-meta">
        共 {{ app.hosts.length }} 台 · 在线 {{ fleetOnlineCount }} · 已打开
        {{ app.runningHosts.length }}
      </span>
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
      <el-popover
        placement="bottom-end"
        :width="280"
        trigger="click"
        :teleported="true"
      >
        <template #reference>
          <el-button class="menu-check-btn">
            <span
              class="menu-check-dot"
              :class="{
                'is-ok': menuCheckTone === 'ok',
                'is-bad': menuCheckTone === 'bad',
              }"
            />
            菜单检查
          </el-button>
        </template>
        <div class="menu-check-pop">
          <div class="menu-check-pop__title">菜单检查</div>
          <button
            v-for="item in menuChecks"
            :key="item.id"
            type="button"
            class="menu-check-pop__item"
            :class="{ 'is-checking': item.checking }"
            :disabled="item.checking"
            @click="onMenuCheck(item)"
          >
            <span
              class="menu-check-dot"
              :class="{
                'is-ok': item.status === 'ok',
                'is-bad': item.status === 'bad',
              }"
            />
            <span class="menu-check-pop__label">{{ item.label }}</span>
            <span class="menu-check-pop__hint">
              {{ item.checking ? "检查中…" : "点击检查" }}
            </span>
          </button>
        </div>
      </el-popover>
    </ChromeTeleport>

    <el-empty
      v-if="app.hosts.length === 0 && app.groupList.length === 0"
      description="暂无主机，右键侧栏空白处可添加主机或新建分组"
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
        <span class="pinned-section__count">{{ app.pinnedHosts.length }}</span>
        <span v-if="app.pinnedHosts.length > 0" class="pinned-section__summary">
          {{ pinnedSummaryText }}
        </span>
      </div>
      <p v-if="pinnedHostConfigs.length === 0" class="pinned-section__hint">
        拖到此处置顶
      </p>
      <div v-else class="pinned-grid">
        <HostCard
          v-for="h in pinnedHostConfigs"
          :key="'pin-' + h.name"
          :host="h"
          :reach="statusByHost.get(h.name)?.reach ?? null"
          :os-release="app.osReleaseMap.get(h.name) || ''"
          :running="app.isRunning(h.name)"
          :selected="selectedPinnedHost === h.name"
          :drag-source="dragState?.kind === 'host' && dragState.id === h.name"
          :insert-before="
            pinInsertBefore === h.name &&
            dragState?.kind === 'host' &&
            dragState.id !== h.name
          "
          :data-pin-host="h.name"
          @pointerdown="onHostPointerDown($event, h.name)"
          @click="onPinnedCardClick(h.name)"
          @dblclick="openHost(h.name)"
          @contextmenu="onHostContext($event, h.name)"
          @refresh-icon="onRefreshOneIcon(h.name)"
        />
      </div>
    </section>

    <div
      v-if="app.hosts.length > 0 || app.groupList.length > 0"
      class="page-toolbar"
    >
      <el-button type="primary" plain @click="promptCreateRootGroup">
        ＋ 新建分组
      </el-button>
    </div>

    <!-- 按分组树渲染：子分组嵌在父节点下，树线对齐 -->
    <div v-if="app.hosts.length > 0 || app.groupList.length > 0" class="group-sections">
      <AllHostsGroupBranch
        v-for="node in groupTree"
        :key="node.key"
        :node="node"
        :nested="false"
        :is-running="(n) => app.isRunning(n)"
        :os-release="(n) => app.osReleaseMap.get(n) || ''"
        :status-by-host="statusByHost"
        @open-host="openHost"
        @refresh-icon="onRefreshOneIcon"
        @open-group="openGroup"
        @open-board="openBoard"
        @host-context="onHostContext"
      />
    </div>

    <HostContextMenu
      :menu="ctxMenu"
      @close="closeCtxMenu"
      @edit="(host) => editRef?.openFor(host)"
      @move="onCtxMove"
    />
    <EditHostDialog ref="editRef" />
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import { Picture, Refresh } from "@element-plus/icons-vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { Events } from "@wailsio/runtime";
import AllHostsGroupBranch, {
  type HostGroupTreeNode,
} from "@/components/AllHostsGroupBranch.vue";
import ChromeTeleport from "@/components/ChromeTeleport.vue";
import HostCard from "@/components/HostCard.vue";
import EditHostDialog from "@/components/sidebar/EditHostDialog.vue";
import HostContextMenu, {
  type CtxMenuState,
} from "@/components/sidebar/HostContextMenu.vue";
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
import { copyText } from "@/utils/clipboard";
import { formatErr } from "@/utils/format";
import type { main, sshconfig } from "@/api";

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
  pendingCreateChild,
} = useInjectedHostDrag();
const ctxMenu = ref<CtxMenuState | null>(null);
const editRef = ref<InstanceType<typeof EditHostDialog> | null>(null);

/** 仅在全部主机首页可见时轮询舰队状态 */
const fleetEnabled = computed(() => app.isHomeActive());
const { statusByHost } = useFleetStatus({ enabled: fleetEnabled });

const fleetOnlineCount = computed(() => {
  const names = app.hosts.map((h) => h.name);
  return summarizeFleet(names, statusByHost.value).online;
});

/* ---------- 置顶主机区块 ---------- */

/** 有置顶主机，或正在拖主机（空落点提示）时显示 */
const showPinnedSection = computed(() => {
  if (app.pinnedHosts.length > 0) return true;
  return dragState.value?.kind === "host" && !!dragState.value.active;
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

const pinnedSummaryText = computed(() => {
  const names = app.pinnedHosts;
  if (statusByHost.value.size === 0) return `共 ${names.length} 台`;
  const s = summarizeFleet(names, statusByHost.value);
  const parts = [`${s.online} 台在线`];
  if (s.noAgent > 0) parts.push(`${s.noAgent} 台未装`);
  if (s.sshDown > 0) parts.push(`${s.sshDown} 台掉线`);
  if (s.alert > 0) parts.push(`${s.alert} 台告警`);
  return parts.join(" · ");
});

const selectedPinnedHost = ref<string | null>(null);

function onPinnedCardClick(name: string) {
  if (suppressClick.value) return;
  selectedPinnedHost.value = name;
}

type MenuCheckStatus = "" | "ok" | "bad";

interface MenuCheckItem {
  id: string;
  label: string;
  url: string;
  checking: boolean;
  status: MenuCheckStatus;
  menuOk: boolean | null;
  dataOk: boolean | null;
  menuText: string;
  dataText: string;
  message: string;
}

/** 由后端 ListMenuChecks 填充；占位避免首屏空白 */
const menuChecks = reactive<MenuCheckItem[]>([
  {
    id: "data-report",
    label: "数据上报",
    url: "",
    checking: false,
    status: "",
    menuOk: null,
    dataOk: null,
    menuText: "",
    dataText: "",
    message: "",
  },
]);

const menuCheckTone = computed<"ok" | "bad" | "">(() => {
  if (menuChecks.some((i) => i.status === "bad")) return "bad";
  if (menuChecks.length > 0 && menuChecks.every((i) => i.status === "ok")) {
    return "ok";
  }
  return "";
});

let offMenuCheck: (() => void) | null = null;
let handlingCreateChild = false;

function applyMenuResult(r: main.MenuCheckResult) {
  if (!r?.id) return;
  let item = menuChecks.find((x) => x.id === r.id);
  if (!item) {
    item = {
      id: r.id,
      label: r.label || r.id,
      url: r.url || "",
      checking: false,
      status: "",
      menuOk: null,
      dataOk: null,
      menuText: "",
      dataText: "",
      message: "",
    };
    menuChecks.push(item);
  }
  item.label = r.label || item.label;
  item.url = r.url || item.url;
  if (r.checkedAt <= 0 && !r.message && !r.menuText) return;
  item.menuOk = !!r.ok;
  item.dataOk = !!r.hasData;
  item.menuText = r.menuText || (r.ok ? "菜单正常" : "菜单异常");
  item.dataText = r.dataText || (r.hasData ? "数据正常" : "数据异常");
  item.message = r.message || `${item.menuText}\n${item.dataText}`;
  if (r.ok && r.hasData) {
    item.status = "ok";
  } else {
    item.status = "bad";
  }
}

async function loadMenuChecks() {
  try {
    const list = await api.listMenuChecks();
    for (const r of list) applyMenuResult(r);
  } catch {
    /* 启动瞬间后端未就绪时忽略 */
  }
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

/** 拖到「新建子分组」区后：命名 → 创建 → 可选 assign / moveGroup */
watch(pendingCreateChild, async (pending) => {
  if (!pending || handlingCreateChild) return;
  handlingCreateChild = true;
  const { parentId, hostName, groupId } = pending;
  pendingCreateChild.value = null;
  const parentName =
    app.groupList.find((g) => g.id === parentId)?.name || "分组";
  try {
    const { value } = await ElMessageBox.prompt(
      `在「${parentName}」下新建子分组`,
      "新建子分组",
      {
        confirmButtonText: "创建",
        cancelButtonText: "取消",
        inputPattern: /\S+/,
        inputErrorMessage: "名称不能为空",
      }
    );
    const name = (value || "").trim();
    if (!name) return;
    const newId = await app.createGroup(name, parentId);
    if (hostName) {
      await app.assignHost(hostName, newId);
      ElMessage.success(`已创建「${name}」并移入 ${hostName}`);
    } else if (groupId && groupId !== parentId) {
      // 拖的是分组：移入新建子分组（自身色块则只创建）
      await app.moveGroup(groupId, newId);
      ElMessage.success(`已创建「${name}」并移入该分组`);
    } else {
      ElMessage.success(`已创建「${name}」`);
    }
  } catch (e) {
    if (e === "cancel" || e === "close") return;
    ElMessage.error(`创建失败: ${formatErr(e)}`);
  } finally {
    handlingCreateChild = false;
  }
});

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function menuCheckResultHtml(
  menuOk: boolean,
  menuText: string,
  dataOk: boolean,
  dataText: string,
  url: string
): string {
  const row = (ok: boolean, text: string) => {
    const mark = ok ? "✓" : "❌";
    const color = ok ? "#16a34a" : "#dc2626";
    return (
      `<div style="display:flex;align-items:flex-start;gap:10px;margin:12px 0;line-height:1.55;font-size:16px;color:${color}">` +
      `<span style="flex-shrink:0;font-weight:700;font-size:18px;line-height:1.4">${mark}</span>` +
      `<span style="min-width:0;word-break:break-word">${escapeHtml(text)}</span>` +
      `</div>`
    );
  };
  let html = row(menuOk, menuText) + row(dataOk, dataText);
  if (url) {
    html +=
      `<div style="margin-top:20px;padding-top:16px;border-top:1px solid rgba(127,127,127,0.25)">` +
      `<div style="font-size:13px;color:#64748b;margin-bottom:8px">检查地址</div>` +
      `<div data-tip="${escapeHtml(url)}" style="font-size:14px;line-height:1.45;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;user-select:all;color:var(--el-text-color-regular,#303133)">${escapeHtml(url)}</div>` +
      `</div>`;
  }
  return html;
}

async function onCopyMenuUrl(url: string) {
  const u = url.trim();
  if (!u) {
    ElMessage.warning("暂无检查地址");
    return;
  }
  try {
    await copyText(u);
    ElMessage.success("已复制完整地址");
  } catch {
    ElMessage.error("复制失败");
  }
}

async function showMenuCheckResult(
  label: string,
  menuOk: boolean,
  menuText: string,
  dataOk: boolean,
  dataText: string,
  url: string
) {
  try {
    await ElMessageBox.alert(
      menuCheckResultHtml(menuOk, menuText, dataOk, dataText, url),
      `菜单检查 · ${label}`,
      {
        customClass: "menu-check-msgbox",
        confirmButtonText: "知道了",
        cancelButtonText: "复制地址",
        showCancelButton: !!url,
        distinguishCancelAndClose: true,
        dangerouslyUseHTMLString: true,
        showClose: true,
      }
    );
  } catch (action) {
    if (action === "cancel" && url) {
      await onCopyMenuUrl(url);
    }
  }
}

async function onMenuCheck(item: MenuCheckItem) {
  if (item.checking) return;
  item.checking = true;
  item.menuText = "";
  item.dataText = "";
  item.message = "正在检查…";
  try {
    // 仅 Go HTTP 拉取；结果只展示在页面/弹窗，不发企微与桌面通知
    const r = await api.checkMenuPage(item.id);
    applyMenuResult(r);
    const menuText = r.menuText || (r.ok ? "菜单正常" : "菜单异常");
    const dataText = r.dataText || (r.hasData ? "数据正常" : "数据异常");
    const url = r.url || item.url;
    await showMenuCheckResult(
      item.label,
      !!r.ok,
      menuText,
      !!r.hasData,
      dataText,
      url
    );
  } catch (e) {
    item.status = "bad";
    item.menuOk = false;
    item.dataOk = false;
    item.menuText = "菜单异常：" + formatErr(e);
    item.dataText = "数据异常：菜单不可用，无法判断";
    item.message = `${item.menuText}\n${item.dataText}`;
    await showMenuCheckResult(
      item.label,
      false,
      item.menuText,
      false,
      item.dataText,
      item.url
    );
  } finally {
    item.checking = false;
  }
}

onMounted(() => {
  void loadMenuChecks();
  offMenuCheck = Events.On(
    "menu-check-updated",
    (ev: { data?: main.MenuCheckResult }) => {
      if (ev?.data) applyMenuResult(ev.data);
    }
  );
});

onBeforeUnmount(() => {
  offMenuCheck?.();
  offMenuCheck = null;
});

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
</script>

<style scoped lang="scss">
.all-hosts {
  min-height: 200px;
}

.page-toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 16px;
}

.menu-check-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.menu-check-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
  background: var(--el-text-color-placeholder, #a8abb2);

  &.is-ok {
    background: #1e8e3e;
  }

  &.is-bad {
    background: #d93025;
  }
}

.menu-check-pop {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.menu-check-pop__title {
  font-size: 13px;
  font-weight: 650;
  margin-bottom: 6px;
  color: var(--el-text-color-primary);
}

.menu-check-pop__item {
  appearance: none;
  border: none;
  background: transparent;
  width: 100%;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 6px;
  border-radius: 8px;
  cursor: pointer;
  text-align: left;

  &:hover:not(:disabled) {
    background: var(--el-fill-color-light, rgba(0, 0, 0, 0.04));
  }

  &:disabled,
  &.is-checking {
    cursor: wait;
    opacity: 0.75;
  }
}

.menu-check-pop__label {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  font-weight: 600;
}

.menu-check-pop__hint {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

/* ---------- 置顶主机 ---------- */
.pinned-section {
  position: relative;
  min-width: 0;
  padding: 14px 16px 16px;
  margin-bottom: 20px;
  border-radius: 12px;
  /* 与分组色块同结构，但用主色做中性强调，区别于任何分组配色 */
  background: color-mix(in srgb, var(--m3-primary) 6%, transparent);
  box-shadow: inset 0 0 0 1px
    color-mix(in srgb, var(--m3-primary) 22%, transparent);
  transition: box-shadow 0.2s ease, background-color 0.2s ease;

  &.is-drop-target {
    background: color-mix(in srgb, var(--m3-primary) 14%, transparent);
    outline: 2px dashed var(--m3-primary);
    outline-offset: 2px;
  }
}

.pinned-section__head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
  min-height: 24px;
}

.pinned-section__dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex-shrink: 0;
  background: var(--m3-primary);
}

.pinned-section__name {
  font-size: 16px;
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
  padding: 10px 12px;
  border: 1.5px dashed color-mix(in srgb, var(--m3-primary) 55%, transparent);
  border-radius: 8px;
  font-size: 12px;
  font-weight: 500;
  text-align: center;
  color: var(--el-text-color-secondary);
  pointer-events: none;
}

/* 紧凑一排：卡片比分组内略窄 */
.pinned-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 12px;
}

/* ---------- 分组树 ---------- */
.group-sections {
  display: flex;
  flex-direction: column;
  gap: 28px;
}
</style>

<style lang="scss">
/* MessageBox 挂到 body，需非 scoped */
.menu-check-msgbox {
  width: 800px !important;
  max-width: min(800px, 96vw) !important;
  min-height: 360px;
  padding-bottom: 8px;
  /* 暗色底上弹窗边框必须可见，不能靠极弱阴影辨认边缘 */
  border: 1px solid var(--m3-outline-variant, rgba(255, 255, 255, 0.16)) !important;
  border-radius: var(--m3-shape-l, 16px) !important;
  box-shadow:
    0 0 0 1px rgba(255, 255, 255, 0.06),
    0 12px 40px rgba(0, 0, 0, 0.55) !important;
  background: var(--m3-surface-container-high, #252d3d) !important;
}
html:not(.dark) .menu-check-msgbox {
  border-color: var(--m3-outline, #c9cdd4) !important;
  box-shadow:
    0 0 0 1px rgba(0, 0, 0, 0.04),
    0 12px 32px rgba(0, 0, 0, 0.14) !important;
  background: var(--m3-surface-container-lowest, #fff) !important;
}
.menu-check-msgbox .el-message-box__header {
  padding: 24px 48px 10px 28px;
}
.menu-check-msgbox .el-message-box__title {
  font-size: 19px;
  line-height: 1.4;
  font-weight: 600;
}
.menu-check-msgbox .el-message-box__content {
  padding: 20px 28px 24px;
  min-height: 200px;
}
.menu-check-msgbox .el-message-box__message {
  max-width: 100%;
  overflow: hidden;
}
.menu-check-msgbox .el-message-box__btns {
  padding: 14px 28px 24px;
}
.menu-check-msgbox .el-message-box__btns .el-button {
  min-width: 104px;
  height: 38px;
}
</style>
