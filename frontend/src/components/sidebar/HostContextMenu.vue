<template>
  <!-- 主机右键菜单：挂 body，位置由父组件计算 -->
  <Teleport to="body">
    <div
      v-if="menu"
      class="host-ctx-backdrop"
      @mousedown="emit('close')"
      @contextmenu.prevent="emit('close')"
    />
    <div
      v-if="menu"
      ref="menuEl"
      class="host-ctx-menu"
      :style="{ left: pos.x + 'px', top: pos.y + 'px' }"
      @mousedown.stop
    >
      <div v-if="batchCount > 1" class="ctx-batch-hint">已选 {{ batchCount }} 台</div>
      <button type="button" class="ctx-item" @click="onOpenTerminal">
        打开终端
      </button>
      <button type="button" class="ctx-item" @click="onOpenInfo">
        打开概览
      </button>
      <button type="button" class="ctx-item" @click="onOpenSftp">
        打开XFPT
      </button>
      <button type="button" class="ctx-item" @click="onOpenMonitor">
        打开监控
      </button>
      <template v-if="batchCount <= 1">
      <div class="ctx-divider" />
      <button type="button" class="ctx-item" @click="onEdit">
        编辑…
      </button>
      <button type="button" class="ctx-item" @click="onCopyInfo">
        复制信息
      </button>
      <button type="button" class="ctx-item" @click="onRefreshIcon">
        更新图标
      </button>
      <button type="button" class="ctx-item" @click="onTogglePin">
        {{ app.isPinned(menu.host) ? "取消置顶" : "置顶" }}
      </button>
      <div
        class="ctx-item ctx-has-sub"
        @mouseenter="groupSubOpen = true"
        @mouseleave="groupSubOpen = false"
      >
        <span>迁移分组</span>
        <span class="ctx-arrow">›</span>
        <div v-show="groupSubOpen" class="ctx-sub">
          <button
            type="button"
            class="ctx-item"
            :class="{ 'is-current': currentGroupIdOf(menu.host) === '' }"
            @click="onMove('')"
          >
            未分组
          </button>
          <button
            v-for="n in migrateNodes"
            :key="n.group!.id"
            type="button"
            class="ctx-item"
            :class="{ 'is-current': currentGroupIdOf(menu.host) === n.group!.id }"
            :style="{ paddingLeft: `${12 + (n.depth - 1) * 12}px` }"
            @click="onMove(n.group!.id)"
          >
            {{ n.group!.name }}
          </button>
          <div v-if="migrateNodes.length === 0" class="ctx-empty">
            暂无分组，请先新建
          </div>
        </div>
      </div>
      <div class="ctx-divider" />
      <button type="button" class="ctx-item" @click="onInstallAgent">
        安装 Agent…
      </button>
      <button type="button" class="ctx-item" @click="onCheckAgent">
        检查 Agent…
      </button>
      <button
        v-if="app.isRunning(menu.host)"
        type="button"
        class="ctx-item"
        @click="onInitZsh"
      >
        初始化 zsh…
      </button>
      <div class="ctx-divider" />
      <button
        v-if="app.isRunning(menu.host)"
        type="button"
        class="ctx-item is-danger"
        @click="onStop"
      >
        关闭主机页
      </button>
      <button type="button" class="ctx-item is-danger" @click="onDelete">
        删除…
      </button>
      </template>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
/**
 * 主机右键菜单：打开终端/概览/XFPT/监控 → 编辑整理 → 环境安装 → 危险操作。
 * 多选时只保留前四项，并对已选主机逐台打开。
 * 「编辑…」与「迁移分组」通过事件回抛父组件（编辑弹窗与拖拽迁移逻辑在父级）。
 */
import { computed, nextTick, reactive, ref, watch } from "vue";
import { ElLoading, ElMessage, ElMessageBox } from "element-plus";
import { api } from "@/api";
import { useAppStore } from "@/stores/app";
import { useAgentInstallStore } from "@/stores/agentInstall";
import { copyText } from "@/utils/clipboard";
import { clampContextMenuPos } from "@/utils/contextMenuPos";
import { formatErr } from "@/utils/format";
import { confirmStopHostSession } from "@/utils/hostSession";

export interface CtxMenuState {
  host: string;
  /** 多选时的全部主机；缺省或只有一台时菜单按单台处理 */
  hosts?: string[];
  x: number;
  y: number;
}

const props = defineProps<{ menu: CtxMenuState | null }>();

const emit = defineEmits<{
  (e: "close"): void;
  (e: "edit", host: string): void;
  (e: "move", host: string, groupId: string): void;
}>();

