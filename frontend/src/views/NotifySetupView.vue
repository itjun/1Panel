<template>
  <div class="notify-setup">
    <div class="setup-form">
      <div class="row">
        <span class="row-name">送到哪里</span>
        <div class="toggles">
          <span class="toggle">
            <span>系统通知</span>
            <el-switch
              :model-value="settings.systemNotifyEnabled"
              @change="
                (v: string | number | boolean) =>
                  settings.setSystemNotifyEnabled(Boolean(v))
              "
            />
          </span>
          <span class="toggle">
            <span>应用内</span>
            <el-switch
              :model-value="settings.inAppNotifyEnabled"
              @change="
                (v: string | number | boolean) =>
                  settings.setInAppNotifyEnabled(Boolean(v))
              "
            />
          </span>
          <span class="toggle">
            <span>企业微信</span>
            <el-switch
              :model-value="settings.notifyEnabled"
              @change="onNotifyEnabled"
            />
          </span>
        </div>
      </div>

      <div class="row row--webhook">
        <div class="row-text">
          <span class="row-name">企业微信地址</span>
          <span class="row-hint">{{ webhookHint }}</span>
        </div>
        <div class="webhook">
          <el-input
            v-model="settings.webhookDraft"
            :disabled="!settings.notifyEnabled"
            spellcheck="false"
            class="webhook-input"
            placeholder="粘贴完整 Webhook，或只填 key"
            @keydown="onWebhookKeydown"
            @paste="onWebhookPaste"
          />
          <div class="webhook-actions">
            <el-button :disabled="!settings.notifyEnabled" @click="copyWebhook">
              复制
            </el-button>
            <el-button
              :disabled="!settings.notifyEnabled"
              :loading="testingWebhook"
              @click="testWebhook"
            >
              测试
            </el-button>
            <el-button
              :type="canSaveWebhook ? 'primary' : 'default'"
              :disabled="!settings.notifyEnabled"
              @click="saveWebhook"
            >
              保存
            </el-button>
          </div>
        </div>
      </div>

      <div class="row">
        <span class="row-name">通知什么</span>
        <div class="toggles">
          <span
            v-for="item in CONTENT_KINDS"
            :key="item.kind"
            class="toggle"
            v-tip="item.desc"
          >
            <span>{{ item.name }}</span>
            <el-switch
              :model-value="settings.isContentKindEnabled(item.kind)"
              @change="
                (v: string | number | boolean) =>
                  settings.setContentKindEnabled(item.kind, Boolean(v))
              "
            />
          </span>
          <span class="toggle" v-tip="'指标回落或探活恢复后再推一条'">
            <span>恢复</span>
            <el-switch
              :model-value="settings.notifyRecoverEnabled"
              @change="
                (v: string | number | boolean) =>
                  settings.setNotifyRecoverEnabled(Boolean(v))
              "
            />
          </span>
        </div>
      </div>

      <div class="row">
        <span class="row-name">正文带上</span>
        <div class="checks">
          <el-checkbox
            v-for="item in CONTENT_FIELDS"
            :key="item.field"
            :model-value="settings.isNotifyContentFieldEnabled(item.field)"
            @change="
              (v: string | number | boolean) =>
                settings.setNotifyContentFieldEnabled(item.field, Boolean(v))
            "
          >
            {{ item.name }}
          </el-checkbox>
        </div>
      </div>
    </div>

    <div class="subs">
      <div class="subs-bar">
        <RouterButton v-model="subsKind" compact :buttons="subsKindButtons" />
        <RouterButton v-model="groupFilter" compact :buttons="groupButtons" />
        <span class="subs-hint">上面关掉的类型或通道，这里订了也不会发</span>
      </div>

      <div class="subs-table">
        <el-empty
          v-if="!visibleHosts.length"
          description="没有匹配的主机"
          :image-size="64"
        />

        <el-table
          v-else-if="subsKind === 'metric'"
          :data="visibleHosts"
          row-key="name"
          height="100%"
          class="subs-grid"
          empty-text="没有匹配的主机"
        >
          <el-table-column
            prop="name"
            label="主机"
            min-width="160"
            fixed
            show-overflow-tooltip
          />
          <el-table-column
            v-for="rule in ALERT_RULES"
            :key="rule.kind"
            :label="rule.name"
            min-width="88"
            align="center"
          >
            <template #default="{ row }">
              <el-switch
                :model-value="
                  settings.isResourceNotifySubscribed(row.name, rule.kind)
                "
                @change="
                  (v: string | number | boolean) =>
                    settings.setResourceNotifySubscribed(
                      row.name,
                      rule.kind,
                      Boolean(v)
                    )
                "
              />
            </template>
          </el-table-column>
        </el-table>

        <el-table
          v-else
          :data="visibleHosts"
          row-key="name"
          height="100%"
          class="subs-grid"
          empty-text="没有匹配的主机"
        >
          <el-table-column
            prop="name"
            label="主机"
            min-width="160"
            fixed
            show-overflow-tooltip
          />
          <el-table-column
            v-for="svcName in WATCH_SERVICE_ORDER"
            :key="svcName"
            :label="serviceLabel(svcName)"
            min-width="96"
            align="center"
          >
            <template #default="{ row }">
              <el-switch
                :model-value="settings.isAppNotifySubscribed(row.name, svcName)"
                @change="
                  (v: string | number | boolean) =>
                    settings.setAppNotifySubscribed(row.name, svcName, Boolean(v))
                "
              />
            </template>
          </el-table-column>
        </el-table>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { ElMessage } from "element-plus";
