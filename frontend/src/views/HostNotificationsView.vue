<template>
  <div class="tab-root notify-page">
    <EnlargableCard bare class="tab-enl">
      <div class="notify-body-layout enl-head-zone">
        <nav class="notify-nav" aria-label="通知分组">
          <button
            v-for="g in NAV_GROUPS"
            :key="g.id"
            type="button"
            class="notify-nav-item"
            :class="{ active: pane === g.id }"
            @click="setPane(g.id)"
          >
            {{ g.label }}
          </button>
        </nav>

        <div class="notify-pane">
          <!-- 订阅设置 -->
          <section v-if="pane === 'subscribe'" class="sub-sec">
            <h3 class="sub-sec__title">通知订阅</h3>

            <h4 class="sub-sec__subtitle">消息订阅</h4>
            <p class="sub-sec__hint">
              CPU / 内存 / 磁盘 / 负载。未勾选的类型不发任何通知。已订阅后走系统通知与应用内历史；企业微信还受「设置 → 通知」总开关控制。
            </p>
            <div class="sub-list">
              <div
                v-for="rule in ALERT_RULES"
                :key="rule.kind"
                class="sub-row"
              >
                <div class="sub-row__main">
                  <span class="sub-row__name">{{ rule.name }}</span>
                  <span class="sub-row__desc">{{ rule.desc }}</span>
                </div>
                <el-switch
                  :model-value="
                    settings.isResourceNotifySubscribed(host, rule.kind)
                  "
                  @change="
                    (v: string | number | boolean) =>
                      settings.setResourceNotifySubscribed(
                        host,
                        rule.kind,
                        Boolean(v)
                      )
                  "
                />
              </div>
            </div>

            <div class="rules-block">
              <h4 class="rules-block__title">应用探活通道</h4>
              <p class="sub-sec__hint">
                已订阅服务在探活异常 / 恢复时走下列通道。系统与应用内通知固定开启；企业微信还受「设置
                → 通知」总开关与 Webhook 控制。
              </p>
              <div class="alert-rules-form">
                <div class="alert-rules-head">
                  <span>类型</span>
                  <span>条件</span>
                  <span>系统通知</span>
                  <span>应用通知</span>
                  <span>企业微信</span>
                </div>
                <div
                  v-for="rule in APP_NOTIFY_RULES"
                  :key="rule.kind"
                  class="alert-rules-row"
                >
                  <span class="alert-rules-name">{{ rule.name }}</span>
                  <span class="alert-rules-desc">{{ rule.desc }}</span>
                  <span
                    class="alert-rules-always"
                    title="已订阅时系统通知开启"
                  >
                    <el-icon><Check /></el-icon>
                  </span>
                  <span
                    class="alert-rules-always"
                    title="已订阅时写入应用内告警历史"
                  >
                    <el-icon><Check /></el-icon>
                  </span>
                  <span
                    class="alert-rules-wecom"
                    :class="{ 'is-off': !settings.notifyEnabled }"
                    :title="
                      settings.notifyEnabled
                        ? '已订阅且总开关开启时推企业微信'
                        : '企微总开关已关闭'
                    "
                  >
                    <el-icon v-if="settings.notifyEnabled"><Check /></el-icon>
                    <span v-else class="alert-rules-off">关</span>
                  </span>
                </div>
              </div>
            </div>

            <h4 class="sub-sec__subtitle">应用探活</h4>
            <p class="sub-sec__hint">
              按服务订阅。未勾选的服务不发任何通知。应用页「订阅」列仅只读配套显示。
            </p>
            <div class="sub-groups">
              <div
                v-for="g in WATCH_SERVICE_GROUPS"
                :key="g.key"
                class="sub-group"
              >
                <div class="sub-group__title">{{ g.title }}</div>
                <div class="sub-list">
                  <div
                    v-for="svc in servicesOf(g.key)"
                    :key="svc.name"
                    class="sub-row"
                  >
                    <div class="sub-row__main">
                      <span class="sub-row__name">{{ svc.label }}</span>
                      <span
                        v-if="svc.runtime === 'bun'"
                        class="sub-row__tag"
                      >Bun</span>
                      <span v-else class="sub-row__tag is-java">Java</span>
                    </div>
                    <el-switch
                      :model-value="
                        settings.isAppNotifySubscribed(host, svc.name)
                      "
                      @change="
                        (v: string | number | boolean) =>
                          settings.setAppNotifySubscribed(
                            host,
                            svc.name,
                            Boolean(v)
                          )
                      "
                    />
                  </div>
                </div>
              </div>
            </div>
          </section>

          <!-- 告警历史 -->
          <template v-else>
            <div class="notify-toolbar">
              <span class="notify-toolbar__hint">
                本机告警历史；进入本页会将该主机未读标为已读。
              </span>
              <el-button
                type="primary"
                plain
                :loading="loading"
                @click="reload"
              >
                刷新
              </el-button>
            </div>
            <div class="notify-history">
              <PageSkeleton v-if="loading && !events.length" variant="notify" />
              <AlertEventList
                v-else
                :events="events"
                :loading="loading"
                :focus-id="focusId"
              />
            </div>
          </template>
        </div>
      </div>
    </EnlargableCard>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from "vue";
