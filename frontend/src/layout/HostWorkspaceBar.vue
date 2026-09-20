<template>
  <header class="ws-bar">
    <div class="ws-bar__title">{{ session.title || session.host }}</div>
    <nav class="ws-bar__tabs" aria-label="主机功能">
      <button
        v-for="t in HOST_SUB_TABS"
        :key="t.value"
        type="button"
        class="ws-bar__tab"
        :class="{ active: currentSub === t.value }"
        @pointerdown="(e) => pointerAction(e, () => pickTool(t.value))"
        @click="clickAction(() => pickTool(t.value))"
      >
        {{ t.label }}
      </button>
    </nav>
    <div class="ws-bar__side">
      <button type="button" class="ws-bar__connect" @click="app.connectTerminal(session.host)">
        连接终端
      </button>
    </div>
  </header>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { HOST_SUB_TABS } from "@/constants/hostSubTabs";
import { kindToSubTab, useAppStore, type SubTab, type WorkspaceSession } from "@/stores/app";
import { clickAction, pointerAction } from "@/utils/pointerAction";

const props = defineProps<{
  session: WorkspaceSession;
}>();

const app = useAppStore();
const currentSub = computed(() => kindToSubTab(props.session.tool));

function pickTool(sub: SubTab) {
  app.setSubTab(props.session.host, sub);
}
</script>

<style scoped lang="scss">
.ws-bar {
  position: relative;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
  height: var(--m3-chrome-height);
  padding: 0 12px;
  box-sizing: border-box;
  background: var(--m3-content);
  border-bottom: 1px solid var(--m3-outline-variant);
}

.ws-bar__tabs {
  display: flex;
  align-items: center;
  gap: 2px;
  flex: 1 1 auto;
  min-width: 0;
  overflow-x: auto;
  scrollbar-width: none;

  &::-webkit-scrollbar {
    display: none;
  }
}

.ws-bar__tab {
  appearance: none;
  height: 28px;
  padding: 0 10px;
  flex-shrink: 0;
  border: 0;
  border-radius: var(--m3-shape-s);
  background: transparent;
  color: var(--m3-on-surface-variant);
  font: var(--m3-label-large);
  cursor: pointer;

  &:hover {
    color: var(--m3-on-surface);
    background: color-mix(in srgb, var(--m3-on-surface) 6%, transparent);
  }

  &.active {
    color: var(--m3-nav-active-fg);
    background: var(--m3-nav-active-bg);
    font-weight: 600;
  }

  &:focus-visible {
    outline: var(--m3-focus-ring);
    outline-offset: 1px;
  }
}

.ws-bar__title {
  min-width: 0;
  flex: 0 1 auto;
  max-width: min(240px, 24vw);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--m3-on-surface);
  font: var(--m3-title-small);
  font-weight: 650;
}

.ws-bar__connect {
  appearance: none;
  height: var(--m3-button-height, 32px);
  padding: 0 10px;
  border: 0;
  border-radius: var(--m3-shape-s);
  background: transparent;
  color: var(--m3-on-surface-variant);
  font: var(--m3-label-large);
  cursor: pointer;
  flex-shrink: 0;

  &:hover {
    color: var(--m3-on-surface);
    background: color-mix(in srgb, var(--m3-on-surface) 6%, transparent);
  }

  &:focus-visible {
    outline: var(--m3-focus-ring);
    outline-offset: 1px;
  }
}

.ws-bar__side {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-left: auto;
  flex-shrink: 0;
  min-width: 0;
}

.ws-bar__connect {
  border: 1px solid var(--m3-outline-variant);
  color: var(--m3-on-surface);
  background: var(--m3-card);
}

@media (max-width: 900px) {
  .ws-bar__title {
    max-width: 128px;
  }

  .ws-bar__tabs {
    gap: 0;
  }

  .ws-bar__tab {
    padding: 0 8px;
  }

  .ws-bar__connect {
    padding: 0 8px;
  }
}
</style>
