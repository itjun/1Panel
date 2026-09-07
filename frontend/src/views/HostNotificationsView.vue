<template>
  <div class="tab-root notify-page">
    <EnlargableCard title="通知">
      <div class="notify-toolbar">
        <span class="notify-toolbar__hint">本机告警历史；进入本页会将该主机未读标为已读。</span>
        <el-button type="primary" plain :loading="loading" @click="reload">
          刷新
        </el-button>
      </div>

      <div v-loading="loading" class="notify-body">
        <AlertEventList
          :events="events"
          :loading="loading"
          :focus-id="focusId"
        />
      </div>
    </EnlargableCard>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from "vue";
import AlertEventList from "@/components/alert/AlertEventList.vue";
import EnlargableCard from "@/components/EnlargableCard.vue";
import { useAppStore } from "@/stores/app";
import {
  useAlertHistoryStore,
  type AlertEvent,
} from "@/stores/alertHistory";

const props = defineProps<{ host: string }>();

const app = useAppStore();
const alertHistory = useAlertHistoryStore();
const loading = ref(false);
const events = ref<AlertEvent[]>([]);
const focusId = ref("");

const active = computed(() => app.isHostSubActive(props.host, "notifications"));

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

async function enterPage() {
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
  focusId.value = id;
  await nextTick();
  const el = document.getElementById(`alert-ev-${id}`);
  el?.scrollIntoView({ block: "center", behavior: "smooth" });
  window.setTimeout(() => {
    if (focusId.value === id) focusId.value = "";
    alertHistory.clearFocusEventId();
  }, 2500);
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
.notify-body {
  min-height: 160px;
}
</style>
