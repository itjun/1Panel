<template>
  <div class="file-management-page">
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
              <el-button plain :disabled="selects.length === 0">删除</el-button>
            </el-button-group>
          </div>
        </div>
      </div>

      <!-- 表格单独占满剩余高度；去掉 fixed 列，避免右侧白块/表头错位 -->
      <div class="file-table-wrap">
        <el-table
          ref="tableRef"
          class="file-table"
          :data="pageRows"
          height="100%"
          size="default"
          stripe
          highlight-current-row
          row-key="path"
          empty-text="空目录"
          table-layout="auto"
          @selection-change="onSelectionChange"
          @row-dblclick="onOpen"
          @sort-change="onSortChange"
        >
          <el-table-column type="selection" width="42" />
          <el-table-column
            label="名称"
            prop="name"
            min-width="200"
            sortable="custom"
            show-overflow-tooltip
          >
            <template #default="{ row }">
              <div class="file-row">
                <FileFolderIcon :is-dir="row.isDir" />
                <span class="table-link" @click="onOpen(row)">{{ row.name }}</span>
              </div>
            </template>
          </el-table-column>
          <el-table-column label="权限" prop="mode" width="80" align="center">
            <template #default="{ row }">
              <span class="mono">{{ modeToOctal(row.mode) || row.mode || "—" }}</span>
            </template>
          </el-table-column>
          <el-table-column
            label="用户 / 用户组"
            min-width="120"
            show-overflow-tooltip
          >
            <template #default="{ row }">
              <span class="owner">
                {{ row.owner || "-" }} / {{ row.group || "-" }}
              </span>
            </template>
          </el-table-column>
          <el-table-column
            label="大小"
            prop="size"
            width="100"
            align="right"
            sortable="custom"
          >
            <template #default="{ row }">
              <el-button
                v-if="row.isDir"
                type="primary"
                link
                size="small"
                disabled
              >
                计算
              </el-button>
              <el-button v-else type="primary" link size="small">
                {{ formatBytes(row.size || 0) }}
              </el-button>
            </template>
          </el-table-column>
          <el-table-column
            label="修改时间"
            prop="modTime"
            width="168"
            sortable="custom"
            show-overflow-tooltip
          />
          <el-table-column label="备注" width="72" align="center">
            <template #default>—</template>
          </el-table-column>
          <el-table-column label="操作" width="150" align="right">
            <template #default="{ row }">
              <div class="ops-cell">
                <el-button type="primary" link size="small" @click="onOpen(row)">
                  打开
                </el-button>
                <el-button
                  v-if="!row.isDir"
                  type="primary"
                  link
                  size="small"
                  @click="previewFile(row)"
                >
                  预览
                </el-button>
                <el-dropdown trigger="click">
                  <el-button type="primary" link size="small">更多</el-button>
                  <template #dropdown>
                    <el-dropdown-menu>
                      <el-dropdown-item disabled>下载</el-dropdown-item>
                      <el-dropdown-item disabled>重命名</el-dropdown-item>
                      <el-dropdown-item disabled>权限</el-dropdown-item>
                      <el-dropdown-item disabled divided>删除</el-dropdown-item>
                    </el-dropdown-menu>
                  </template>
                </el-dropdown>
              </div>
            </template>
          </el-table-column>
        </el-table>
      </div>

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

    <!-- 文本预览抽屉：行号 + 底部编码/换行符 + Linux 标准转换 -->
    <el-drawer
      v-model="previewOpen"
      :title="preview?.name || '预览'"
      size="50%"
      destroy-on-close
      class="preview-drawer"
    >
      <div v-loading="previewLoading || previewConverting" class="preview-shell">
        <el-alert
          v-if="previewNeedsNormalize"
          type="warning"
          :closable="false"
          show-icon
          class="preview-normalize-alert"
        >
          <template #title>
            <div class="normalize-alert-body">
              <span>
                当前不是 Linux 标准格式（期望
                <strong>UTF-8 + LF</strong>）：编码
                <strong>{{ previewEncoding }}</strong>，换行
                <strong>{{ previewLineEnding }}</strong>。
              </span>
              <el-button
                type="primary"
                size="small"
                :loading="previewConverting"
                @click="onNormalizeToLinux"
              >
                转换为 UTF-8 / LF
              </el-button>
            </div>
          </template>
        </el-alert>
        <div class="preview-code" role="region" aria-label="文件预览">
          <div
            v-for="(line, idx) in previewLines"
            :key="idx"
            class="preview-line"
          >
            <span class="line-no" aria-hidden="true">{{ idx + 1 }}</span>
            <span class="line-text">{{ line.length ? line : " " }}</span>
          </div>
          <div v-if="!previewLoading && previewLines.length === 0" class="preview-empty">
            (空文件)
          </div>
        </div>
        <div class="preview-status">
          <span class="status-left">{{ previewLineCountLabel }}</span>
          <span class="status-right">
            <span
              class="status-item"
              :class="{ 'is-warn': previewNeedsNormalize }"
              title="文件编码"
            >{{ previewEncoding }}</span>
            <span class="status-sep">|</span>
            <span
              class="status-item"
              :class="{ 'is-warn': previewNeedsNormalize }"
              title="换行符"
            >{{ previewLineEnding }}</span>
            <template v-if="previewNeedsNormalize">
              <span class="status-sep">|</span>
              <el-button
                link
                type="warning"
                size="small"
                :loading="previewConverting"
                @click="onNormalizeToLinux"
              >
                转 Linux 标准
              </el-button>
            </template>
          </span>
        </div>
      </div>
    </el-drawer>

    <input
      ref="fileInputRef"
      type="file"
      multiple
      class="hidden-input"
      @change="onFilePicked"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from "vue";
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
} from "@element-plus/icons-vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { api } from "@/api";
import type { filetext } from "@/api";
import FileFolderIcon from "@/components/FileFolderIcon.vue";
import { useAppStore } from "@/stores/app";
import {
  formatBytes,
  modeToOctal,
  parentDir,
  splitTextLines,
} from "@/utils/format";

