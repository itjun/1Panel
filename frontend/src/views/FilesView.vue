<template>
  <EnlargableCard bare title="文件" class="files-enl">
  <div
    class="file-management-page page-panel"
    data-file-drop-target
    :class="{ 'is-dragover': dragOver }"
    @dragenter.prevent="onDragEnter"
    @dragover.prevent
    @dragleave.prevent="onDragLeave"
    @drop.prevent="onDropFallback"
  >
    <!-- 路径 Tab：序号 + 可拖排序；+ 钉右侧，栏满时点 + 提示 -->
    <div ref="fileTabsBarRef" class="file-path-tabs-bar">
      <el-tabs
        v-model="activeTabId"
        class="file-path-tabs"
        :class="{ 'is-reordering': !!tabDraggingId }"
        @tab-change="onTabChange"
        @tab-remove="requestCloseTab"
        @pointerdown="onTabPointerDown"
        @click.capture="onTabClickCapture"
      >
        <el-tab-pane
          v-for="(t, idx) in pathTabs"
          :key="t.id"
          :name="t.id"
          :closable="pathTabs.length > 1"
        >
          <template #label>
            <span
              class="file-tab-label"
              :class="{ 'is-dragging': tabDraggingId === t.id }"
              :data-tab-id="t.id"
              :title="t.path"
            >
              <span class="file-tab-idx">{{ idx + 1 }}</span>
              {{ t.label }}
            </span>
          </template>
        </el-tab-pane>
      </el-tabs>
      <button
        type="button"
        class="tab-add-btn"
        v-tip="'新开路径标签'"
        @click="requestAddTab"
      >
        <el-icon :size="16"><Plus /></el-icon>
      </button>
    </div>

    <!-- 导航 + 地址栏 + 搜索 -->
    <div class="file-nav">
      <div class="file-nav__actions">
        <el-tooltip content="后退" placement="top">
          <el-button :icon="Back" circle :disabled="!canBack" @click="goBack" />
        </el-tooltip>
        <el-tooltip content="前进" placement="top">
          <el-button :icon="Right" circle :disabled="!canForward" @click="goForward" />
        </el-tooltip>
        <el-tooltip content="上级" placement="top">
          <el-button
            :icon="Top"
            circle
            :disabled="cwd === '/'"
            @click="jump(parentDir(cwd))"
          />
        </el-tooltip>
        <el-tooltip content="刷新" placement="top">
          <el-button :icon="Refresh" circle :loading="loading" @click="reload" />
        </el-tooltip>
      </div>

      <div class="file-nav__path">
        <div v-show="!addressEditing" class="address-bar" @click="startAddressEdit">
          <span class="breadcrumb-root" @click.stop="jump('/')">
            <el-icon :size="18"><HomeFilled /></el-icon>
          </span>
          <template v-for="(seg, i) in pathSegments" :key="seg.url">
            <span class="arrow">></span>
            <el-link
              class="path-segment"
              :underline="false"
              type="primary"
              @click.stop="jump(seg.url)"
            >
              {{ i === pathSegments.length - 1 ? seg.name : truncate(seg.name, 18) }}
            </el-link>
          </template>
          <span v-if="pathSegments.length === 0" class="root-label">根目录</span>
        </div>
        <el-input
          v-show="addressEditing"
          ref="addressInputRef"
          v-model="addressDraft"
          class="address-input"
          @blur="commitAddress"
          @keyup.enter="commitAddress"
        />
      </div>

      <div class="file-nav__search">
        <el-input
          v-model="searchText"
          clearable
          placeholder="在当前目录下查找"
          @clear="applyFilter"
          @keyup.enter="applyFilter"
        >
          <template #prepend>
            <el-checkbox v-model="containSub" disabled>子目录</el-checkbox>
          </template>
          <template #append>
            <el-button :icon="Search" @click="applyFilter" />
          </template>
        </el-input>
      </div>
    </div>

    <!-- 工具栏 + 表格 + 分页 -->
    <div class="file-body">
      <PageSkeleton v-if="loading && !entries.length" variant="files" />
      <template v-else>
      <p class="file-hint">注意：1. 搜索结果不支持排序功能 2. 文件夹无法按大小排序。</p>

      <div class="file-toolbar">
        <div class="file-toolbar__row file-toolbar__row--primary">
          <div class="file-toolbar__left">
            <el-dropdown>
              <el-button type="primary">
                创建
                <el-icon class="el-icon--right"><ArrowDown /></el-icon>
              </el-button>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item disabled>目录（后端未开放）</el-dropdown-item>
                  <el-dropdown-item disabled>文件（后端未开放）</el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>

            <el-dropdown>
              <el-button>
                上传/下载
                <el-icon class="el-icon--right"><ArrowDown /></el-icon>
              </el-button>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item @click="triggerUpload">
                    <el-icon><Upload /></el-icon>上传
                  </el-dropdown-item>
                  <el-dropdown-item disabled>
                    <el-icon><Download /></el-icon>远程下载
                  </el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>

            <el-button-group class="file-utility-group">
              <el-button disabled>回收站</el-button>
              <el-button @click="toTerminal">终端</el-button>
              <el-button disabled>收藏夹</el-button>
              <el-button disabled>文件工具</el-button>
              <el-button disabled>计算</el-button>
              <el-button class="mount-btn" @click="jump('/')">
                / (根目录)
              </el-button>
            </el-button-group>
          </div>

          <div class="file-toolbar__right">
            <el-button-group>
              <el-button plain :disabled="selects.length === 0">复制</el-button>
              <el-button plain :disabled="selects.length === 0">移动</el-button>
              <el-button plain :disabled="selects.length === 0">压缩</el-button>
              <el-button plain :disabled="selects.length === 0">权限</el-button>
              <el-button
                plain
                :disabled="selects.length === 0"
                @click="onDeleteSelected"
              >
                删除
              </el-button>
            </el-button-group>
          </div>
        </div>
      </div>

      <FileTable
        class="data-table-unified"
        :rows="pageRows"
        @open="onOpen"
        @preview="(row) => previewRef?.openFile(row)"
        @selection-change="onSelectionChange"
        @sort-change="onSortChange"
      />

      <div class="file-pagination">
        <div class="file-pagination__left">
          <span class="summary">
            共 {{ dirNum }} 个目录，{{ fileNum }} 个文件，当前目录大小
          </span>
          <el-button type="primary" link size="small" disabled>计算</el-button>
        </div>
        <el-pagination
          v-model:current-page="page"
          v-model:page-size="pageSize"
          :page-sizes="[50, 100, 200, 500]"
          layout="total, sizes, prev, pager, next, jumper"
          :total="filteredSorted.length"
          background
          small
        />
      </div>
      </template>
    </div>

    <FilePreviewDrawer ref="previewRef" :host="props.host" />

    <!-- 拖拽上传遮罩：HTML5 dragOver 或 Wails file-drop-target-active 任一即可显示 -->
    <div class="drop-overlay">
      <el-icon class="drop-icon"><UploadFilled /></el-icon>
      <div class="drop-text">松开以上传到当前目录</div>
      <div class="drop-cwd">{{ cwd }}</div>
    </div>

    <EncodeCheckDialog
      v-model="encodeVisible"
      :items="encodeItems"
      @cancel="cancelEncode"
      @upload-raw="uploadAllRaw"
      @upload-convert="uploadWithConvert"
    />

    <UploadProgressDialog
      :visible="uploading"
      :progress="uploadProg"
      :percent="uploadPercent"
    />
  </div>
  </EnlargableCard>
