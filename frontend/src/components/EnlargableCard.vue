<template>
  <div
    ref="rootRef"
    :class="[bare ? 'enl-bare' : 'enl-card', { 'is-enlarged': enlarged }]"
  >
    <!-- 标题模式：卡片头（标题 + 放大按钮） -->
    <div v-if="!bare" class="enl-head" @dblclick="toggle">
      <span class="enl-title">{{ title }}</span>
      <el-button
        link
        class="enl-btn"
        :icon="enlarged ? Close : FullScreen"
        :title="enlarged ? '退出最大化' : '最大化'"
        @click="toggle"
      />
    </div>

    <!-- 标题模式：内容包一层 flex 容器；bare 模式：内容直接铺开，不破坏父级 grid/flex 布局 -->
    <div v-if="!bare" class="enl-body">
      <slot />
    </div>
    <slot v-else />

    <!-- bare 模式：右上角悬浮小角标按钮（绝对定位，不参与父级布局） -->
    <el-button
      v-if="bare"
      link
      class="enl-corner-btn"
      :icon="enlarged ? Close : FullScreen"
      :title="enlarged ? '退出最大化' : '最大化'"
      @click="toggle"
    />
  </div>
</template>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import { Close, FullScreen } from "@element-plus/icons-vue";
import { SetTrafficLightsHidden } from "@wailsjs/go/main/App";

withDefaults(defineProps<{ title?: string; bare?: boolean }>(), {
  title: "",
  bare: false,
});

const emit = defineEmits<{ toggle: [enlarged: boolean] }>();

const rootRef = ref<HTMLElement | null>(null);
const enlarged = ref(false);

function toggle() {
  enlarged.value = !enlarged.value;
  // 最大化期间隐藏 macOS 红绿灯，退出时恢复
  SetTrafficLightsHidden(enlarged.value).catch(() => {});
  emit("toggle", enlarged.value);
  // 容器尺寸变化后通知表格/ECharts 自适应
  nextTick(() => window.dispatchEvent(new Event("resize")));
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === "Escape" && enlarged.value) toggle();
}

onMounted(() => {
  window.addEventListener("keydown", onKeydown);
});
onBeforeUnmount(() => {
  window.removeEventListener("keydown", onKeydown);
});
</script>

<style scoped lang="scss">
/* ===== 标题模式：整页一张卡 ===== */
.enl-card {
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: var(--el-bg-color, #fff);
  border: 1px solid var(--el-border-color-light, #e4e7ed);
  border-radius: 6px;
  padding: 12px 16px;
  box-sizing: border-box;
}
.enl-head {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}
.enl-title {
  font-size: 14px;
  font-weight: 600;
}
.enl-btn {
  color: var(--el-text-color-secondary);
  &:hover {
    color: var(--el-color-primary);
  }
}
.enl-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

/* ===== bare 模式：包住已有卡片，不动布局，右上角角标 ===== */
.enl-bare {
  position: relative;
  min-width: 0;
  min-height: 0;
}
.enl-corner-btn {
  position: absolute;
  top: 4px;
  right: 6px;
  z-index: 5;
  padding: 4px;
  color: var(--el-text-color-secondary);
  background: var(--el-bg-color, #fff);
  border-radius: 4px;
  opacity: 0.35;
  &:hover {
    opacity: 1;
    color: var(--el-color-primary);
  }
}

/* 最大化状态下的关闭按钮：红色醒目 */
.is-enlarged .enl-btn,
.is-enlarged .enl-corner-btn {
  color: var(--el-color-danger) !important;
  opacity: 1;
}

/* 最大化 = 窗口内覆盖置顶：盖住侧栏/标签栏等所有元素 */
.is-enlarged {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  z-index: 2500;
  overflow: hidden;
  border-radius: 0;
  border: none;
  box-shadow: none;
  background: var(--el-bg-color, #fff);
  padding: 16px 20px;
  box-sizing: border-box;
}
.enl-card.is-enlarged {
  display: flex;
  flex-direction: column;
}
.enl-bare.is-enlarged {
  overflow: auto;
}
</style>