interface FileEntry {
  name: string;
  path: string;
  isDir: boolean;
  size: number;
  mode: string;
  modTime: string;
  owner: string;
  group: string;
}

interface PathTab {
  id: string;
  label: string;
  path: string;
}

interface PathSeg {
  name: string;
  url: string;
}

const props = defineProps<{ host: string }>();
const app = useAppStore();

const loading = ref(false);
const error = ref<string | null>(null);
const entries = ref<FileEntry[]>([]);
const cwd = ref("/");
const searchText = ref("");
const containSub = ref(false);
const appliedSearch = ref("");
const selects = ref<FileEntry[]>([]);

/** 当前主机用户家目录（默认入口）；解析失败前先占位 /root */
const homeDir = ref("/root");

const pathTabs = ref<PathTab[]>([
  { id: "tab-home", label: "home", path: "/root" },
]);
const activeTabId = ref("tab-home");
let tabSeq = 1;

const backStack = ref<string[]>([]);
const forwardStack = ref<string[]>([]);
const canBack = computed(() => backStack.value.length > 0);
const canForward = computed(() => forwardStack.value.length > 0);

const addressEditing = ref(false);
const addressDraft = ref("");
const addressInputRef = ref<{ focus: () => void } | null>(null);

const page = ref(1);
const pageSize = ref(100);
const sortProp = ref<string>("");
const sortOrder = ref<"" | "ascending" | "descending">("");

const previewOpen = ref(false);
const preview = ref<filetext.Preview | null>(null);
const previewPath = ref("");
const previewLoading = ref(false);
const previewConverting = ref(false);
const fileInputRef = ref<HTMLInputElement | null>(null);

