<template>
  <aside
    class="panel-sidebar"
    :class="{ 'is-resizing': resizing, 'is-host-dragging': !!dragState }"
    :style="{ width: width + 'px' }"
  >
    <div class="search-box">
      <el-input
        v-model="query"
        clearable
        class="host-search"
        placeholder="搜索主机..."
        :prefix-icon="Search"
      />
    </div>

    <div class="menu-wrap" ref="menuWrapRef">
      <!-- 不用 unique-opened：多分组可同时展开 -->
      <el-menu :default-active="activeId" :default-openeds="openedGroups">
        <el-sub-menu
          v-for="(node, gIdx) in filtered"
          :key="node.group?.id || UNGROUPED_ID"
          :index="node.group?.id || UNGROUPED_ID"
          class="group-sub"
          :class="{
            'is-drop-target':
              dropTargetId === (node.group?.id || UNGROUPED_ID),
          }"
          :style="groupCssVars(node.group?.id || UNGROUPED_ID, gIdx)"
        >
          <template #title>
            <!-- data-drop-group：指针拖放命中区（整行标题） -->
            <div
              class="group-title-row"
              :data-drop-group="node.group?.id || UNGROUPED_ID"
              :style="groupCssVars(node.group?.id || UNGROUPED_ID, gIdx)"
            >
              <span
                class="group-color-dot"
                title="分组色"
                :style="{
                  backgroundColor: groupColor(
                    node.group?.id || UNGROUPED_ID,
                    gIdx
                  ).accent,
                }"
              />
              <el-icon
                class="group-folder-ico"
                :style="{
                  color: groupColor(node.group?.id || UNGROUPED_ID, gIdx).ink,
                }"
              >
                <Folder />
              </el-icon>
              <span
                class="menu-title group-name"
                :style="{
                  color: groupColor(node.group?.id || UNGROUPED_ID, gIdx).ink,
                }"
                @click.stop="
                  openGroup(
                    node.group?.id || UNGROUPED_ID,
                    node.group?.name || '未分组'
                  )
                "
              >
                {{ node.group?.name || "未分组" }}
              </span>
              <span
                class="menu-count"
                :style="{
                  color: groupColor(node.group?.id || UNGROUPED_ID, gIdx).ink,
                  backgroundColor: groupColor(
                    node.group?.id || UNGROUPED_ID,
                    gIdx
                  ).soft,
                }"
              >
                {{ node.hosts.length }}
              </span>
            </div>
          </template>

          <el-menu-item
            v-for="h in node.hosts"
            :key="h.name"
            :index="h.name"
            class="host-item"
            :class="{
              'is-running': app.isRunning(h.name),
              'is-drag-source': dragState?.host === h.name,
            }"
            :style="{
              ...groupCssVars(node.group?.id || UNGROUPED_ID, gIdx),
              borderLeftColor: groupColor(
                node.group?.id || UNGROUPED_ID,
                gIdx
              ).accent,
            }"
            @pointerdown="onHostPointerDown($event, h.name)"
            @click="onHostClick(h.name)"
            @contextmenu.prevent="onHostContext($event, h.name)"
          >
            <el-icon
              class="host-ico"
              :style="{
                color: groupColor(node.group?.id || UNGROUPED_ID, gIdx).ink,
              }"
            >
              <Monitor />
            </el-icon>
            <span class="menu-title">{{ h.name }}</span>
            <span
              v-if="app.isRunning(h.name)"
              class="run-dot"
              title="运行中（后台保持）"
            />
          </el-menu-item>
        </el-sub-menu>
      </el-menu>
    </div>

    <div class="sidebar-footer">
      <el-button
        class="create-btn"
        plain
        type="primary"
        :icon="Plus"
        style="width: 100%"
        @click="onCreateGroup"
      >
        新建分组
      </el-button>
      <div class="host-count">
        共 {{ app.hosts.length }} 台
        <template v-if="app.runningHosts.length">
          · 运行中 {{ app.runningHosts.length }}
        </template>
      </div>
      <div class="drag-hint">拖拽主机到分组标题可调整分组</div>
    </div>

    <div
      class="sidebar-resize-handle"
      title="拖动调整宽度；双击自适应"
      @pointerdown="onResizeStart"
      @dblclick="onResizeDblClick"
    />

    <!-- 拖拽幽灵：跟随指针，不依赖 HTML5 DnD（Wails/EP 菜单更稳） -->
    <Teleport to="body">
      <div
        v-if="dragState?.active"
        class="host-drag-ghost"
        :style="{
          left: dragState.x + 12 + 'px',
          top: dragState.y + 12 + 'px',
        }"
      >
        <el-icon><Monitor /></el-icon>
        {{ dragState.host }}
      </div>
    </Teleport>

    <!-- 主机右键菜单 -->
    <Teleport to="body">
      <div
        v-if="ctxMenu"
        class="host-ctx-backdrop"
        @mousedown="closeCtxMenu"
        @contextmenu.prevent="closeCtxMenu"
      />
      <div
        v-if="ctxMenu"
        ref="ctxMenuRef"
        class="host-ctx-menu"
        :style="{ left: ctxMenu.x + 'px', top: ctxMenu.y + 'px' }"
        @mousedown.stop
      >
        <button type="button" class="ctx-item" @click="onCtxOpen">
          打开
        </button>
        <button type="button" class="ctx-item" @click="onCtxRename">
          重命名
        </button>
        <button type="button" class="ctx-item" @click="onCtxEdit">
          编辑…
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
              :class="{ 'is-current': currentGroupIdOf(ctxMenu.host) === '' }"
              @click="onCtxMove('')"
            >
              未分组
            </button>
            <button
              v-for="g in app.groupList"
              :key="g.id"
              type="button"
              class="ctx-item"
              :class="{
                'is-current': currentGroupIdOf(ctxMenu.host) === g.id,
              }"
              @click="onCtxMove(g.id)"
            >
              {{ g.name }}
            </button>
            <div v-if="app.groupList.length === 0" class="ctx-empty">
              暂无分组，请先新建
            </div>
          </div>
        </div>
        <div class="ctx-divider" />
        <button type="button" class="ctx-item is-danger" @click="onCtxDelete">
          删除…
        </button>
        <template v-if="app.isRunning(ctxMenu.host)">
          <button type="button" class="ctx-item is-danger" @click="onCtxStop">
            断开连接
          </button>
        </template>
      </div>
    </Teleport>

    <!-- 编辑主机：改 IP/用户，须密码验连后保存 -->
    <el-dialog
      v-model="editOpen"
      title="编辑主机"
      width="440px"
      destroy-on-close
      :close-on-click-modal="!editSaving"
      @closed="resetEditForm"
    >
      <p class="edit-host-hint">
        保存前会用密码测试 SSH 连通性，通过后更新
        <code>~/.ssh/config</code> 并推送本机公钥。别名请用「重命名」。
      </p>
      <el-form label-width="80px" @submit.prevent="onEditSave">
        <el-form-item label="别名">
          <el-input :model-value="editForm.name" disabled />
        </el-form-item>
        <el-form-item label="地址" required>
          <el-input
            v-model="editForm.hostName"
            placeholder="IP 或域名"
            :disabled="editSaving"
          />
        </el-form-item>
        <el-form-item label="用户" required>
          <el-input
            v-model="editForm.user"
            placeholder="root"
            :disabled="editSaving"
          />
        </el-form-item>
        <el-form-item label="密码" required>
          <el-input
            v-model="editForm.password"
            type="password"
            show-password
            placeholder="用于测试连接，不落盘"
            :disabled="editSaving"
            @keyup.enter="onEditSave"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button :disabled="editSaving" @click="editOpen = false">
          取消
        </el-button>
        <el-button type="primary" :loading="editSaving" @click="onEditSave">
          {{ editSaving ? "验证并保存…" : "测试并保存" }}
        </el-button>
      </template>
    </el-dialog>
  </aside>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import { Folder, Monitor, Plus, Search } from "@element-plus/icons-vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { useAppStore, UNGROUPED_ID } from "@/stores/app";