const app = useAppStore();
const agentInstall = useAgentInstallStore();
const groupSubOpen = ref(false);
const menuEl = ref<HTMLElement | null>(null);
const pos = reactive({ x: 0, y: 0 });

const migrateNodes = computed(() => app.flattenGroupNodes());

const batchCount = computed(() => {
  const list = props.menu?.hosts;
  if (!list || list.length < 2) return 0;
  return list.length;
});

function menuHosts(): string[] {
  const m = props.menu;
  if (!m) return [];
  if (m.hosts && m.hosts.length > 0) return m.hosts.slice();
  if (m.host) return [m.host];
  return [];
}

function openEach(subTab: "terminal" | "overview" | "files" | "monitor") {
  const hosts = menuHosts();
  emit("close");
  for (const host of hosts) {
    app.openHostTab(host, subTab);
  }
}

watch(
  () => props.menu,
  async (m) => {
    groupSubOpen.value = false;
    if (!m) return;
    // 先落到点击处，挂载后再按真实高度上移/左移，避免贴底被裁
    pos.x = m.x;
    pos.y = m.y;
    await nextTick();
    const el = menuEl.value;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const next = clampContextMenuPos(m.x, m.y, r.width, r.height);
    pos.x = next.x;
    pos.y = next.y;
  }
);

function currentGroupIdOf(host: string): string {
  const g = app.groupList.find((x) => (x.hosts || []).includes(host));
  return g?.id || "";
}

function onOpenTerminal() {
  openEach("terminal");
}

function onOpenInfo() {
  openEach("overview");
}

function onOpenSftp() {
  openEach("files");
}

function onOpenMonitor() {
  openEach("monitor");
}

function onEdit() {
  const host = props.menu?.host;
  emit("close");
  if (host) emit("edit", host);
}

async function onCopyInfo() {
  const host = props.menu?.host;
  emit("close");
  if (!host) return;
  try {
    const text = await api.formatHostInfo(host);
    await copyText(text);
    ElMessage.success("已复制主机信息");
  } catch (err) {
    ElMessage.error(`复制失败: ${formatErr(err)}`);
  }
}

async function onRefreshIcon() {
  const host = props.menu?.host;
  emit("close");
  if (!host) return;
  try {
    const os = await app.refreshHostIcon(host);
    ElMessage.success(`${host}：${os || "图标已更新"}`);
  } catch (err) {
    ElMessage.error(`更新图标失败: ${formatErr(err)}`);
  }
}

function onTogglePin() {
  const host = props.menu?.host;
  emit("close");
  if (!host) return;
  const wasPinned = app.isPinned(host);
  app.togglePinHost(host);
  ElMessage.success(wasPinned ? `已取消置顶 ${host}` : `已置顶 ${host}`);
}

function onMove(groupId: string) {
  const host = props.menu?.host;
  emit("close");
  if (host) emit("move", host, groupId);
}

/** 右键「安装 Agent」：单台安装入口；幂等，已装时更新到内置版本，历史数据保留 */
async function onInstallAgent() {
  const host = props.menu?.host;
  emit("close");
  if (!host) return;
  try {
    await ElMessageBox.confirm(
      `将向 ${host} 部署 spanel-agent（systemd 服务，约 10MB）。已安装时更新到面板内置版本，历史数据保留。`,
      "安装 Agent",
      { confirmButtonText: "安装", cancelButtonText: "取消" }
    );
  } catch {
    return; // 用户取消
  }
  // 进度对话框内展示各阶段步骤；成功后 store.lastInstalled 通知概览/分组页刷新
  await agentInstall.start(host);
}

function onCheckAgent() {
  const host = props.menu?.host;
  emit("close");
  if (host) agentInstall.openCheck(host);
}

/** 删除主机：单弹窗确认；确认后直接卸载远端 spanel-agent（含数据）再删本地记录。
 * 卸载与探测在弹窗确认后串行执行，失败则中止删除。 */