import RouterButton from "@/components/RouterButton.vue";
import { api } from "@/api";
import { formatErr } from "@/utils/format";
import { copyText, readText } from "@/utils/clipboard";
import { useAppStore } from "@/stores/app";
import {
  expandWecomWebhook,
  useSettingsStore,
  type AlertContentKind,
  type NotifyContentField,
} from "@/stores/settings";
import { ALERT_RULES } from "@/utils/alerts";
import {
  WATCH_SERVICE_META,
  WATCH_SERVICE_ORDER,
  type WatchServiceName,
} from "@/utils/watchServices";

const UNGROUPED = "未分组";

const app = useAppStore();
const settings = useSettingsStore();
const testingWebhook = ref(false);
const subsKind = ref("metric");
const groupFilter = ref("all");

const subsKindButtons = [
  { value: "metric", label: "指标" },
  { value: "app", label: "应用" },
];

const CONTENT_KINDS: {
  kind: AlertContentKind;
  name: string;
  desc: string;
}[] = [
  ...ALERT_RULES.map((r) => ({
    kind: r.kind as AlertContentKind,
    name: r.name,
    desc: r.desc,
  })),
  {
    kind: "app",
    name: "应用",
    desc: "进程、健康检查或入口探活失败",
  },
];

const CONTENT_FIELDS: { field: NotifyContentField; name: string }[] = [
  { field: "hostName", name: "主机名" },
  { field: "metric", name: "指标" },
  { field: "threshold", name: "阈值" },
  { field: "value", name: "当前值" },
  { field: "service", name: "服务名" },
];

const draftNorm = computed(() => settings.webhookDraft.trim());
const savedExpanded = computed(() => expandWecomWebhook(settings.wecomWebhook));
const webhookDirty = computed(
  () => expandWecomWebhook(draftNorm.value) !== savedExpanded.value
);
const webhookTested = computed(
  () => !!draftNorm.value && settings.webhookTested === draftNorm.value
);
const canSaveWebhook = computed(() => {
  if (!settings.notifyEnabled) return false;
  if (!webhookDirty.value) return false;
  if (!draftNorm.value) return true;
  return webhookTested.value;
});
const webhookHint = computed(() => {
  if (!settings.notifyEnabled) return "企业微信已关，地址不会发出。";
  if (!draftNorm.value) {
    return savedExpanded.value
      ? "清空后保存即删除地址，不用先测试。"
      : "先粘贴地址，测试通过后才能保存。";
  }
  if (webhookDirty.value && !webhookTested.value) {
    return "地址改过了，先测试，群里收到后再保存。";
  }
  if (webhookDirty.value && webhookTested.value) {
    return "测试已通过，可以保存。";
  }
  return "这是已保存的地址。";
});

watch(
  () => settings.webhookDraft,
  (v) => {
    if (settings.webhookTested && settings.webhookTested !== v.trim()) {
      settings.webhookTested = "";
    }
  }
);

function insertWebhookText(
  el: HTMLTextAreaElement | HTMLInputElement,
  text: string
) {
  const start = el.selectionStart ?? settings.webhookDraft.length;
  const end = el.selectionEnd ?? start;
  const cur = settings.webhookDraft;
  settings.webhookDraft = cur.slice(0, start) + text + cur.slice(end);
  const pos = start + text.length;
  requestAnimationFrame(() => {
    el.focus();
    el.setSelectionRange(pos, pos);
  });
}

async function pasteIntoWebhook(el: EventTarget | null) {
  const text = (await readText()).trim();
  if (!text) {
    ElMessage.warning("剪贴板是空的");
    return;
  }
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
    insertWebhookText(el, text);
    return;
  }
  settings.webhookDraft = text;
}

function onWebhookKeydown(e: Event | KeyboardEvent) {
  if (!(e instanceof KeyboardEvent)) return;
  if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey) return;
  if (e.code !== "KeyV") return;
  e.preventDefault();
  void pasteIntoWebhook(e.target);
}

function onWebhookPaste(e: ClipboardEvent) {
  const native = e.clipboardData?.getData("text") || "";
  if (native) return;
  e.preventDefault();
  void pasteIntoWebhook(e.target);
}

async function copyWebhook() {
  const url = expandWecomWebhook(draftNorm.value);
  if (!url) {
    ElMessage.warning("请先粘贴地址");
    return;
  }
  try {
    await copyText(url);
    ElMessage.success("已复制完整地址");
  } catch {
    ElMessage.error("复制失败");
  }
}