const SIDEBAR_MIN_WIDTH = 180;
const SIDEBAR_MAX_WIDTH = 320;
const HOST_ROW_CHROME = 80;
const STORAGE_KEY = "ipannel.sidebarWidth";
/** 移动超过该像素才算拖拽，避免误触 */
const DRAG_THRESHOLD = 6;

/**
 * 分组色板：统一在 1Panel 主色蓝附近的冷色阶梯
 * 相邻组可区分，但整体同一色系（无橙/红/高饱和撞色）
 * accent=色条/圆点，soft=浅底，ink=文字/图标
 */
const GROUP_PALETTE = [
  { accent: "#005eeb", soft: "rgba(0, 94, 235, 0.12)", ink: "#005eeb" }, // 主蓝
  { accent: "#3375f6", soft: "rgba(51, 117, 246, 0.12)", ink: "#2a62d4" }, // 亮蓝
  { accent: "#1a7fd4", soft: "rgba(26, 127, 212, 0.12)", ink: "#176bae" }, // 天蓝
  { accent: "#3d8bfd", soft: "rgba(61, 139, 253, 0.12)", ink: "#2f6fd4" }, // 浅蓝
  { accent: "#4c6ef5", soft: "rgba(76, 110, 245, 0.12)", ink: "#3b5bdb" }, // 靛蓝
  { accent: "#5c7cfa", soft: "rgba(92, 124, 250, 0.12)", ink: "#4c6ef5" }, // 柔靛
  { accent: "#228be6", soft: "rgba(34, 139, 230, 0.12)", ink: "#1c7ed6" }, // 青蓝
  { accent: "#15aabf", soft: "rgba(21, 170, 191, 0.12)", ink: "#1098ad" }, // 青蓝绿（仍冷色）
  { accent: "#4263eb", soft: "rgba(66, 99, 235, 0.12)", ink: "#364fc7" }, // 深紫蓝
  { accent: "#748ffc", soft: "rgba(116, 143, 252, 0.12)", ink: "#5c7cfa" }, // 淡蓝紫
] as const;