</template>

<script setup lang="ts">
/**
 * 文件管理页：组合导航（useFileNavigation）与上传（useFileUpload）逻辑，
 * 自身只保留过滤/排序/分页/选择/删除等表格层交互。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import {
  ArrowDown,
  Back,
  Download,
  HomeFilled,
  Plus,
  Refresh,
  Right,
  Search,
  Top,
  Upload,
  UploadFilled,
} from "@element-plus/icons-vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { api } from "@/api";
import EnlargableCard from "@/components/EnlargableCard.vue";
import EncodeCheckDialog from "@/components/files/EncodeCheckDialog.vue";
import FilePreviewDrawer from "@/components/files/FilePreviewDrawer.vue";
import FileTable from "@/components/files/FileTable.vue";
import PageSkeleton from "@/components/PageSkeleton.vue";
import UploadProgressDialog from "@/components/files/UploadProgressDialog.vue";
import {
  useFileNavigation,
  type FileEntry,
} from "@/composables/useFileNavigation";
import {
  TAB_BAR_FULL_MSG,
  tabBarIsFull,
  useTabReorder,
} from "@/composables/useTabStrip";
import { useFileUpload } from "@/composables/useFileUpload";
import { useAppStore } from "@/stores/app";
import { parentDir } from "@/utils/format";

const props = defineProps<{ host: string }>();
const app = useAppStore();

const searchText = ref("");
const containSub = ref(false);
const appliedSearch = ref("");
const selects = ref<FileEntry[]>([]);

const page = ref(1);
const pageSize = ref(100);
const sortProp = ref<string>("");
const sortOrder = ref<"" | "ascending" | "descending">("");

const previewRef = ref<InstanceType<typeof FilePreviewDrawer> | null>(null);

const {
  loading,
  entries,
  cwd,
  pathTabs,
  activeTabId,
  canBack,
  canForward,
  addressEditing,
  addressDraft,
  addressInputRef,
  pathSegments,
  jump,
  reload,
  goBack,
  goForward,
  startAddressEdit,
  commitAddress,
  addTab,
  removeTab,
  onTabChange,
} = useFileNavigation(() => props.host, {
  onLoaded: () => {
    page.value = 1;
  },
});

const fileTabsBarRef = ref<HTMLElement | null>(null);
const {
  draggingId: tabDraggingId,
  onPointerDown: onTabPointerDown,
  onClickCapture: onTabClickCapture,
} = useTabReorder(pathTabs, {
  listRef: fileTabsBarRef,
  itemSelector: ".el-tabs__item",
});

function requestAddTab() {
  const clip = fileTabsBarRef.value?.querySelector(
    ".el-tabs__nav-scroll"
  ) as HTMLElement | null;
  if (tabBarIsFull(clip, ".el-tabs__item", { firstGainsClose: true })) {
    ElMessage.warning(TAB_BAR_FULL_MSG);
    return;
  }
  addTab();
}

function fileTabTitle(id: string): string {
  const idx = pathTabs.value.findIndex((x) => x.id === id);
  const t = idx >= 0 ? pathTabs.value[idx] : null;
  if (!t) return id;
  return `${idx + 1} ${t.label}`;
}

function hasVisibleOverlay(): boolean {
  for (const el of document.querySelectorAll(".el-overlay")) {
    const s = getComputedStyle(el);
    if (s.display === "none" || s.visibility === "hidden") continue;
    return true;
  }
  return false;
}

function isThisFilesPageActive(): boolean {
  const v = app.activeTab;
  return v?.kind === "host" && v.id === props.host && v.subTab === "files";
}

async function requestCloseTab(name: string | number) {
  const id = String(name);
  if (id === "__add__") return;
  if (pathTabs.value.length <= 1) {
    ElMessage.info("至少保留一个标签");
    return;
  }
  const t = pathTabs.value.find((x) => x.id === id);
  if (!t) return;
  try {
    await ElMessageBox.confirm(
      `确定关闭「${fileTabTitle(id)}」吗？`,
      "关闭标签",
      { type: "warning", confirmButtonText: "关闭", cancelButtonText: "取消" }
    );
  } catch {
    return;
  }
  removeTab(id);
}

function onFilesKeydown(e: KeyboardEvent) {
  if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return;
  if (e.code !== "KeyW") return;
  if (!isThisFilesPageActive()) return;
  e.preventDefault();
  e.stopPropagation();
  if (hasVisibleOverlay()) return;
  void requestCloseTab(activeTabId.value);
}

onMounted(() => {
  window.addEventListener("keydown", onFilesKeydown, true);
});
onBeforeUnmount(() => {
  window.removeEventListener("keydown", onFilesKeydown, true);
});

const {
  dragOver,
  encodeVisible,
  encodeItems,
  uploading,
  uploadProg,
  uploadPercent,
  onDragEnter,
  onDragLeave,
  onDropFallback,
  cancelEncode,
  uploadAllRaw,
  uploadWithConvert,
  triggerUpload,
} = useFileUpload(() => props.host, cwd, reload);

// 切换主机时清空搜索与选择（目录/历史由 useFileNavigation 内部重置）
watch(
  () => props.host,
  () => {
    searchText.value = "";
    appliedSearch.value = "";
    selects.value = [];
  }
);

const dirNum = computed(() => entries.value.filter((e) => e.isDir).length);
const fileNum = computed(() => entries.value.filter((e) => !e.isDir).length);

const filteredSorted = computed(() => {
  let list = [...entries.value];
  const q = appliedSearch.value.trim().toLowerCase();
  if (q) list = list.filter((e) => e.name.toLowerCase().includes(q));

  const prop = sortProp.value;
  const order = sortOrder.value;
  if (prop && order) {
    const dir = order === "ascending" ? 1 : -1;
    list.sort((a, b) => {
      // 目录优先
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      let av: string | number = "";
      let bv: string | number = "";
      if (prop === "name") {
        av = a.name.toLowerCase();
        bv = b.name.toLowerCase();
      } else if (prop === "size") {
        av = a.size || 0;
        bv = b.size || 0;
      } else if (prop === "modTime") {
        av = a.modTime || "";
        bv = b.modTime || "";
      }
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return 0;
    });
  } else {
    list.sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
    });
  }
  return list;
});

const pageRows = computed(() => {
  const start = (page.value - 1) * pageSize.value;
  return filteredSorted.value.slice(start, start + pageSize.value);
});

function truncate(s: string, n: number) {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

function applyFilter() {
  appliedSearch.value = searchText.value;
  page.value = 1;
}

function onSortChange(p: { prop: string; order: "" | "ascending" | "descending" }) {
  sortProp.value = p.prop || "";
  sortOrder.value = p.order || "";
}

function onSelectionChange(rows: FileEntry[]) {
  selects.value = rows;
}

async function onDeleteSelected() {
  const rows = selects.value;
  if (!rows.length) return;
  const names = rows.map((r) => r.name).join("、");
  try {
    await ElMessageBox.confirm(
      `确认删除以下 ${rows.length} 项？此操作不可恢复：\n${names}`,
      "危险操作",
      { type: "warning", confirmButtonText: "删除", cancelButtonText: "取消" }
    );
  } catch {
    return;
  }
  try {
    await api.deletePaths(props.host, rows.map((r) => r.path));
    ElMessage.success(`已删除 ${rows.length} 项`);
    selects.value = [];
    reload();
  } catch (e) {
    ElMessage.error(`删除失败: ${e}`);
  }
}

function onOpen(row: FileEntry) {
  if (row.isDir) jump(row.path);
  else previewRef.value?.openFile(row);
}

function toTerminal() {
  if (!app.activeTabId) return;
  app.setSubTab(app.activeTabId, "terminal");
}
</script>

<style scoped lang="scss">
.files-enl {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.file-management-page.page-panel {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding: 0;
  overflow: hidden;
  position: relative;
}

.drop-overlay {
  position: absolute;
  inset: 0;
  z-index: 100;
  display: none;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  background: rgba(0, 94, 235, 0.08);
  border: 2px dashed var(--m3-primary);
  border-radius: var(--m3-shape-m);
  pointer-events: none;
}
.file-management-page.is-dragover .drop-overlay,
.file-management-page.file-drop-target-active .drop-overlay {
  display: flex;
}
.drop-icon {
  font-size: 56px;
  color: var(--m3-primary);
}
.drop-text {
  font-size: 16px;
  font-weight: 600;
  color: var(--m3-primary);
}
.drop-cwd {
  font-size: 12px;
  color: var(--m3-on-surface-variant);
  font-family: var(--m3-font-mono);
}

/* 路径 Tab：通栏内垂直居中，从左依次排列；+ 钉右侧不随标签挤出 */
.file-path-tabs-bar {
  display: flex;
  align-items: center;
  flex-shrink: 0;
  height: var(--m3-chrome-height);
  min-height: var(--m3-chrome-height);
  max-height: var(--m3-chrome-height);
  padding: 0 20px 0 16px;
  box-sizing: border-box;
  border-bottom: 1px solid var(--m3-outline-variant);
  user-select: none;
}
.file-path-tabs {
  flex: 1;
  min-width: 0;
  height: 100%;
  overflow: hidden;

  :deep(.el-tabs__header) {
    width: 100%;
    height: 100%;
    margin: 0;
  }
  :deep(.el-tabs__nav-wrap),
  :deep(.el-tabs__nav-scroll) {
    height: 100%;
  }
  :deep(.el-tabs__nav) {
    height: 100%;
    float: none;
    display: flex;
    align-items: center;
    justify-content: flex-start;
  }
  :deep(.el-tabs__nav-wrap::after) {
    display: none;
  }
  :deep(.el-tabs__active-bar) {
    height: 2px;
    background-color: var(--m3-primary);
  }
  :deep(.el-tabs__item) {
    height: 100%;
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    padding: 0 12px !important;
    border: none !important;
    background: transparent !important;
    color: var(--m3-on-surface-variant);
    font: var(--m3-title-small);
    font-weight: 500;
    cursor: grab;
  }
  &.is-reordering :deep(.el-tabs__item) {
    cursor: grabbing;
  }
  :deep(.el-tabs__item.is-active) {
    color: var(--m3-primary);
    font-weight: 600;
  }
  :deep(.el-tabs__content) {
    display: none;
  }
}
.file-tab-label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  &.is-dragging {
    opacity: 0.45;
  }
}
.file-tab-idx {
  font-variant-numeric: tabular-nums;
  font-weight: 600;
  color: var(--m3-on-surface-variant);
}
:deep(.el-tabs__item.is-active) .file-tab-idx {
  color: var(--m3-primary);
}
.tab-add-btn {
  appearance: none;
  position: relative;
  z-index: 2;
  flex-shrink: 0;
  width: 32px;
  height: 32px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  margin-left: 8px;
  border: none;
  background: transparent;
  color: var(--m3-on-surface-variant);
  cursor: pointer;
  &:hover {
    color: var(--m3-primary);
  }
}

