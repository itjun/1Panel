<template>
  <div class="notify-page">
    <p class="notify-page__lead">
      全局通道总闸与企微 Webhook。某台主机是否真的收到通知，还要看「主机订阅」和「内容设置」。
    </p>

    <section class="ns-block">
      <h2 class="ns-block__title">通道总闸</h2>
      <p class="ns-block__hint">
        关掉某一通道后，所有主机都不再走该通道；主机订阅与内容总闸仍保留。
      </p>
      <div class="ns-list">
        <div class="ns-row">
          <div class="ns-row__main">
            <span class="ns-row__name">系统通知</span>
            <span class="ns-row__desc">操作系统通知中心弹窗</span>
          </div>
          <el-switch
            :model-value="settings.systemNotifyEnabled"
            @change="
              (v: string | number | boolean) =>
                settings.setSystemNotifyEnabled(Boolean(v))
            "
          />
        </div>
        <div class="ns-row">
          <div class="ns-row__main">
            <span class="ns-row__name">应用内通知</span>
            <span class="ns-row__desc">写入「全部消息」告警历史</span>
          </div>
          <el-switch
            :model-value="settings.inAppNotifyEnabled"
            @change="
              (v: string | number | boolean) =>
                settings.setInAppNotifyEnabled(Boolean(v))
            "
          />
        </div>
        <div class="ns-row">
          <div class="ns-row__main">
            <span class="ns-row__name">企业微信</span>
            <span class="ns-row__desc">群机器人推送；须先保存 Webhook</span>
          </div>
          <el-switch
            :model-value="settings.notifyEnabled"
            @change="onNotifyEnabled"
          />
        </div>
      </div>
    </section>

    <section class="ns-block">
      <h2 class="ns-block__title">企业微信 Webhook</h2>
      <p class="ns-block__hint">
        粘贴完整 URL，或只填 <code>key=</code> 后的 UUID。新地址必须先「测试」通过再「保存」。
      </p>
      <el-input
        v-model="settings.webhookDraft"
        type="textarea"
        :autosize="{ minRows: 2, maxRows: 3 }"
        :disabled="!settings.notifyEnabled"
        spellcheck="false"
        class="webhook-input"
        placeholder="粘贴完整 Webhook URL"
        @keydown="onWebhookKeydown"
        @paste="onWebhookPaste"
      />
      <div class="ns-actions">
        <el-button :disabled="!settings.notifyEnabled" @click="copyWebhook">
          复制地址
        </el-button>
        <el-button
          :disabled="!settings.notifyEnabled"
          :loading="testingWebhook"
          @click="testWebhook"
        >
          测试推送
        </el-button>
        <el-button
          :type="canSaveWebhook ? 'primary' : 'default'"
          :disabled="!settings.notifyEnabled"
          @click="saveWebhook"
        >
          保存 Webhook
        </el-button>
      </div>
      <p class="ns-foot">{{ webhookHint }}</p>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { ElMessage } from "element-plus";
import { api } from "@/api";
import { formatErr } from "@/utils/format";
import { copyText, readText } from "@/utils/clipboard";
import {
  expandWecomWebhook,
  useSettingsStore,
} from "@/stores/settings";

const settings = useSettingsStore();
const testingWebhook = ref(false);

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
  if (!settings.notifyEnabled) return "企业微信已关闭，地址不会发送。";
  if (!draftNorm.value) {
    return savedExpanded.value
      ? "清空后保存将删除已保存的地址，无需测试。"
      : "先粘贴完整 Webhook，再点「测试推送」；通过后才能保存。";
  }
  if (webhookDirty.value && !webhookTested.value) {
    return "地址已改。请先测试，确认企业微信群收到消息后再保存。";
  }
  if (webhookDirty.value && webhookTested.value) {
    return "测试已通过，可以保存。请再到企业微信群确认已收到测试消息。";
  }
  return "当前为已保存地址。可点「测试推送」确认群内仍能收到。";
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
    ElMessage.warning("剪贴板为空，请先复制 Webhook 地址");
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
    ElMessage.warning("请先粘贴完整通知地址");
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
    ElMessage.warning("请先粘贴完整通知地址，再点测试");
    return;
  }
  testingWebhook.value = true;
  try {
    await api.testWecomWebhook(url);
    settings.webhookTested = draftNorm.value;
    ElMessage.success("测试已发出，请到企业微信群确认收到消息");
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
    ElMessage.info("当前地址已保存，无需再保存");
    return;
  }
  if (draftNorm.value && !webhookTested.value) {
    ElMessage.warning("请先测试通过，再保存");
    return;
  }
  settings.setWecomWebhook(expandWecomWebhook(draftNorm.value));
  ElMessage.success(draftNorm.value ? "Webhook 已保存" : "已清除 Webhook");
}

function onNotifyEnabled(v: string | number | boolean) {
  settings.setNotifyEnabled(Boolean(v));
}
</script>

<style scoped lang="scss">
.notify-page {
  width: 100%;
  max-width: none;
  padding: 12px 16px 28px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  box-sizing: border-box;
}
.notify-page__lead {
  margin: 0 0 8px;
  font: var(--m3-body-small);
  color: var(--m3-on-surface-variant);
  line-height: 1.5;
}

.ns-block {
  margin-top: 16px;
}
.ns-block__title {
  margin: 0 0 4px;
  font: var(--m3-label-large);
  font-weight: 600;
  color: var(--m3-on-surface);
}
.ns-block__hint {
  margin: 0 0 10px;
  font: var(--m3-body-small);
  color: var(--m3-on-surface-variant);
  line-height: 1.45;

  code {
    padding: 1px 5px;
    border-radius: 2px;
    background: color-mix(in srgb, var(--m3-on-surface) 6%, var(--m3-surface));
    font-family: var(--m3-font-mono, ui-monospace, Menlo, monospace);
    font-size: 12px;
  }
}
.ns-list {
  border: 1px solid var(--m3-outline-variant);
  border-radius: var(--m3-shape-xs);
  overflow: hidden;
  background: var(--m3-surface);
}
.ns-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 40px;
  padding: 8px 14px;
  box-sizing: border-box;
}
.ns-row + .ns-row {
  border-top: 1px solid var(--m3-outline-variant);
}
.ns-row__main {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.ns-row__name {
  font: var(--m3-body-medium);
  color: var(--m3-on-surface);
}
.ns-row__desc {
  font: var(--m3-body-small);
  color: var(--m3-on-surface-variant);
}
.ns-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 10px;
}
.ns-foot {
  margin: 8px 0 0;
  font: var(--m3-body-small);
  color: var(--m3-on-surface-variant);
  line-height: 1.45;
}
.webhook-input {
  font-family: var(--m3-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
  font-size: 13px;
}
</style>
