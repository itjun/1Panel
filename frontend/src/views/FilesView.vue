<template>
  <EnlargableCard bare title="文件" class="files-enl">
  <div
    class="file-management-page"
    data-file-drop-target
    :class="{ 'is-dragover': dragOver }"
    @dragenter.prevent="onDragEnter"
    @dragover.prevent
    @dragleave.prevent="onDragLeave"
    @drop.prevent="onDropFallback"
  >
    <!-- 路径 Tab（1Panel 风格 card tabs） -->
    <el-tabs
      v-model="activeTabId"
      type="card"
      class="file-tabs"
      @tab-change="onTabChange"
      @tab-remove="removeTab"
    >
      <el-tab-pane
        v-for="t in pathTabs"
        :key="t.id"
        :name="t.id"
        :label="t.label"
        :closable="pathTabs.length > 1"
      />
      <el-tab-pane name="__add__" :closable="false" disabled>
        <template #label>
          <el-icon class="tab-add" @click.stop="addTab"><Plus /></el-icon>
        </template>
      </el-tab-pane>
    </el-tabs>

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
            <el-button :icon="Search" round @click="applyFilter" />
          </template>
        </el-input>
      </div>
    </div>

    <!-- 主内容白底卡片 -->
    <div class="file-layout" v-loading="loading">
      <el-alert type="info" :closable="false" class="file-helper" show-icon>
        <template #title>
          <span class="helper-text"
            >注意：1. 搜索结果不支持排序功能 2. 文件夹无法按大小排序。</span
          >
        </template>
      </el-alert>

      <!-- 工具栏：上下两行清晰分区，避免右侧按钮与表格 fixed 列叠在一起 -->
      <div class="file-toolbar">
        <div class="file-toolbar__row">
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
import { computed, ref, watch } from "vue";
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
import UploadProgressDialog from "@/components/files/UploadProgressDialog.vue";
import {
  useFileNavigation,
  type FileEntry,
} from "@/composables/useFileNavigation";
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
/* bare 放大包装层：占满 content-pad--fill 给的剩余空间 */
.files-enl {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.file-management-page {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  gap: 0;
  background: transparent;
  position: relative; /* 拖拽遮罩 absolute 定位基准 */
}

/* ---- 拖拽上传遮罩 ---- */
/* Wails v3 拖过 data-file-drop-target 时会加 file-drop-target-active */
.drop-overlay {
  position: absolute;
  inset: 0;
  z-index: 100;
  display: none;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  background: rgba(0, 94, 235, 0.12);
  border: 2px dashed var(--el-color-primary);
  border-radius: 6px;
  pointer-events: none;
}
.file-management-page.is-dragover .drop-overlay,
.file-management-page.file-drop-target-active .drop-overlay {
  display: flex;
}
.drop-icon {
  font-size: 56px;
  color: var(--el-color-primary);
}
.drop-text {
  font-size: 16px;
  font-weight: 600;
  color: var(--el-color-primary);
}
.drop-cwd {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  font-family: ui-monospace, SFMono-Regular, monospace;
}

/* ---- path tabs ---- */
.file-tabs {
  flex-shrink: 0;
  :deep(.el-tabs__header) {
    margin: 0 0 8px;
  }
  :deep(.el-tabs__nav) {
    border: none !important;
  }
  :deep(.el-tabs__item) {
    height: 32px;
    line-height: 32px;
    padding: 0 14px !important;
    border: 1px solid var(--el-border-color-light) !important;
    border-bottom: none !important;
    background: var(--el-fill-color-blank);
    color: var(--el-text-color-regular);
  }
  :deep(.el-tabs__item.is-active) {
    color: var(--el-color-primary);
    background: #fff;
    border-bottom-color: #fff !important;
  }
  :deep(.el-tabs__content) {
    display: none;
  }
}
.tab-add {
  cursor: pointer;
  vertical-align: middle;
  &:hover {
    color: var(--el-color-primary);
  }
}

/* ---- navigation row ---- */
.file-nav {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  padding: 2px 0 10px;
  flex-shrink: 0;
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
.file-nav__path {
  flex: 1 1 280px;
  min-width: 180px;
}
.file-nav__search {
  flex: 0 1 360px;
  min-width: 240px;
  max-width: 420px;
  :deep(.el-input-group__prepend) {
    padding: 0 10px;
    background: var(--el-fill-color-blank);
  }
}

.address-bar {
  display: flex;
  align-items: center;
  gap: 2px;
  min-height: 32px;
  padding: 4px 10px;
  overflow: hidden;
  cursor: text;
  background-color: var(--el-fill-color-lighter);
  border: 1px solid var(--el-border-color-light);
  border-radius: 6px;
  transition: border-color 0.2s, box-shadow 0.2s;
  white-space: nowrap;

  &:hover {
    border-color: var(--el-color-primary-light-5);
    box-shadow: 0 0 0 2px var(--el-color-primary-light-9);
  }

  .arrow {
    margin: 0 2px;
    color: var(--el-text-color-placeholder);
    font-size: 12px;
  }
  .root-label {
    margin-left: 4px;
    color: var(--el-text-color-secondary);
    font-size: 13px;
  }
}
.breadcrumb-root {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 24px;
  color: var(--el-text-color-secondary);
  cursor: pointer;
  &:hover {
    color: var(--el-color-primary);
  }
}
.path-segment {
  font-size: 13px;
  max-width: 160px;
  overflow: hidden;
  text-overflow: ellipsis;
}
.address-input {
  width: 100%;
}

/* ---- main layout card ---- */
.file-layout {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: #fff;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 4px;
  padding: 12px 14px 8px;
  box-sizing: border-box;
}
html.dark .file-layout {
  background: var(--panel-main-bg-color-9, #2e313d);
}

.file-helper {
  margin-bottom: 10px;
  flex-shrink: 0;
  :deep(.el-alert__title) {
    font-size: 12px;
    line-height: 1.5;
  }
}
.helper-text {
  color: var(--el-text-color-regular);
}

.file-toolbar {
  flex-shrink: 0;
  margin-bottom: 10px;
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
  gap: 8px;
  flex: 0 0 auto;
  margin-left: auto;
}
.file-utility-group {
  :deep(.el-button) {
    --el-button-bg-color: var(--el-fill-color-blank);
  }
}
.mount-btn {
  max-width: 160px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.file-pagination {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding-top: 8px;
  flex-shrink: 0;
  border-top: 1px solid var(--el-border-color-lighter);
  margin-top: 4px;
}
.file-pagination__left {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.summary {
  font-size: 12px;
  color: var(--el-text-color-secondary);
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