const previewLines = computed(() => {
  if (!preview.value) return [];
  return splitTextLines(preview.value.content ?? "");
});
const previewEncoding = computed(() => preview.value?.encoding || "—");
const previewLineEnding = computed(() => preview.value?.lineEnding || "—");
const previewNeedsNormalize = computed(
  () => !!preview.value?.needsNormalize && !!previewPath.value
);
const previewLineCountLabel = computed(() => {
  const n = previewLines.value.length;
  if (!preview.value) return "";
  return `${n} 行`;
});

const pathSegments = computed((): PathSeg[] => {
  if (!cwd.value || cwd.value === "/") return [];
  const parts = cwd.value.split("/").filter(Boolean);
  const segs: PathSeg[] = [];
  let acc = "";
  for (const p of parts) {
    acc += "/" + p;
    segs.push({ name: p, url: acc });
  }
  return segs;
});

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

function tabLabelFromPath(p: string): string {
  if (!p || p === "/") return "根目录";
  if (p === homeDir.value) {
    // 家目录：显示末级目录名（如 root / debian）
    const parts = p.split("/").filter(Boolean);
    return parts[parts.length - 1] || "home";
  }
  const parts = p.split("/").filter(Boolean);
  return parts[parts.length - 1] || p;
}

function syncTabLabel() {
  const t = pathTabs.value.find((x) => x.id === activeTabId.value);
  if (!t) return;
  t.path = cwd.value;
  t.label = tabLabelFromPath(cwd.value);
}

async function load(dir: string, opts?: { pushHistory?: boolean }) {
  const pushHistory = opts?.pushHistory !== false;
  if (pushHistory && dir !== cwd.value) {
    backStack.value = [...backStack.value, cwd.value];
    forwardStack.value = [];
  }
  loading.value = true;
  error.value = null;
  try {
    const list = (await api.listDir(props.host, dir)) as FileEntry[];
    entries.value = list || [];
    cwd.value = dir;
    page.value = 1;
    syncTabLabel();
  } catch (e) {
    error.value = String(e);
    entries.value = [];
    ElMessage.error(`加载失败: ${e}`);
  } finally {
    loading.value = false;
  }
}

function jump(dir: string) {
  void load(dir);
}

function reload() {
  void load(cwd.value, { pushHistory: false });
}

function goBack() {
  if (!canBack.value) return;
  const prev = backStack.value[backStack.value.length - 1];
  backStack.value = backStack.value.slice(0, -1);
  forwardStack.value = [cwd.value, ...forwardStack.value];
  void load(prev, { pushHistory: false });
}