import { Check } from "@element-plus/icons-vue";
import AlertEventList from "@/components/alert/AlertEventList.vue";
import EnlargableCard from "@/components/EnlargableCard.vue";
import PageSkeleton from "@/components/PageSkeleton.vue";
import { useAppStore } from "@/stores/app";
import { useSettingsStore } from "@/stores/settings";
import {
  useAlertHistoryStore,
  type AlertEvent,
} from "@/stores/alertHistory";
import { ALERT_RULES } from "@/utils/alerts";
import {
  APP_NOTIFY_RULES,
  WATCH_SERVICE_GROUPS,
  WATCH_SERVICE_META,
  type WatchServiceGroupKey,
} from "@/utils/watchServices";

type NotifyPane = "subscribe" | "history";

const NAV_GROUPS: { id: NotifyPane; label: string }[] = [
  { id: "subscribe", label: "订阅设置" },
  { id: "history", label: "告警历史" },
];

const props = defineProps<{ host: string }>();

const app = useAppStore();
const settings = useSettingsStore();
const alertHistory = useAlertHistoryStore();
const pane = ref<NotifyPane>("subscribe");
const loading = ref(false);
const events = ref<AlertEvent[]>([]);
const focusId = ref("");

const active = computed(() => app.isHostSubActive(props.host, "notifications"));

function servicesOf(group: WatchServiceGroupKey) {
  return WATCH_SERVICE_META.filter((s) => s.group === group);
}

function setPane(id: NotifyPane) {
  pane.value = id;
  if (id === "history") void enterHistory();
}

async function reload() {
  loading.value = true;
  try {
    events.value = await alertHistory.listByHost(props.host, 500);
  } catch {
    events.value = [];
  } finally {
    loading.value = false;
  }
}

async function enterHistory() {
  await reload();
  try {
    await alertHistory.markAllRead(props.host);
  } catch {
    /* ignore */
  }
  events.value = events.value.map((e) => ({ ...e, read: true }));
  const fid = alertHistory.focusEventId;
  if (fid) void scrollToFocus(fid);
}

async function scrollToFocus(id: string) {
  if (!id) return;
  pane.value = "history";
  focusId.value = id;
  await nextTick();
  const el = document.getElementById(`alert-ev-${id}`);
  el?.scrollIntoView({ block: "center", behavior: "smooth" });
  window.setTimeout(() => {
    if (focusId.value === id) focusId.value = "";
    alertHistory.clearFocusEventId();
  }, 2500);
}

async function enterPage() {
  if (alertHistory.focusEventId) {
    pane.value = "history";
    await enterHistory();
    return;
  }
  // 进「通知」默认停在订阅设置，不自动标已读
  if (pane.value === "history") await enterHistory();
}

onMounted(() => {
  if (active.value) void enterPage();
});

watch(active, (on) => {
  if (on) void enterPage();
});

watch(
  () => props.host,
  () => {
    pane.value = "subscribe";
    if (active.value) void enterPage();
  }
);

watch(
  () => alertHistory.focusEventId,
  (id) => {
    if (id && active.value) void scrollToFocus(id);
  }
);
</script>

