<template>
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
      <button
        type="button"
        class="ctx-item"
        :disabled="!menu.cmd"
        @click="emit('copy')"
      >
        {{ menu.copyLabel }}
      </button>
      <div class="ctx-divider" />
      <button type="button" class="ctx-item is-danger" @click="emit('kill', false)">
        结束进程 (TERM)
      </button>
      <button type="button" class="ctx-item is-danger" @click="emit('kill', true)">
        强制结束 (KILL)
      </button>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
/**
 * 进程表格行右键菜单：原「操作」列的能力迁到这里（复制命令 / 结束 / 强制结束）。
 * 动作逻辑由父组件处理（复用其 copyCmd / kill），本组件只负责弹出与定位。
 * 样式复用 HostContextMenu 的 .host-ctx-menu（挂 body）。
 */
import { nextTick, reactive, ref, watch } from "vue";
import { clampContextMenuPos } from "@/utils/contextMenuPos";

export interface ProcCtxMenuState {
  x: number;
  y: number;
  /** 目标进程 PID（结束进程用） */
  pid: number;
  /** 展示用命令文本（空则复制项禁用） */
  cmd: string;
  /** 复制项文案：全部进程视图叫「复制启动命令」，运行时视图叫「复制命令行」 */
  copyLabel: string;
}

const props = defineProps<{ menu: ProcCtxMenuState | null }>();

const emit = defineEmits<{
  close: [];
  copy: [];
  /** force=false TERM / true KILL */
  kill: [force: boolean];
}>();

const menuEl = ref<HTMLElement | null>(null);
const pos = reactive({ x: 0, y: 0 });

watch(
  () => props.menu,
  async (m) => {
    if (!m) return;
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
</script>