function goForward() {
  if (!canForward.value) return;
  const next = forwardStack.value[0];
  forwardStack.value = forwardStack.value.slice(1);
  backStack.value = [...backStack.value, cwd.value];
  void load(next, { pushHistory: false });
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

function onOpen(row: FileEntry) {
  if (row.isDir) jump(row.path);
  else void previewFile(row);
}

async function previewFile(row: FileEntry) {
  previewOpen.value = true;
  previewPath.value = row.path;
  preview.value = {
    path: row.path,
    name: row.name,
    content: "",
    encoding: "—",
    lineEnding: "—",
    needsNormalize: false,
    size: 0,
  } as filetext.Preview;
  previewLoading.value = true;
  try {
    const p = await api.readFilePreview(props.host, row.path);
    preview.value = p;
    previewPath.value = p.path || row.path;
  } catch (e) {
    preview.value = {
      path: row.path,
      name: row.name,
      content: `读取失败: ${e}`,
      encoding: "—",
      lineEnding: "—",
      needsNormalize: false,
      size: 0,
    } as filetext.Preview;
  } finally {
    previewLoading.value = false;
  }
}

async function onNormalizeToLinux() {
  if (!previewPath.value || previewConverting.value) return;
  try {
    await ElMessageBox.confirm(
      `将把远程文件转换为 UTF-8 编码 + LF 换行（Linux 标准）。\n写前会备份为「原文件名.bak.时间戳」。\n\n${previewPath.value}`,
      "转换为 Linux 标准格式",
      {
        type: "warning",
        confirmButtonText: "转换并保存",
        cancelButtonText: "取消",
      }
    );
  } catch {
    return;
  }
  previewConverting.value = true;
  try {
    const p = await api.normalizeFileToLinux(props.host, previewPath.value);
    preview.value = p;
    previewPath.value = p.path || previewPath.value;
    ElMessage.success("已转换为 UTF-8 / LF，原文件已备份");
  } catch (e) {
    ElMessage.error(`转换失败: ${e}`);
  } finally {
    previewConverting.value = false;
  }
}

function startAddressEdit() {
  addressEditing.value = true;
  addressDraft.value = cwd.value;
  nextTick(() => addressInputRef.value?.focus?.());
}

function commitAddress() {
  addressEditing.value = false;
  const p = (addressDraft.value || "/").trim() || "/";
  if (p !== cwd.value) jump(p.startsWith("/") ? p : "/" + p);
}

function addTab() {
  if (pathTabs.value.length >= 8) {
    ElMessage.warning("最多 8 个路径标签");
    return;
  }
  const id = `tab-${++tabSeq}`;
  const start = homeDir.value || "/";
  pathTabs.value.push({ id, label: tabLabelFromPath(start), path: start });
  activeTabId.value = id;
  backStack.value = [];
  forwardStack.value = [];
  void load(start, { pushHistory: false });
}

function removeTab(name: string | number) {
  const id = String(name);
  if (id === "__add__") return;
  if (pathTabs.value.length <= 1) return;
  const idx = pathTabs.value.findIndex((t) => t.id === id);
  if (idx < 0) return;
  pathTabs.value.splice(idx, 1);
  if (activeTabId.value === id) {
    const next = pathTabs.value[Math.max(0, idx - 1)];
    activeTabId.value = next.id;
    void load(next.path, { pushHistory: false });
  }
}

function onTabChange(name: string | number) {
  const id = String(name);
  if (id === "__add__") {
    activeTabId.value = pathTabs.value[0]?.id || "tab-home";
    return;
  }
  const t = pathTabs.value.find((x) => x.id === id);
  if (!t) return;
  backStack.value = [];
  forwardStack.value = [];
  void load(t.path, { pushHistory: false });
}

function toTerminal() {
  if (!app.activeTabId) return;
  app.setSubTab(app.activeTabId, "terminal");
}

function triggerUpload() {
  fileInputRef.value?.click();
}

async function onFilePicked(ev: Event) {
  const input = ev.target as HTMLInputElement;
  const files = input.files;
  if (!files?.length) return;
  // Wails 桌面端通常需要本地绝对路径；浏览器 file input 只有 blob。
  // 若环境支持 path 属性（Electron/Wails 扩展），则上传。
  let uploaded = 0;
  for (const f of Array.from(files)) {
    const any = f as File & { path?: string };
    if (!any.path) {
      ElMessage.warning("当前环境无法读取本地路径，请使用拖拽上传（桌面端）");
      break;
    }
    try {
      await api.uploadFile(props.host, any.path, cwd.value);
      uploaded++;
    } catch (e) {
      ElMessage.error(`上传失败 ${f.name}: ${e}`);
    }
  }
  if (uploaded) {
    ElMessage.success(`已上传 ${uploaded} 个文件`);
    reload();
  }
  input.value = "";
}

async function resolveHomeDir(): Promise<string> {
  try {
    const h = await api.getHomeDir(props.host);
    const cleaned = (h || "").trim().replace(/\/+$/, "") || "/root";
    return cleaned.startsWith("/") ? cleaned : `/${cleaned}`;
  } catch {
    // 后端不可用时按侧栏主机 User 猜测
    const host = app.hosts.find((x) => x.name === props.host);
    const u = (host?.user || "root").trim();
    return u === "root" || !u ? "/root" : `/home/${u}`;
  }
}

async function resetHost() {
  tabSeq = 1;
  backStack.value = [];
  forwardStack.value = [];
  searchText.value = "";
  appliedSearch.value = "";
  selects.value = [];

  const home = await resolveHomeDir();
  homeDir.value = home;
  pathTabs.value = [
    { id: "tab-home", label: tabLabelFromPath(home), path: home },
  ];
  activeTabId.value = "tab-home";
  await load(home, { pushHistory: false });
}

watch(() => props.host, () => {
  void resetHost();
});
onMounted(() => {
  void resetHost();
});
</script>

<style scoped lang="scss">
.file-management-page {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  gap: 0;
  background: transparent;
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

/* 表格容器占满剩余高度，避免 height:100% + fixed 列把右侧表头顶飞 */
.file-table-wrap {
  flex: 1 1 auto;
  min-height: 0;
  width: 100%;
  overflow: hidden;
  position: relative;
}
.file-table {
  width: 100%;
  height: 100%;
  :deep(.el-table__inner-wrapper),
  :deep(.el-table__body-wrapper) {
    /* 确保横向滚动在表体内部，不挤乱整页 */
  }
  :deep(.el-table__header th.el-table__cell) {
    background: var(--el-fill-color-blank);
  }
  :deep(.el-table__row) {
    cursor: default;
  }
  :deep(.el-table__row:hover > td.el-table__cell) {
    background-color: var(--el-fill-color-light);
  }
  :deep(.el-table__cell) {
    padding-top: 6px;
    padding-bottom: 6px;
  }
}

.file-row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 24px;
  min-width: 0;
}
.ops-cell {
  display: inline-flex;
  align-items: center;
  justify-content: flex-end;
  flex-wrap: nowrap;
  gap: 2px;
  white-space: nowrap;
}
.table-link {
  color: var(--el-text-color-primary);
  cursor: pointer;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  &:hover {
    color: var(--el-color-primary);
  }
}
.mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, monospace;
  font-size: 12px;
  color: var(--el-text-color-regular);
}
.owner {
  font-size: 13px;
  color: var(--el-text-color-regular);
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

/* 预览：行号 + 底部状态栏 */
.preview-shell {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  border-radius: 6px;
  overflow: hidden;
  background: #0d0d0d;
  color: #e4e4e7;
}
.preview-code {
  flex: 1;
  min-height: 0;
  overflow: auto;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, monospace;
  font-size: 12px;
  line-height: 1.55;
  padding: 8px 0;
}
.preview-line {
  display: flex;
  align-items: flex-start;
  min-height: 1.55em;
  padding: 0;
}
.preview-line:hover {
  background: rgba(255, 255, 255, 0.04);
}
.line-no {
  flex: 0 0 52px;
  width: 52px;
  padding: 0 10px 0 8px;
  text-align: right;
  color: #6b7280;
  user-select: none;
  border-right: 1px solid #2a2a2a;
}
.line-text {
  flex: 1;
  min-width: 0;
  padding: 0 12px 0 12px;
  white-space: pre-wrap;
  word-break: break-all;
  color: #e4e4e7;
}
.preview-empty {
  padding: 24px;
  text-align: center;
  color: #9ca3af;
  font-size: 12px;
}
.preview-normalize-alert {
  flex-shrink: 0;
  margin-bottom: 8px;
}
.normalize-alert-body {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  width: 100%;
  font-size: 12px;
  line-height: 1.5;
}
.preview-status {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 28px;
  padding: 4px 12px;
  font-size: 11px;
  color: #9ca3af;
  background: #161616;
  border-top: 1px solid #2a2a2a;
}
.status-left {
  min-width: 0;
}
.status-right {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin-left: auto;
  font-variant-numeric: tabular-nums;
}
.status-item {
  color: #d1d5db;
  &.is-warn {
    color: #fbbf24;
    font-weight: 600;
  }
}
.status-sep {
  color: #4b5563;
}

/* drawer body 撑满以便预览区占高 */
:deep(.preview-drawer .el-drawer__body) {
  display: flex;
  flex-direction: column;
  padding: 12px 16px 16px;
  overflow: hidden;
}

.hidden-input {
  display: none;
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