<style scoped lang="scss">
.notify-page {
  min-height: 0;
  height: 100%;
  display: flex;
  flex-direction: column;
}
.notify-body-layout {
  flex: 1;
  min-height: 0;
  display: flex;
  gap: 0;
  min-width: 0;
}
.notify-nav {
  flex: 0 0 148px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 4px 8px 12px 0;
}
.notify-nav-item {
  appearance: none;
  border: none;
  background: transparent;
  text-align: left;
  padding: 10px 20px;
  border-radius: var(--m3-shape-full);
  font: var(--m3-label-large);
  color: var(--m3-on-surface);
  cursor: pointer;
  transition: background-color var(--m3-motion-state),
    color var(--m3-motion-state);

  &:hover {
    background: color-mix(in srgb, var(--m3-on-surface) 6%, transparent);
  }
  &.active {
    background: var(--m3-primary-container);
    color: var(--m3-primary);
    font-weight: 500;
  }
}
.notify-pane {
  flex: 1;
  min-width: 0;
  min-height: 0;
  padding-left: 8px;
}
.sub-sec__title {
  margin: 0 0 6px;
  font: var(--m3-title-small);
  color: var(--m3-on-surface);
}
.sub-sec__subtitle {
  margin: 20px 0 10px;
  font: var(--m3-title-small);
  color: var(--m3-on-surface);
}
.sub-sec__hint {
  margin: 0 0 12px;
  font: var(--m3-body-small);
  color: var(--m3-on-surface-variant);
  line-height: 1.5;
}
.rules-block {
  margin-top: 20px;
  margin-bottom: 4px;
}
.rules-block__title {
  margin: 0 0 6px;
  font: var(--m3-label-large);
  font-weight: 600;
  color: var(--m3-on-surface);
}
.alert-rules-form {
  background: var(--m3-card);
  border: 1px solid var(--m3-outline-variant);
  border-radius: var(--m3-shape-m);
  overflow: hidden;
}
.alert-rules-head,
.alert-rules-row {
  display: grid;
  grid-template-columns: 72px minmax(0, 1fr) 80px 80px 80px;
  gap: 12px;
  align-items: center;
  padding: 12px 18px;
}
.alert-rules-head {
  font: var(--m3-label-medium);
  color: var(--m3-on-surface-variant);
  background: var(--m3-card);
  border-bottom: 1px solid var(--m3-outline-variant);
}
.alert-rules-row + .alert-rules-row {
  border-top: 1px solid var(--m3-outline-variant);
}
.alert-rules-name {
  font: var(--m3-body-large);
  color: var(--m3-on-surface);
  font-weight: 500;
}
.alert-rules-desc {
  font: var(--m3-body-small);
  color: var(--m3-on-surface-variant);
  line-height: 1.45;
}
.alert-rules-always,
.alert-rules-wecom {
  justify-self: center;
  display: inline-flex;
  align-items: center;
  color: var(--m3-on-surface-variant);
  font-size: 16px;
}
.alert-rules-wecom.is-off {
  color: var(--m3-on-surface-variant);
  opacity: 0.7;
}
.alert-rules-off {
  font: var(--m3-label-medium);
  color: var(--m3-on-surface-variant);
}
.sub-groups {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.sub-group__title {
  margin-bottom: 8px;
  font: var(--m3-label-large);
  font-weight: 600;
  color: var(--m3-on-surface);
}
.sub-list {
  border: 1px solid var(--m3-outline-variant);
  border-radius: var(--m3-shape-m);
  overflow: hidden;
  background: var(--m3-card);
}
.sub-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 16px;
}
.sub-row + .sub-row {
  border-top: 1px solid var(--m3-outline-variant);
}
.sub-row__main {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.sub-row__name {
  font: var(--m3-body-large);
  color: var(--m3-on-surface);
  font-variant-numeric: tabular-nums;
}
.sub-row__desc {
  font: var(--m3-body-small);
  color: var(--m3-on-surface-variant);
}
.sub-row__tag {
  flex: 0 0 auto;
  padding: 1px 6px;
  border-radius: var(--m3-shape-xs);
  font: var(--m3-label-small);
  color: var(--m3-primary);
  background: color-mix(in srgb, var(--m3-primary) 12%, var(--m3-surface));
}
.sub-row__tag.is-java {
  color: var(--m3-on-surface-variant);
  background: color-mix(in srgb, var(--m3-on-surface) 8%, var(--m3-surface));
}
.notify-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}
.notify-toolbar__hint {
  font: var(--m3-body-small);
  color: var(--m3-on-surface-variant);
}
.notify-history {
  min-height: 160px;
}
</style>