.file-nav {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  padding: 10px 16px;
  flex-shrink: 0;
  border-bottom: 1px solid var(--m3-outline-variant);
  background: var(--m3-surface-container-lowest);
  --file-nav-control-h: 36px;
}
.file-nav__actions {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  gap: 6px;
  :deep(.el-button + .el-button) {
    margin-left: 0;
  }
}

.file-nav__path,
.file-nav__search {
  display: flex;
  align-items: center;
}

.file-nav__path {
  flex: 1 1 280px;
  min-width: 180px;
}

.file-nav__search {
  flex: 0 1 360px;
  min-width: 240px;
  max-width: 420px;
  width: 100%;
}

/* 路径框 / 搜索框：统一高度、描边、圆角、底色 */
.address-bar,
.file-nav__path :deep(.address-input .el-input__wrapper),
.file-nav__search :deep(.el-input-group) {
  height: var(--file-nav-control-h);
  min-height: var(--file-nav-control-h);
  box-sizing: border-box;
  background: var(--m3-surface-container);
  border: 1px solid var(--m3-outline-variant);
  border-radius: var(--m3-shape-s);
  box-shadow: none !important;
}

.address-bar {
  display: flex;
  align-items: center;
  gap: 4px;
  width: 100%;
  padding: 0 12px;
  overflow: hidden;
  cursor: text;
  white-space: nowrap;

  &:hover {
    border-color: var(--m3-outline);
    background: color-mix(in srgb, var(--m3-primary) 4%, var(--m3-surface-container));
  }

  .arrow {
    margin: 0 2px;
    color: var(--m3-on-surface-variant);
    font-size: 12px;
  }
  .root-label {
    margin-left: 4px;
    color: var(--m3-on-surface-variant);
    font: var(--m3-body-small);
  }
}