async function onDelete() {
  const host = props.menu?.host;
  emit("close");
  if (!host) return;

  try {
    await ElMessageBox.confirm(
      `将从本机 ~/.ssh/config 中永久移除「${host}」条目，并清理分组引用。\n` +
        `若该主机上装有 spanel-agent，将一并卸载并清理其监控数据。\n` +
        `此操作不可撤销。`,
      `删除主机「${host}」`,
      {
        type: "warning",
        confirmButtonText: "删除",
        cancelButtonText: "取消",
        confirmButtonClass: "el-button--danger",
      }
    );
  } catch {
    return; // 用户取消
  }

  // 探测是否装有 agent：未装/连不上都直接走删除，不再打扰用户
  let installed = false;
  const probeLoading = ElLoading.service({
    text: `正在检查「${host}」上的 spanel-agent…`,
    background: "rgba(0, 0, 0, 0.4)",
  });
  try {
    const p = await api.agentProbeInfo(host);
    installed = p.HasBinary;
  } catch {
    installed = false; // 连不上就跳过卸载（本机记录删除不受影响）
  } finally {
    probeLoading.close();
  }

  if (installed) {
    const loading = ElLoading.service({
      text: `正在卸载「${host}」上的 spanel-agent 并清理数据…`,
      background: "rgba(0, 0, 0, 0.4)",
    });
    try {
      await api.uninstallAgent(host, false); // keepData=false：连同 /var/lib/spanel-agent 数据目录一起删
    } catch (e) {
      ElMessage.error(`卸载 Agent 失败，已中止删除主机: ${formatErr(e)}`);
      return; // 卸载失败不删本地记录，避免留下失管主机
    } finally {
      loading.close();
    }
  }

  try {
    await app.deleteHost(host);
    ElMessage.success(`已删除 ${host}`);
  } catch (err) {
    ElMessage.error(`删除失败: ${formatErr(err)}`);
  }
}

async function onStop() {
  const host = props.menu?.host;
  emit("close");
  if (!host) return;
  await confirmStopHostSession(app, host);
}

/** 右键「初始化 zsh」：上传内置脚本并在该主机终端自动执行（原顶栏按钮迁移至此） */
async function onInitZsh() {
  const host = props.menu?.host;
  emit("close");
  if (!host || !app.isRunning(host)) return;
  try {
    await ElMessageBox.confirm(
      `将在主机「${host}」上安装 zsh + Oh My Zsh(ys 主题)+ 代码高亮/历史提示插件。\n` +
        `需要该用户具备 sudo 免密权限,耗时约 1~5 分钟,会在终端实时显示输出。`,
      "初始化 zsh 环境",
      { type: "warning", confirmButtonText: "开始", cancelButtonText: "取消" }
    );
  } catch {
    return; // 用户取消
  }
  try {
    const remotePath = await api.bootstrapZsh(host);
    await app.runInTerminal(`bash ${remotePath}; rm -f ${remotePath}`, host);
    ElMessage.success("脚本已上传,正在终端执行…");
  } catch (e) {
    ElMessage.error(`上传脚本失败: ${formatErr(e)}`);
  }
}
</script>

<style>
/* 右键菜单挂 body，非 scoped。
   注意：.host-ctx-backdrop / .host-ctx-menu / .ctx-item 也被侧栏空白处
   右键菜单（SidebarHost 内联模板）复用，改类名时需同步。 */
.host-ctx-backdrop {
  position: fixed;
  inset: 0;
  z-index: 100000;
}

/* M3 Menu：白底、elevation-2、8dp 圆角；项 40dp、悬停状态层 */
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

.host-ctx-menu .ctx-batch-hint {
  padding: 4px 12px 6px;
  color: var(--m3-on-surface-variant);
  font: var(--m3-label-medium);
}

.host-ctx-menu .ctx-kbd {
  margin-left: 24px;
  color: var(--m3-on-surface-variant);
  font: var(--m3-label-medium);
  font-variant-numeric: tabular-nums;
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
  transition: background-color var(--m3-motion-state);
}

.host-ctx-menu .ctx-item:hover,
.host-ctx-menu .ctx-item.is-current {
  background: color-mix(in srgb, var(--m3-primary) 8%, transparent);
}

.host-ctx-menu .ctx-item.is-current {
  color: var(--m3-primary);
  font-weight: 600;
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

.host-ctx-menu .ctx-has-sub {
  position: relative;
}

.host-ctx-menu .ctx-arrow {
  margin-left: 16px;
  color: var(--m3-on-surface-variant);
  font-size: 14px;
}

.host-ctx-menu .ctx-sub {
  position: absolute;
  left: calc(100% + 4px);
  top: -8px;
  min-width: 148px;
  max-height: 280px;
  overflow-y: auto;
  padding: 8px;
  border-radius: var(--m3-shape-s);
  background: var(--m3-surface-container-lowest);
  border: none;
  box-shadow: var(--m3-elevation-2);
}

.host-ctx-menu .ctx-empty {
  padding: 10px 12px;
  font: var(--m3-label-medium);
  color: var(--m3-on-surface-variant);
}
</style>