/** 未分组：同色系低饱和灰蓝，不抢戏 */
const UNGROUPED_COLOR = {
  accent: "#868e96",
  soft: "rgba(134, 142, 150, 0.12)",
  ink: "#495057",
} as const;

type GroupColor = {
  accent: string;
  soft: string;
  ink: string;
};

/** 按列表下标取色（最直观、相邻必不同）；未分组固定灰 */
function groupColor(groupId: string, index: number): GroupColor {
  if (groupId === UNGROUPED_ID) return UNGROUPED_COLOR;
  return GROUP_PALETTE[index % GROUP_PALETTE.length];
}

/** CSS 变量：写到标题行 / 主机行，避免依赖 el-sub-menu 根节点继承 */
function groupCssVars(groupId: string, index: number): Record<string, string> {
  const c = groupColor(groupId, index);
  return {
    "--g-accent": c.accent,
    "--g-soft": c.soft,
    "--g-ink": c.ink,
  };
}

const app = useAppStore();
const query = ref("");
const resizing = ref(false);
const width = ref(loadStoredWidth());
const dropTargetId = ref<string | null>(null);
const menuWrapRef = ref<HTMLElement | null>(null);

/** 抑制 pointer 拖拽结束后的 click */
let suppressClick = false;

interface DragState {
  host: string;
  startX: number;
  startY: number;
  x: number;
  y: number;
  active: boolean;
  pointerId: number;
}
const dragState = ref<DragState | null>(null);

const activeId = computed(() => app.activeTabId || "");

const openedGroups = computed(() =>
  app.groupNodes.map((n) => n.group?.id || UNGROUPED_ID)
);

const filtered = computed(() => {
  const q = query.value.trim().toLowerCase();
  if (!q) return app.groupNodes;
  return app.groupNodes
    .map((n) => ({
      ...n,
      hosts: n.hosts.filter(
        (h) =>
          h.name.toLowerCase().includes(q) ||
          (h.hostName || "").toLowerCase().includes(q)
      ),
    }))
    .filter((n) => n.hosts.length > 0 || !!n.group);
});