.file-nav__path :deep(.address-input) {
  width: 100%;

  .el-input__wrapper {
    padding: 0 12px;
  }
}

.file-nav__search :deep(.el-input-group) {
  display: flex;
  align-items: stretch;
  width: 100%;
  overflow: hidden;
}

.file-nav__search :deep(.el-input-group__prepend),
.file-nav__search :deep(.el-input-group__append) {
  display: inline-flex;
  align-items: center;
  background: var(--m3-surface-container-high);
  border: none;
  box-shadow: none;
  padding: 0 10px;
  color: var(--m3-on-surface-variant);
}

.file-nav__search :deep(.el-input-group__prepend .el-checkbox) {
  height: auto;
  --el-checkbox-font-size: 12px;
}

.file-nav__search :deep(.el-input__wrapper) {
  flex: 1;
  height: 100%;
  min-height: 0;
  border: none;
  border-radius: 0;
  background: transparent !important;
  box-shadow: none !important;
  padding: 0 8px;
}

.file-nav__search :deep(.el-input-group__append .el-button) {
  height: 100%;
  margin: 0;
  padding: 0 12px;
  border: none;
  border-radius: 0;
  background: transparent;
  color: var(--m3-on-surface-variant);

  &:hover {
    color: var(--m3-primary);
    background: color-mix(in srgb, var(--m3-primary) 8%, transparent);
  }
}

