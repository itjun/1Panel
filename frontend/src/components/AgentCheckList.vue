<template>
  <div class="agent-check">
    <div class="agent-check__head">
      <span class="agent-check__title">Agent 检查</span>
      <span
        class="agent-check__sum"
        :class="report?.ok ? 'is-ok' : 'is-bad'"
      >
        {{ checking ? "检查中…" : report?.summary || "" }}
      </span>
    </div>
    <ul v-if="items.length" class="agent-check__list">
      <li v-for="it in items" :key="it.key" class="agent-check__row">
        <span class="agent-check__mark" :class="it.ok ? 'is-ok' : 'is-bad'">
          {{ it.ok ? "✓" : "✗" }}
        </span>
        <span class="agent-check__name">{{ it.name }}</span>
        <span class="agent-check__detail">{{ it.detail }}</span>
      </li>
    </ul>
    <p v-else-if="checking" class="agent-check__wait">正在探测服务、隧道与采样…</p>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { agentcli } from "@/api";

const props = defineProps<{
  report?: agentcli.CheckReport | null;
  checking?: boolean;
}>();

const items = computed(() => props.report?.items || []);
</script>

<style scoped lang="scss">
.agent-check {
  margin-top: 14px;
}
.agent-check__head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 8px;
}
.agent-check__title {
  font: var(--m3-title-small);
  color: var(--m3-on-surface);
}
.agent-check__sum {
  font: var(--m3-label-medium);
  color: var(--m3-on-surface-variant);
  &.is-ok {
    color: var(--el-color-success);
  }
  &.is-bad {
    color: var(--m3-error);
  }
}
.agent-check__list {
  list-style: none;
  margin: 0;
  padding: 0;
  border: 1px solid var(--m3-outline-variant);
  border-radius: var(--m3-shape-m);
  overflow: hidden;
  background: var(--m3-surface);
}
.agent-check__row {
  display: grid;
  grid-template-columns: 22px 56px minmax(0, 1fr);
  gap: 8px;
  align-items: baseline;
  padding: 8px 12px;
  font: var(--m3-body-small);
}
.agent-check__row + .agent-check__row {
  border-top: 1px solid var(--m3-outline-variant);
}
.agent-check__mark {
  font-weight: 600;
  &.is-ok {
    color: var(--el-color-success);
  }
  &.is-bad {
    color: var(--m3-error);
  }
}
.agent-check__name {
  color: var(--m3-on-surface);
  font-weight: 500;
}
.agent-check__detail {
  color: var(--m3-on-surface-variant);
  word-break: break-word;
}
.agent-check__wait {
  margin: 0;
  font: var(--m3-body-small);
  color: var(--m3-on-surface-variant);
}
</style>