function clampWidth(w: number): number {
  return Math.max(
    SIDEBAR_MIN_WIDTH,
    Math.min(SIDEBAR_MAX_WIDTH, Math.round(w))
  );
}

function loadStoredWidth(): number {
  try {
    const n = Number(localStorage.getItem(STORAGE_KEY));
    if (Number.isFinite(n) && n > 0) return clampWidth(n);
  } catch {
    /* ignore */
  }
  return SIDEBAR_MIN_WIDTH;
}

function saveWidth(w: number) {
  try {
    localStorage.setItem(STORAGE_KEY, String(w));
  } catch {
    /* ignore */
  }
}

function measureNeededWidth(): number {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return SIDEBAR_MIN_WIDTH;
  ctx.font =
    "400 14px Helvetica Neue, PingFang SC, Microsoft YaHei, sans-serif";
  let maxText = 0;
  for (const h of app.hosts) {
    if (!h.name) continue;
    maxText = Math.max(maxText, ctx.measureText(h.name).width);
  }
  for (const node of app.groupNodes) {
    const name = node.group?.name || "未分组";
    maxText = Math.max(maxText, ctx.measureText(name).width);
  }
  return clampWidth(Math.ceil(maxText + HOST_ROW_CHROME));
}

function autoFitWidth() {
  if (app.hosts.length === 0 && app.groupNodes.length === 0) return;
  const needed = measureNeededWidth();
  if (needed > width.value) {
    width.value = needed;
    saveWidth(needed);
  }
}

function onResizeDblClick(e: MouseEvent) {
  e.preventDefault();
  e.stopPropagation();
  const needed = measureNeededWidth();
  if (needed === width.value) return;
  width.value = needed;
  saveWidth(needed);
}

function onResizeStart(e: PointerEvent) {
  e.preventDefault();
  e.stopPropagation();
  const startX = e.clientX;
  const startW = width.value;
  resizing.value = true;
  const prevCursor = document.body.style.cursor;
  const prevSelect = document.body.style.userSelect;
  document.body.style.cursor = "col-resize";
  document.body.style.userSelect = "none";
  const onMove = (ev: PointerEvent) => {
    width.value = clampWidth(startW + (ev.clientX - startX));
  };
  const onUp = () => {
    resizing.value = false;
    document.body.style.cursor = prevCursor;
    document.body.style.userSelect = prevSelect;
    saveWidth(width.value);
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onUp);
  };
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
  window.addEventListener("pointercancel", onUp);
}

function openGroup(id: string, name: string) {
  app.openGroupTab(id, name);
}

// ---------- 指针拖拽主机到分组（不依赖 HTML5 DnD） ----------

function onHostPointerDown(e: PointerEvent, hostName: string) {
  // 只响应主键；侧栏调宽时不抢
  if (e.button !== 0 || resizing.value) return;
  // 不 preventDefault，以便仍可滚动；拖起来后再禁选中
  dragState.value = {
    host: hostName,
    startX: e.clientX,
    startY: e.clientY,
    x: e.clientX,
    y: e.clientY,
    active: false,
    pointerId: e.pointerId,
  };
  window.addEventListener("pointermove", onHostPointerMove);
  window.addEventListener("pointerup", onHostPointerUp);
  window.addEventListener("pointercancel", onHostPointerUp);
}

function onHostPointerMove(e: PointerEvent) {
  const st = dragState.value;
  if (!st || e.pointerId !== st.pointerId) return;

  st.x = e.clientX;
  st.y = e.clientY;

  if (!st.active) {
    const dx = e.clientX - st.startX;
    const dy = e.clientY - st.startY;
    if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    st.active = true;
    suppressClick = true;
    document.body.style.userSelect = "none";
    document.body.style.cursor = "grabbing";
  }

  // 命中分组标题
  const gid = hitTestDropGroup(e.clientX, e.clientY);
  dropTargetId.value = gid;
}