async function testWebhook() {
  const url = expandWecomWebhook(draftNorm.value);
  if (!url) {
    ElMessage.warning("请先粘贴地址，再测试");
    return;
  }
  testingWebhook.value = true;
  try {
    await api.testWecomWebhook(url);
    settings.webhookTested = draftNorm.value;
    ElMessage.success("测试已发出，到企业微信群里确认");
  } catch (e) {
    settings.webhookTested = "";
    ElMessage.error(formatErr(e));
  } finally {
    testingWebhook.value = false;
  }
}

function saveWebhook() {
  if (!settings.notifyEnabled) return;
  if (!webhookDirty.value) {
    ElMessage.info("当前地址已保存");
    return;
  }
  if (draftNorm.value && !webhookTested.value) {
    ElMessage.warning("请先测试通过，再保存");
    return;
  }
  settings.setWecomWebhook(expandWecomWebhook(draftNorm.value));
  ElMessage.success(draftNorm.value ? "地址已保存" : "已清除地址");
}

function onNotifyEnabled(v: string | number | boolean) {
  settings.setNotifyEnabled(Boolean(v));
}

function serviceLabel(name: WatchServiceName): string {
  const meta = WATCH_SERVICE_META.find((s) => s.name === name);
  if (meta) return meta.label;
  return name;
}

const hostGroupMap = computed(() => {
  const map = new Map<string, string>();
  for (const node of app.groupNodes) {
    const label = node.group?.name?.trim() || UNGROUPED;
    for (const h of node.hosts) {
      if (!map.has(h.name)) map.set(h.name, label);
    }
  }
  for (const h of app.hosts) {
    if (!map.has(h.name)) map.set(h.name, UNGROUPED);
  }
  return map;
});

const groupButtons = computed(() => {
  const names = new Set<string>();
  for (const label of hostGroupMap.value.values()) {
    names.add(label);
  }
  const sorted = [...names].sort((a, b) => {
    if (a === UNGROUPED) return 1;
    if (b === UNGROUPED) return -1;
    return a.localeCompare(b, "zh-CN");
  });
  return [
    { value: "all", label: "全部" },
    ...sorted.map((g) => ({ value: g, label: g })),
  ];
});

const visibleHosts = computed(() => {
  const gf = groupFilter.value;
  const groupMap = hostGroupMap.value;
  const rows: { name: string }[] = [];
  for (const h of app.hosts) {
    const name = h.name || "";
    if (!name) continue;
    const groupLabel = groupMap.get(name) || UNGROUPED;
    if (gf !== "all" && groupLabel !== gf) continue;
    rows.push({ name });
  }
  rows.sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
  return rows;
});
</script>

<style scoped lang="scss">
.notify-setup {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  min-width: 0;
  background: var(--m3-content);
}

.setup-form {
  flex-shrink: 0;
  padding: 0 16px;
  border-bottom: 1px solid var(--m3-outline-variant);
}

.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px 16px;
  min-height: 40px;
  padding: 8px 0;
}

.row + .row {
  border-top: 1px solid var(--m3-outline-variant);
}

.row--webhook {
  align-items: flex-start;
  padding: 8px 0;
}

.row-text {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 180px;
  max-width: 280px;
  flex-shrink: 0;
}

.row-name {
  flex-shrink: 0;
  font: var(--m3-body-medium);
  font-weight: 600;
  color: var(--m3-on-surface);
}

.row-hint {
  font: var(--m3-body-small);
  color: var(--m3-on-surface-variant);
  line-height: 1.4;
}

.toggles,
.checks {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  align-items: center;
  gap: 8px 16px;
  min-width: 0;
}

.toggle {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font: var(--m3-body-medium);
  color: var(--m3-on-surface);
}

.webhook {
  flex: 1 1 360px;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 8px;
}

.webhook-input {
  font-family: var(--m3-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
  font-size: 13px;
}

.webhook-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.subs {
  flex: 1;
  min-height: 180px;
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.subs-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
  padding: 4px 12px 0;
  overflow: hidden;
}

.subs-hint {
  margin-left: auto;
  min-width: 0;
  font: var(--m3-body-small);
  color: var(--m3-on-surface-variant);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.subs-table {
  flex: 1;
  min-height: 0;
  padding: 0 12px 12px;
  display: flex;
  flex-direction: column;
}

.subs-grid {
  width: 100%;
  flex: 1;
  min-height: 0;

  :deep(.el-table__header th) {
    font: var(--m3-label-medium);
    font-weight: 600;
    color: var(--m3-on-surface-variant);
    background: color-mix(in srgb, var(--m3-on-surface) 3%, var(--m3-surface));
  }

  :deep(.el-table__cell) {
    padding: 4px 8px;
  }

  :deep(.el-table__body td) {
    font: var(--m3-body-small);
    color: var(--m3-on-surface);
  }

  :deep(.el-table__body-wrapper),
  :deep(.el-table__header-wrapper) {
    overflow-x: auto;
  }
}

@media (max-width: 860px) {
  .row,
  .row--webhook {
    flex-wrap: wrap;
  }

  .toggles,
  .checks,
  .webhook {
    width: 100%;
    justify-content: flex-start;
  }

  .subs-hint {
    display: none;
  }
}
</style>
