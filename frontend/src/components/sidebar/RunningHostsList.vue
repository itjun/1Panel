<template>
  <div class="running-hosts" :class="{ 'is-compact': compact }">
    <div v-if="title" class="running-hosts__head">{{ title }}</div>
    <p v-if="app.runningHosts.length === 0" class="running-hosts__empty">
      暂无打开的主机
    </p>
    <ul v-else class="running-hosts__list" role="listbox" aria-label="已打开主机">
      <li
        v-for="name in app.runningHosts"
        :key="name"
        role="option"
        class="running-hosts__item"
        :class="{ 'is-active': name === activeName }"
        :aria-selected="name === activeName"
        @click="onOpen(name)"
      >
        <DistroLogo
          :os-release="app.osReleaseMap.get(name) || ''"
          :size="16"
          class="running-hosts__ico"
        />
        <span class="running-hosts__name" :title="name">{{ name }}</span>
        <span
          v-if="hasAlert(name)"
          class="running-hosts__alert"
          v-tip="'有资源告警'"
        />
        <button
          type="button"
          class="running-hosts__close"
          v-tip="'关闭会话'"
          aria-label="关闭会话"
          @click.stop="onClose(name)"
        >
          ×
        </button>
      </li>
    </ul>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import DistroLogo from "@/components/DistroLogo.vue";
import type { FleetHostStatus } from "@/composables/useFleetStatus";
import { useAppStore } from "@/stores/app";

const props = withDefaults(
  defineProps<{
    /** 可选：父级注入的舰队状态，有告警时显示红点 */
    statusByHost?: Map<string, FleetHostStatus>;
    /** 区块小标题，空则不显示 */
    title?: string;
    /** 主机详情侧栏用更紧凑的间距 */
    compact?: boolean;
  }>(),
  {
    title: "",
    compact: false,
  }
);

const app = useAppStore();

const activeName = computed(() => {
  const tab = app.activeTab;
  if (tab?.kind === "host") return tab.id;
  return "";
});

function hasAlert(name: string): boolean {
  return !!props.statusByHost?.get(name)?.alert;
}

function onOpen(name: string) {
  app.openHostTab(name);
}

function onClose(name: string) {
  app.stopHost(name);
}
</script>

<style scoped lang="scss">
.running-hosts {
  min-width: 0;
  padding: 4px 0 8px;
}

.running-hosts__head {
  padding: 8px 14px 4px;
  font: var(--m3-label-small);
  font-weight: 600;
  color: var(--m3-on-surface-variant);
  letter-spacing: 0.02em;
  text-transform: none;
}

.running-hosts__empty {
  margin: 0;
  padding: 8px 14px 12px;
  font: var(--m3-body-small);
  color: var(--m3-on-surface-variant);
  opacity: 0.72;
}

.running-hosts__list {
  list-style: none;
  margin: 0;
  padding: 0 6px;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.running-hosts__item {
  position: relative;
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 36px;
  padding: 0 10px 0 10px;
  border-radius: 8px;
  color: var(--m3-on-surface-variant);
  cursor: pointer;
  box-sizing: border-box;
  transition: background-color var(--m3-motion-state);

  &:hover {
    background: color-mix(in srgb, var(--m3-on-surface) 6%, transparent);
    color: var(--m3-on-surface);

    .running-hosts__close {
      opacity: 1;
      pointer-events: auto;
    }
  }

  &.is-active {
    color: var(--m3-primary);
    font-weight: 600;
    background: color-mix(in srgb, var(--m3-primary) 10%, transparent);

    &::before {
      content: "";
      position: absolute;
      left: 0;
      top: 8px;
      bottom: 8px;
      width: 2px;
      background: var(--m3-primary);
      border-radius: 0 1px 1px 0;
    }
  }
}

.is-compact .running-hosts__item {
  min-height: 34px;
}

.running-hosts__ico {
  flex-shrink: 0;
}

.running-hosts__name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font: var(--m3-label-large);
}

.running-hosts__alert {
  flex-shrink: 0;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #dc2626;
  box-shadow: 0 0 0 1.5px
    color-mix(in srgb, var(--m3-list, #fff) 80%, transparent);
}

.running-hosts__close {
  appearance: none;
  flex-shrink: 0;
  width: 22px;
  height: 22px;
  margin-right: -2px;
  padding: 0;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--m3-on-surface-variant);
  font-size: 16px;
  line-height: 1;
  cursor: pointer;
  opacity: 0;
  pointer-events: none;
  transition:
    opacity var(--m3-motion-state),
    background-color var(--m3-motion-state),
    color var(--m3-motion-state);

  &:hover {
    background: color-mix(in srgb, var(--m3-on-surface) 10%, transparent);
    color: var(--m3-on-surface);
  }
}
</style>