async function onHostPointerUp(e: PointerEvent) {
  const st = dragState.value;
  if (!st || e.pointerId !== st.pointerId) return;

  window.removeEventListener("pointermove", onHostPointerMove);
  window.removeEventListener("pointerup", onHostPointerUp);
  window.removeEventListener("pointercancel", onHostPointerUp);
  document.body.style.userSelect = "";
  document.body.style.cursor = "";

  const host = st.host;
  const wasActive = st.active;
  const target = dropTargetId.value;

  dragState.value = null;
  dropTargetId.value = null;

  if (!wasActive) {
    // 纯点击，交给 click 处理 openHostTab
    return;
  }

  // 拖拽结束：若落在分组上则分配
  if (target != null) {
    await moveHostToGroup(host, target);
  }

  // 吞掉随后的 click
  setTimeout(() => {
    suppressClick = false;
  }, 0);
}

/** 从坐标向上找带 data-drop-group 的节点 */
function hitTestDropGroup(x: number, y: number): string | null {
  const stack = document.elementsFromPoint(x, y);
  for (const el of stack) {
    if (!(el instanceof HTMLElement)) continue;
    // 幽灵自身忽略
    if (el.classList.contains("host-drag-ghost")) continue;
    const node = el.closest("[data-drop-group]") as HTMLElement | null;
    if (node?.dataset.dropGroup) return node.dataset.dropGroup;
    // Element Plus 标题栏：有时 data 在子节点，父级是 .el-sub-menu__title
    if (el.classList.contains("el-sub-menu__title")) {
      const inner = el.querySelector("[data-drop-group]") as HTMLElement | null;
      if (inner?.dataset.dropGroup) return inner.dataset.dropGroup;
    }
  }
  return null;
}

async function moveHostToGroup(host: string, groupId: string) {
  const target = groupId === UNGROUPED_ID ? "" : groupId;
  // 若已在该组则跳过
  if (target) {
    const g = app.groupList.find((x) => x.id === target);
    if (g?.hosts?.includes(host)) {
      ElMessage.info(`${host} 已在「${g.name}」中`);
      return;
    }
  } else {
    // 未分组：若当前不在任何组则跳过
    const inAny = app.groupList.some((g) => (g.hosts || []).includes(host));
    if (!inAny) {
      ElMessage.info(`${host} 已在未分组`);
      return;
    }
  }

  try {
    await app.assignHost(host, target);
    const label =
      groupId === UNGROUPED_ID
        ? "未分组"
        : app.groupList.find((g) => g.id === groupId)?.name || "分组";
    ElMessage.success(`已将 ${host} 移至「${label}」`);
  } catch (err) {
    ElMessage.error(`移动失败: ${err}`);
  }
}

function onHostClick(name: string) {
  if (suppressClick) return;
  app.openHostTab(name);
}

// ---------- 主机右键菜单 ----------

interface CtxMenu {
  host: string;
  x: number;
  y: number;
}
const ctxMenu = ref<CtxMenu | null>(null);
const ctxMenuRef = ref<HTMLElement | null>(null);
const groupSubOpen = ref(false);

function closeCtxMenu() {
  ctxMenu.value = null;
  groupSubOpen.value = false;
}

function onHostContext(e: MouseEvent, name: string) {
  // 先关掉拖拽态，避免右键后幽灵残留
  if (dragState.value) {
    window.removeEventListener("pointermove", onHostPointerMove);
    window.removeEventListener("pointerup", onHostPointerUp);
    window.removeEventListener("pointercancel", onHostPointerUp);
    document.body.style.userSelect = "";
    document.body.style.cursor = "";
    dragState.value = null;
    dropTargetId.value = null;
  }

  // 预估菜单位置，避免贴边溢出（实际 DOM 挂载后再微调）
  const pad = 8;
  let x = e.clientX;
  let y = e.clientY;
  const approxW = 168;
  const approxH = 160;
  if (x + approxW > window.innerWidth - pad) x = window.innerWidth - approxW - pad;
  if (y + approxH > window.innerHeight - pad) y = window.innerHeight - approxH - pad;
  if (x < pad) x = pad;
  if (y < pad) y = pad;

  groupSubOpen.value = false;
  ctxMenu.value = { host: name, x, y };
}

function currentGroupIdOf(host: string): string {
  const g = app.groupList.find((x) => (x.hosts || []).includes(host));
  return g?.id || "";
}

