<template>
  <!-- 编辑主机右侧抽屉：与主机列表页的右侧编辑面板同款，替代原弹窗编辑 -->
  <Teleport to="body">
    <aside v-if="host" class="host-edit-drawer">
      <HostEditPanel
        :key="host.name"
        :host="host"
        :os-release="osRelease || ''"
        @close="emit('close')"
        @saved="emit('close')"
      />
    </aside>
  </Teleport>
</template>

<script setup lang="ts">
import type { sshconfig } from "@/api";
import HostEditPanel from "@/components/sidebar/HostEditPanel.vue";

defineProps<{
  host: sshconfig.HostConfig | null;
  osRelease?: string;
}>();

const emit = defineEmits<{ (e: "close"): void }>();
</script>

<style scoped lang="scss">
.host-edit-drawer {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  z-index: 99990;
  display: flex;
  flex-direction: column;
  width: 380px;
  overflow: auto;
  box-sizing: border-box;
  padding: 16px;
  border-left: 1px solid var(--m3-outline-variant);
  background: var(--m3-surface-container);
  box-shadow: var(--m3-elevation-2);
}
</style>