.breadcrumb-root {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 24px;
  color: var(--m3-on-surface-variant);
  cursor: pointer;
  &:hover {
    color: var(--m3-primary);
  }
}
.path-segment {
  font: var(--m3-body-small);
  max-width: 160px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.address-input {
  width: 100%;
}

.file-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding: 0 16px 12px;
  box-sizing: border-box;
}

.file-hint {
  flex-shrink: 0;
  margin: 10px 0 8px;
  padding: 8px 12px;
  border-radius: var(--m3-shape-s);
  background: var(--m3-primary-container);
  color: var(--m3-on-primary-container);
  font: var(--m3-body-small);
}

.file-toolbar {
  flex-shrink: 0;
  margin-bottom: 8px;
}
.file-toolbar__row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px 12px;
  width: 100%;
}
.file-toolbar__left {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  min-width: 0;
  flex: 1 1 auto;
}
.file-toolbar__right {
  display: flex;
  flex-wrap: nowrap;
  align-items: center;
  flex: 0 0 auto;
  margin-left: auto;
}
.file-utility-group {
  :deep(.el-button) {
    --el-button-bg-color: var(--m3-surface-container-lowest);
  }
}
.mount-btn {
  max-width: 140px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.file-pagination {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding-top: 10px;
  flex-shrink: 0;
  border-top: 1px solid var(--m3-outline-variant);
  margin-top: 4px;
}
.file-pagination__left {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.summary {
  font: var(--m3-body-small);
  color: var(--m3-on-surface-variant);
}

@media (max-width: 1100px) {
  .file-toolbar__right {
    margin-left: 0;
    width: 100%;
    justify-content: flex-start;
  }
}
@media (max-width: 960px) {
  .file-nav {
    flex-direction: column;
    align-items: stretch;
  }
  .file-nav__search {
    max-width: none;
  }
}
</style>
