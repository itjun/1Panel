<template>
  <div class="host-monitor">
    <div class="host-monitor__charts">
      <MonitorView :host="host" />
    </div>
    <details class="subs">
      <summary>
        <span>通知设置</span>
        <span class="subs-sum">
          资源 {{ resourceOn }}/{{ ALERT_RULES.length }}
          · 应用 {{ appOn }}/{{ WATCH_SERVICE_ORDER.length }}
        </span>
      </summary>
      <div class="subs-body">
        <div class="subs-group">
          <span class="lab">资源告警</span>
          <label v-for="rule in ALERT_RULES" :key="rule.kind" class="sw">
            <el-switch
              :model-value="settings.isResourceNotifySubscribed(host, rule.kind)"
              @change="
                (v: string | number | boolean) =>
                  settings.setResourceNotifySubscribed(host, rule.kind, Boolean(v))
              "
            />
            {{ rule.name }}
          </label>
        </div>
        <div class="subs-group">
          <span class="lab">应用探活</span>
          <label v-for="svc in WATCH_SERVICE_ORDER" :key="svc" class="sw">
            <el-switch
              :model-value="settings.isAppNotifySubscribed(host, svc)"
              @change="
                (v: string | number | boolean) =>
                  settings.setAppNotifySubscribed(host, svc, Boolean(v))
              "
            />
            {{ svc }}
          </label>
        </div>
      </div>
    </details>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import MonitorView from "@/views/MonitorView.vue";
import { useSettingsStore } from "@/stores/settings";
import { ALERT_RULES } from "@/utils/alerts";
import { WATCH_SERVICE_ORDER } from "@/utils/watchServices";

const props = defineProps<{ host: string }>();
const settings = useSettingsStore();

const resourceOn = computed(
  () =>
    ALERT_RULES.filter((rule) =>
      settings.isResourceNotifySubscribed(props.host, rule.kind)
    ).length
);

const appOn = computed(
  () =>
    WATCH_SERVICE_ORDER.filter((svc) =>
      settings.isAppNotifySubscribed(props.host, svc)
    ).length
);
</script>

<style scoped lang="scss">
.host-monitor {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

.host-monitor__charts {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.subs {
  flex-shrink: 0;
  border-top: 1px solid var(--m3-outline-variant);
  background: var(--m3-content);
}

.subs summary {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: var(--m3-button-height);
  padding: 6px 12px;
  cursor: pointer;
  font: var(--m3-label-large);
  color: var(--m3-on-surface);

  &:focus-visible {
    outline: var(--m3-focus-ring);
    outline-offset: -2px;
  }
}

.subs-sum {
  font: var(--m3-body-small);
  color: var(--m3-on-surface-variant);
}

.subs-body {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 0 12px 10px;
}

.subs-group {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 12px;
}

.lab {
  flex: 0 0 72px;
  font: var(--m3-label-medium);
  color: var(--m3-on-surface-variant);
}

.sw {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 28px;
  font: var(--m3-body-small);
  color: var(--m3-on-surface);
}
</style>