function onCtxOpen() {
  const host = ctxMenu.value?.host;
  closeCtxMenu();
  if (host) app.openHostTab(host);
}

async function onCtxRename() {
  const host = ctxMenu.value?.host;
  closeCtxMenu();
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

// ---------- 编辑主机 ----------

const editOpen = ref(false);
const editSaving = ref(false);
const editForm = reactive({
  name: "",
  hostName: "",
  user: "root",
  password: "",
});

function resetEditForm() {
  editForm.name = "";
  editForm.hostName = "";
  editForm.user = "root";
  editForm.password = "";
  editSaving.value = false;
}

function onCtxEdit() {
  const host = ctxMenu.value?.host;
  closeCtxMenu();
  if (!host) return;
  const h = app.hosts.find((x) => x.name === host);
  editForm.name = host;
  editForm.hostName = h?.hostName || "";
  editForm.user = h?.user || "root";
  editForm.password = "";
  editOpen.value = true;
}

function formatErr(e: unknown): string {
  if (e == null) return "未知错误";
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message || String(e);
  const any = e as { message?: string };
  if (any.message) return any.message;
  return String(e);
}

async function onEditSave() {
  const name = editForm.name.trim();
  const hostName = editForm.hostName.trim();
  const user = editForm.user.trim();
  if (!name || !hostName || !user || !editForm.password) {
    ElMessage.warning("地址、用户、密码均不能为空");
    return;
  }
  editSaving.value = true;
  try {
    await app.updateHost({
      name,
      hostName,
      user,
      password: editForm.password,
    });
    ElMessage.success("已验证并保存");
    editOpen.value = false;
  } catch (e) {
    ElMessage.error(formatErr(e));
  } finally {
    editSaving.value = false;
  }
}

async function onCtxDelete() {
  const host = ctxMenu.value?.host;
  closeCtxMenu();
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

async function onCtxMove(groupId: string) {
  const host = ctxMenu.value?.host;
  closeCtxMenu();
  if (!host) return;
  await moveHostToGroup(host, groupId || UNGROUPED_ID);
}

async function onCtxStop() {
  const host = ctxMenu.value?.host;
  closeCtxMenu();
  if (!host || !app.isRunning(host)) return;
  try {
    await ElMessageBox.confirm(
      `断开「${host}」的后台连接？切换回来将重新加载。`,
      "断开连接",
      {
        type: "warning",
        confirmButtonText: "断开",
        cancelButtonText: "取消",
      }
    );
    app.stopHost(host);
    ElMessage.success("已断开");
  } catch {
    /* cancel */
  }
}

function onCtxKeydown(e: KeyboardEvent) {
  if (e.key === "Escape" && ctxMenu.value) {
    closeCtxMenu();
  }
}

async function onCreateGroup() {
  try {
    const { value } = await ElMessageBox.prompt("分组名称", "新建分组", {
      confirmButtonText: "创建",
      cancelButtonText: "取消",
      inputPattern: /\S+/,
      inputErrorMessage: "名称不能为空",
    });
    const id = await app.createGroup(value.trim());
    ElMessage.success("已创建");
    app.openGroupTab(id, value.trim());
  } catch {
    /* cancel */
  }
}

onMounted(() => {
  autoFitWidth();
  window.addEventListener("keydown", onCtxKeydown);
});

onBeforeUnmount(() => {
  window.removeEventListener("pointermove", onHostPointerMove);
  window.removeEventListener("pointerup", onHostPointerUp);
  window.removeEventListener("pointercancel", onHostPointerUp);
  window.removeEventListener("keydown", onCtxKeydown);
});

watch(
  () => [app.hosts, app.groupNodes] as const,
  () => {
    autoFitWidth();
  },
  { deep: true }
);
</script>

<style scoped lang="scss">
.panel-sidebar {
  position: relative;
  min-width: 180px;
  max-width: 320px;
  flex-shrink: 0;

  &:not(.is-resizing) {
    transition: width 0.15s ease;
  }

  &.is-resizing,
  &.is-host-dragging {
    transition: none;
    user-select: none;
  }
}

.search-box {
  flex-shrink: 0;
  /* 与顶栏约 48px 视觉对齐：更大内边距 + 默认尺寸输入框 */
  padding: 12px 12px 10px;
  box-sizing: border-box;
}

.host-search {
  width: 100%;

  :deep(.el-input__wrapper) {
    min-height: 36px;
    padding: 4px 12px;
    border-radius: 8px;
    box-shadow: 0 0 0 1px var(--el-border-color) inset;
    background: var(--el-bg-color, #fff);
    transition: box-shadow 0.15s ease;

    &:hover {
      box-shadow: 0 0 0 1px var(--el-color-primary-light-5) inset;
    }
    &.is-focus {
      box-shadow: 0 0 0 1px var(--el-color-primary) inset;
    }
  }

  :deep(.el-input__inner) {
    height: 28px;
    line-height: 28px;
    font-size: 13px;
  }

  :deep(.el-input__prefix) {
    font-size: 16px;
    color: var(--el-text-color-secondary);
  }
}

html.dark .host-search {
  :deep(.el-input__wrapper) {
    background: var(--el-fill-color-blank, #1d1e1f);
  }
}

/* ---------- 分组分色（颜色以内联 style 为准，避免 EP/全局主色覆盖） ---------- */
.group-sub {
  /* 兜底，正常由 :style CSS 变量覆盖 */
  --g-accent: #909399;
  --g-soft: rgba(144, 147, 153, 0.12);
  --g-ink: #606266;
}

/* 标题外层 li 上的 style 变量 → 作用于 title */
.group-sub :deep(> .el-sub-menu__title) {
  background: var(--g-soft) !important;
  border: 1px solid transparent !important;
  border-left: 3px solid var(--g-accent) !important;
  box-shadow: none !important;
  padding-left: 9px !important;
}

.group-sub :deep(> .el-sub-menu__title:hover) {
  background: var(--g-soft) !important;
  border-color: transparent !important;
  border-left-color: var(--g-accent) !important;
  box-shadow: none !important;
  color: var(--g-ink) !important;
}

.group-sub :deep(> .el-sub-menu__title .el-sub-menu__icon-arrow) {
  color: var(--g-ink) !important;
  opacity: 0.9;
}

.group-title-row {
  display: flex;
  align-items: center;
  width: 100%;
  min-width: 0;
  gap: 6px;
  min-height: 100%;
  pointer-events: auto;
}

.group-color-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.group-folder-ico {
  flex-shrink: 0;
}

.group-name {
  font-weight: 600;
}

.menu-title {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.menu-count {
  margin-left: 6px;
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

/* 主机项：左侧色条以内联 borderLeftColor 为准 */
.host-item {
  cursor: grab;
  touch-action: none;
  border: 1px solid transparent !important;
  border-left: 3px solid var(--g-accent, #909399) !important;
  margin-left: 4px !important;
  box-shadow: none !important;

  .host-ico {
    opacity: 0.9;
  }

  &:active {
    cursor: grabbing;
  }

  &.is-running .menu-title {
    font-weight: 500;
  }

  &.is-drag-source {
    opacity: 0.45;
  }
}

/* 覆盖全局 panel-sidebar 的主色 hover/active 描边 */
.group-sub :deep(.el-menu-item.host-item:hover) {
  background: var(--g-soft) !important;
  border-color: transparent !important;
  border-left-color: var(--g-accent) !important;
  box-shadow: none !important;
  color: var(--g-ink) !important;
}

.group-sub :deep(.el-menu-item.host-item.is-active) {
  background: var(--g-soft) !important;
  border-color: transparent !important;
  border-left-color: var(--g-accent) !important;
  box-shadow: inset 0 0 0 1px var(--g-accent) !important;
  color: var(--g-ink) !important;
}

.run-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #67c23a;
  flex-shrink: 0;
  margin-left: 6px;
  box-shadow: 0 0 0 2px rgba(103, 194, 58, 0.2);
}

:deep(.el-sub-menu.is-drop-target > .el-sub-menu__title) {
  background: var(--el-color-primary-light-9) !important;
  outline: 2px dashed var(--el-color-primary);
  outline-offset: -2px;
  border-radius: 4px;
}

/* 让标题行内 data-drop-group 区域尽量铺满 */
:deep(.el-sub-menu__title) {
  .group-title-row {
    flex: 1;
    min-width: 0;
  }
}

.create-btn {
  border-style: dashed !important;
}

.host-count {
  margin-top: 6px;
  text-align: center;
  font-size: 11px;
  color: #909399;
}

.drag-hint {
  margin-top: 4px;
  text-align: center;
  font-size: 10px;
  color: #c0c4cc;
}

.edit-host-hint {
  margin: 0 0 12px;
  font-size: 12px;
  line-height: 1.5;
  color: var(--el-text-color-secondary);
}
.edit-host-hint code {
  padding: 0 4px;
  border-radius: 3px;
  background: var(--el-fill-color);
  font-size: 11px;
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
    transition: background 0.15s ease;
  }

  &:hover::after,
  .is-resizing &::after {
    background: var(--el-color-primary);
    opacity: 0.45;
  }
}
</style>

<style>
/* 幽灵 / 右键菜单挂 body，非 scoped */
.host-drag-ghost {
  position: fixed;
  z-index: 99999;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border-radius: 6px;
  background: #fff;
  color: #303133;
  font-size: 13px;
  font-weight: 500;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.18);
  border: 1px solid var(--el-color-primary, #005eeb);
  pointer-events: none;
  max-width: 240px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
html.dark .host-drag-ghost {
  background: #2e313d;
  color: #e5eaf3;
}

.host-ctx-backdrop {
  position: fixed;
  inset: 0;
  z-index: 100000;
}

.host-ctx-menu {
  position: fixed;
  z-index: 100001;
  min-width: 156px;
  padding: 4px;
  border-radius: 8px;
  background: var(--el-bg-color-overlay, #fff);
  border: 1px solid var(--el-border-color-light, #e4e7ed);
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.12);
  font-size: 13px;
  color: var(--el-text-color-primary, #303133);
  user-select: none;
}

.host-ctx-menu .ctx-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  margin: 0;
  padding: 7px 12px;
  border: none;
  border-radius: 5px;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
  box-sizing: border-box;
  white-space: nowrap;
}

.host-ctx-menu .ctx-item:hover,
.host-ctx-menu .ctx-item.is-current {
  background: var(--el-fill-color-light, #f5f7fa);
}

.host-ctx-menu .ctx-item.is-current {
  color: var(--el-color-primary, #005eeb);
}

.host-ctx-menu .ctx-item.is-danger {
  color: var(--el-color-danger, #f56c6c);
}

.host-ctx-menu .ctx-item.is-danger:hover {
  background: var(--el-color-danger-light-9, #fef0f0);
}

.host-ctx-menu .ctx-divider {
  height: 1px;
  margin: 4px 6px;
  background: var(--el-border-color-lighter, #ebeef5);
}

.host-ctx-menu .ctx-has-sub {
  position: relative;
}

.host-ctx-menu .ctx-arrow {
  margin-left: 16px;
  color: var(--el-text-color-secondary, #909399);
  font-size: 14px;
}

.host-ctx-menu .ctx-sub {
  position: absolute;
  left: calc(100% + 2px);
  top: -4px;
  min-width: 140px;
  max-height: 280px;
  overflow-y: auto;
  padding: 4px;
  border-radius: 8px;
  background: var(--el-bg-color-overlay, #fff);
  border: 1px solid var(--el-border-color-light, #e4e7ed);
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.12);
}

.host-ctx-menu .ctx-empty {
  padding: 8px 12px;
  font-size: 12px;
  color: var(--el-text-color-secondary, #909399);
}

html.dark .host-ctx-menu,
html.dark .host-ctx-menu .ctx-sub {
  background: #2e313d;
  border-color: #414243;
  color: #e5eaf3;
}

html.dark .host-ctx-menu .ctx-item:hover,
html.dark .host-ctx-menu .ctx-item.is-current {
  background: #3a3d4a;
}
</style>
