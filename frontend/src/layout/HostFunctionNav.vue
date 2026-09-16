<template>
  <div class="host-fn">
    <button type="button" class="host-fn__back" @click="app.goHome()">
      ← 全部主机
    </button>

    <el-dropdown trigger="click" @command="onSwitchHost">
      <button type="button" class="host-fn__host">
        <span class="host-fn__host-name">{{ host }}</span>
        <span class="host-fn__caret">▾</span>
      </button>
      <template #dropdown>
        <el-dropdown-menu>
          <el-dropdown-item
            v-for="name in app.runningHosts"
            :key="name"
            :command="name"
            :class="{ 'is-current': name === host }"
          >
            {{ name }}
          </el-dropdown-item>
        </el-dropdown-menu>
      </template>
    </el-dropdown>

    <nav class="host-fn__list" aria-label="主机功能">
      <button
        v-for="b in tabs"
        :key="b.value"
        type="button"
        class="host-fn__item"
        :class="{ 'is-active': current === b.value }"
        @click="app.setSubTab(host, b.value)"
      >
        <span class="host-fn__label">{{ b.label }}</span>
        <span v-if="b.badge" class="host-fn__badge">{{ b.badge }}</span>
      </button>
    </nav>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useAppStore } from "@/stores/app";
import { hostSubTabButtons } from "@/constants/hostSubTabs";

const props = defineProps<{
  host: string;
}>();

const app = useAppStore();

const current = computed(
  () => app.hostSessions[props.host]?.subTab || "overview"
);

const tabs = computed(() =>
  hostSubTabButtons(app.terminalSessionCount[props.host] || 0)
);

function onSwitchHost(name: string) {
  if (name && name !== props.host) app.openHostTab(name);
}
</script>

<style scoped lang="scss">
.host-fn {
  display: flex;
  flex-direction: column;
  min-height: 0;
  flex: 1;
}

.host-fn__back,
.host-fn__host {
  appearance: none;
  width: 100%;
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 40px;
  padding: 0 14px;
  border: none;
  background: transparent;
  color: var(--m3-on-surface);
  font: var(--m3-label-large);
  cursor: pointer;
  text-align: left;
  box-sizing: border-box;

  &:hover {
    background: color-mix(in srgb, var(--m3-on-surface) 6%, transparent);
  }
}

.host-fn__back {
  color: var(--m3-on-surface-variant);
}

.host-fn__host-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 600;
}

.host-fn__caret {
  flex-shrink: 0;
  color: var(--m3-on-surface-variant);
  font-size: 12px;
}

.host-fn__list {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 4px 0 8px;
}

.host-fn__item {
  appearance: none;
  position: relative;
  width: 100%;
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 40px;
  padding: 0 14px 0 18px;
  border: none;
  background: transparent;
  color: var(--m3-on-surface-variant);
  font: var(--m3-label-large);
  cursor: pointer;
  text-align: left;
  box-sizing: border-box;

  &:hover:not(.is-active) {
    color: var(--m3-on-surface);
    background: color-mix(in srgb, var(--m3-on-surface) 6%, transparent);
  }

  &.is-active {
    color: var(--m3-primary);
    font-weight: 600;

    &::before {
      content: "";
      position: absolute;
      left: 0;
      top: 10px;
      bottom: 10px;
      width: 2px;
      background: var(--m3-primary);
      border-radius: 0 1px 1px 0;
    }
  }
}

.host-fn__label {
  flex: 1;
  min-width: 0;
}

.host-fn__badge {
  flex-shrink: 0;
  min-width: 18px;
  padding: 0 6px;
  font: var(--m3-label-small);
  font-variant-numeric: tabular-nums;
  color: var(--m3-on-primary);
  background: var(--m3-primary);
  border-radius: 999px;
  line-height: 18px;
  text-align: center;
}
</style>
