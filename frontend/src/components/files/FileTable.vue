<template>
  <div class="file-table-wrap">
    <el-table
      class="file-table"
      :data="rows"
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
              @click="onPreview(row)"
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
</template>

<script setup lang="ts">
/** 文件列表表格：纯展示，交互通过事件回抛给 FilesView。 */
import FileFolderIcon from "@/components/FileFolderIcon.vue";
import type { FileEntry } from "@/composables/useFileNavigation";
import { formatBytes, modeToOctal } from "@/utils/format";

type SortPayload = { prop: string; order: "" | "ascending" | "descending" };

defineProps<{ rows: FileEntry[] }>();

const emit = defineEmits<{
  open: [row: FileEntry];
  preview: [row: FileEntry];
  "selection-change": [rows: FileEntry[]];
  "sort-change": [payload: SortPayload];
}>();

function onOpen(row: FileEntry | Record<string, unknown>) {
  emit("open", row as FileEntry);
}
function onPreview(row: FileEntry | Record<string, unknown>) {
  emit("preview", row as FileEntry);
}
function onSelectionChange(rows: FileEntry[]) {
  emit("selection-change", rows);
}
function onSortChange(data: {
  prop?: string | null;
  order?: "" | "ascending" | "descending" | null;
}) {
  emit("sort-change", {
    prop: data.prop || "",
    order: data.order || "",
  });
}
</script>

<style scoped lang="scss">
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
</style>
