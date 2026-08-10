<template>
  <aside
    class="panel-sidebar"
    :class="{ 'is-resizing': resizing }"
    :style="{ width: width + 'px' }"
  >
    <div class="logo">
      <LogoFull />
    </div>

    <div class="search-box">
      <el-input
        v-model="query"
        size="small"
        clearable
        placeholder="搜索主机..."
        :prefix-icon="Search"
      />
    </div>

    <div class="menu-wrap">
      <el-menu
        :default-active="activeId"
        :default-openeds="openedGroups"
        unique-opened
      >
        <el-sub-menu
          v-for="node in filtered"
          :key="node.group?.id || UNGROUPED_ID"
          :index="node.group?.id || UNGROUPED_ID"
        >
          <template #title>
            <el-icon><Folder /></el-icon>
            <span
              class="menu-title"
              @click.stop="
                openGroup(
                  node.group?.id || UNGROUPED_ID,
                  node.group?.name || '未分组'
                )
              "
            >
              {{ node.group?.name || "未分组" }}
            </span>
            <span class="menu-count">{{ node.hosts.length }}</span>
          </template>
          <el-menu-item
            v-for="h in node.hosts"
            :key="h.name"
            :index="h.name"
            @click="app.openHostTab(h.name)"
          >
            <el-icon><Monitor /></el-icon>
            <span class="menu-title">{{ h.name }}</span>
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
      <div class="host-count">共 {{ app.hosts.length }} 台主机</div>
    </div>

    <!-- 右边缘拖拽调宽 -->
    <div
      class="sidebar-resize-handle"
      title="拖动调整侧栏宽度"
      @pointerdown="onResizeStart"
    />
  </aside>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { Folder, Monitor, Plus, Search } from "@element-plus/icons-vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { useAppStore, UNGROUPED_ID } from "@/stores/app";
import LogoFull from "@/components/LogoFull.vue";

/** 1Panel 默认 180；别名过长或手动拖宽时上限 */
const SIDEBAR_MIN_WIDTH = 180;
const SIDEBAR_MAX_WIDTH = 320;
/** 主机行除文字外占用：左右 padding + 嵌套缩进 + icon + 间距 */
const HOST_ROW_CHROME = 80;
const STORAGE_KEY = "ipannel.sidebarWidth";

const app = useAppStore();
const query = ref("");
const resizing = ref(false);
const width = ref(loadStoredWidth());

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
    .filter((n) => n.hosts.length > 0);
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

/** 按主机别名 / 分组名测最长文字，算出需要的侧栏宽 */
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

/** 别名变长时只扩不缩；不超过 MAX */
function autoFitWidth() {
  if (app.hosts.length === 0 && app.groupNodes.length === 0) return;
  const needed = measureNeededWidth();
  if (needed > width.value) {
    width.value = needed;
    saveWidth(needed);
  }
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
  /* 宽度由 :style 控制；CSS 再兜一层 min/max */
  min-width: 180px;
  max-width: 320px;
  flex-shrink: 0;

  &.is-resizing {
    transition: none;
    user-select: none;
  }
}

.search-box {
  padding: 0 7px 4px;
}

.menu-title {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.menu-count {
  margin-left: 6px;
  font-size: 12px;
  color: #909399;
  flex-shrink: 0;
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
