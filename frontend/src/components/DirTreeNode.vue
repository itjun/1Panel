<template>
  <div>
    <div
      class="tree-row"
      :class="{ active: cwd === node.path }"
      :style="{ paddingLeft: depth * 12 + 6 + 'px' }"
      @click="onClick"
    >
      <span class="chev" :class="{ open: isExpanded }">▸</span>
      <span class="folder">📁</span>
      <span class="label">{{ node.name }}</span>
    </div>
    <template v-if="isExpanded">
      <div
        v-if="node.loading"
        class="tree-hint"
        :style="{ paddingLeft: (depth + 1) * 12 + 6 + 'px' }"
      >
        加载中...
      </div>
      <DirTreeNode
        v-for="child in node.children"
        :key="child.path"
        :node="child"
        :depth="depth + 1"
        :expanded="expanded"
        :cwd="cwd"
        @toggle="(p) => $emit('toggle', p)"
        @select="(p) => $emit('select', p)"
      />
      <div
        v-if="!node.loading && node.loaded && node.children.length === 0"
        class="tree-hint"
        :style="{ paddingLeft: (depth + 1) * 12 + 20 + 'px' }"
      >
        （空）
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";

export interface TreeNode {
  path: string;
  name: string;
  loaded: boolean;
  loading: boolean;
  children: TreeNode[];
}

const props = defineProps<{
  node: TreeNode;
  depth: number;
  expanded: Set<string>;
  cwd: string;
}>();

const emit = defineEmits<{
  toggle: [path: string];
  select: [path: string];
}>();

const isExpanded = computed(() => props.expanded.has(props.node.path));

function onClick() {
  emit("toggle", props.node.path);
  emit("select", props.node.path);
}
</script>

<style scoped>
.tree-row {
  display: flex;
  align-items: center;
  gap: 4px;
  height: 26px;
  padding-right: 6px;
  font-size: 12px;
  cursor: pointer;
  border-radius: 4px;
  margin: 1px 4px;
}
.tree-row:hover {
  background: var(--el-fill-color-light);
}
.tree-row.active {
  background: var(--el-color-primary-light-9, rgba(0, 94, 235, 0.1));
  color: var(--el-color-primary);
  font-weight: 600;
}
.chev {
  display: inline-block;
  width: 12px;
  color: var(--el-text-color-secondary);
  transition: transform 0.12s;
}
.chev.open {
  transform: rotate(90deg);
}
.label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tree-hint {
  font-size: 11px;
  color: var(--el-text-color-secondary);
  padding: 2px 0;
}
</style>
