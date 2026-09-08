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
      class="host-ctx-menu"
      :style="{ left: menu.x + 'px', top: menu.y + 'px' }"
      @mousedown.stop
    >
      <button type="button" class="ctx-item" @click="onOpen">
        打开
      </button>
      <div class="ctx-divider" />
      <button type="button" class="ctx-item" @click="onRename">
        重命名
      </button>
      <button type="button" class="ctx-item" @click="onEdit">
        编辑…
      </button>
      <button type="button" class="ctx-item" @click="onRefreshIcon">
        更新图标
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
            v-for="g in app.groupList"
            :key="g.id"
            type="button"
            class="ctx-item"
            :class="{ 'is-current': currentGroupIdOf(menu.host) === g.id }"
            @click="onMove(g.id)"
          >
            {{ g.name }}
          </button>
          <div v-if="app.groupList.length === 0" class="ctx-empty">
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
        停止会话
      </button>
      <button type="button" class="ctx-item is-danger" @click="onDelete">
        删除…
      </button>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
/**
 * 主机右键菜单分组：打开 → 编辑整理 → 环境安装 → 危险操作。
 * 「编辑…」与「迁移分组」通过事件回抛父组件（编辑弹窗与拖拽迁移逻辑在父级）。
 */
import { ref, watch } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { api } from "@/api";
import { useAppStore } from "@/stores/app";
import { useAgentInstallStore } from "@/stores/agentInstall";
import { formatErr } from "@/utils/format";

export interface CtxMenuState {
  host: string;
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

watch(
  () => props.menu,
  () => {
    groupSubOpen.value = false;
  }
);

function currentGroupIdOf(host: string): string {
  const g = app.groupList.find((x) => (x.hosts || []).includes(host));
  return g?.id || "";
}

function onOpen() {
  const host = props.menu?.host;
  emit("close");
  if (host) app.openHostTab(host);
}

async function onRename() {
  const host = props.menu?.host;
  emit("close");
  if (!host) return;
  try {
    const { value } = await ElMessageBox.prompt("新的主机别名", "重命名", {
      confirmButtonText: "确定",
      cancelButtonText: "取消",
      inputValue: host,
      inputPattern: /^[^\s]+$/,
      inputErrorMessage: "别名不能为空或包含空格",
    });
    const next = value.trim();
    if (!next || next === host) return;
    await app.renameHost(host, next);
    ElMessage.success(`已重命名为 ${next}`);
  } catch (err) {
    if (err === "cancel" || err === "close") return;
    ElMessage.error(`重命名失败: ${formatErr(err)}`);
  }
}

function onEdit() {
  const host = props.menu?.host;
  emit("close");
  if (host) emit("edit", host);
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

async function onDelete() {
  const host = props.menu?.host;
  emit("close");
  if (!host) return;
  try {
    // 第一次确认
    await ElMessageBox.confirm(
      `确定删除主机「${host}」？此操作不可撤销。`,
      "删除主机",
      {
        type: "warning",
        confirmButtonText: "继续",
        cancelButtonText: "取消",
      }
    );
    // 第二次确认：明确写出将改写 ~/.ssh/config
    await ElMessageBox.confirm(
      `将从本机 ~/.ssh/config 中永久移除「${host}」条目，并清理分组引用。请再次确认。`,
      "二次确认",
      {
        type: "error",
        confirmButtonText: "确认删除",
        cancelButtonText: "取消",
        confirmButtonClass: "el-button--danger",
      }
    );
    await app.deleteHost(host);
    ElMessage.success(`已删除 ${host}`);
  } catch (err) {
    if (err === "cancel" || err === "close") return;
    ElMessage.error(`删除失败: ${formatErr(err)}`);
  }
}

async function onStop() {
  const host = props.menu?.host;
  emit("close");
  if (!host || !app.isRunning(host)) return;
  try {
    await ElMessageBox.confirm(
      `停止「${host}」的后台会话？重新打开将重新加载。`,
      "停止会话",
      {
        type: "warning",
        confirmButtonText: "停止",
        cancelButtonText: "取消",
      }
    );
    app.stopHost(host);
    ElMessage.success("已停止");
  } catch {
    /* cancel */
  }
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
    app.openHostTab(host); // 从任意视图触发都先切到该主机
    await app.runInTerminal(`bash ${remotePath}; rm -f ${remotePath}`);
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

html.dark .host-ctx-menu,
html.dark .host-ctx-menu .ctx-sub {
  background: var(--m3-surface-container-lowest);
  color: var(--m3-on-surface);
}

html.dark .host-ctx-menu .ctx-item:hover,
html.dark .host-ctx-menu .ctx-item.is-current {
  background: color-mix(in srgb, var(--m3-primary) 12%, transparent);
}
</style>
