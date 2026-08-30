<template>
  <el-dialog
    :model-value="modelValue"
    title="设置"
    width="780px"
    append-to-body
    destroy-on-close
    class="settings-dialog"
    @update:model-value="emit('update:modelValue', $event)"
    @opened="onOpened"
  >
    <div class="settings-layout">
      <nav class="settings-nav" aria-label="设置分组">
        <button
          v-for="g in NAV_GROUPS"
          :key="g.id"
          type="button"
          class="nav-item"
          :class="{ active: activeGroup === g.id }"
          @click="activeGroup = g.id"
        >
          {{ g.label }}
        </button>
      </nav>

      <div class="settings-pane">
        <!-- 外观 -->
        <section v-if="activeGroup === 'appearance'" class="settings-section">
          <h3 class="sec-title">主题</h3>
          <p class="sec-desc">选择整体配色。「跟随系统」会按系统外观自动切换。</p>
          <div class="theme-grid">
            <button
              v-for="t in THEME_OPTIONS"
              :key="t.key"
              type="button"
              class="theme-card"
              :class="{ active: settings.theme === t.key }"
              @click="settings.setTheme(t.key)"
            >
              <div class="theme-swatch" :style="{ background: t.swatch.bg }">
                <span
                  class="theme-aa"
                  :style="{
                    background: t.swatch.accent,
                    color: t.swatch.fg === '#888' ? '#fff' : t.swatch.fg,
                  }"
                >
                  Aa
                </span>
              </div>
              <div class="theme-meta">
                <div class="theme-name">{{ t.name }}</div>
                <div class="theme-desc">{{ t.description }}</div>
              </div>
              <el-icon v-if="settings.theme === t.key" class="theme-check">
                <Check />
              </el-icon>
            </button>
          </div>
        </section>

        <!-- 界面 -->
        <template v-else-if="activeGroup === 'ui'">
          <section class="settings-section">
            <h3 class="sec-title">界面字体</h3>
            <p class="sec-desc">字体立刻应用到全局 UI（菜单、表格、表单等）。</p>
            <el-select
              :model-value="settings.fontFamily"
              style="width: 100%"
              @change="(v: string) => settings.setFontFamily(v)"
            >
              <el-option
                v-for="f in FONT_OPTIONS"
                :key="f.label"
                :label="f.label"
                :value="f.value"
              >
                <span :style="{ fontFamily: f.value }">{{ f.label }}</span>
              </el-option>
            </el-select>
          </section>
          <section class="settings-section">
            <div class="sec-row">
              <h3 class="sec-title">界面字号</h3>
              <span class="sec-value">{{ settings.fontSize }} px</span>
            </div>
            <p class="sec-desc">建议 12～14。范围 11～20。</p>
            <el-slider
              :model-value="settings.fontSize"
              :min="11"
              :max="20"
              :step="1"
              show-stops
              @update:model-value="onFontSize"
            />
            <div class="preview-box" :style="uiPreviewStyle">
              预览：主机列表 · 概览 · CPU 32.5% · root@server
            </div>
          </section>
        </template>

        <!-- 终端 -->
        <template v-else-if="activeGroup === 'terminal'">
          <section class="settings-section">
            <h3 class="sec-title">终端字体</h3>
            <p class="sec-desc">仅影响「终端」标签页中的 xterm 显示。</p>
            <el-select
              :model-value="settings.terminalFontFamily"
              style="width: 100%"
              @change="(v: string) => settings.setTerminalFontFamily(v)"
            >
              <el-option
                v-for="f in TERMINAL_FONT_OPTIONS"
                :key="f.label"
                :label="f.label"
                :value="f.value"
              />
            </el-select>
          </section>
          <section class="settings-section">
            <div class="sec-row">
              <h3 class="sec-title">终端字号</h3>
              <span class="sec-value">{{ settings.terminalFontSize }} px</span>
            </div>
            <p class="sec-desc">建议 12～14。范围 10～22。</p>
            <el-slider
              :model-value="settings.terminalFontSize"
              :min="10"
              :max="22"
              :step="1"
              show-stops
              @update:model-value="onTermFontSize"
            />
            <div class="preview-box preview-box--term" :style="termPreviewStyle">
              root@host:~$ ls -la /var/log
            </div>
          </section>
        </template>

        <!-- 会话 -->
        <section v-else-if="activeGroup === 'session'" class="settings-section">
          <div class="sec-row">
            <h3 class="sec-title">主机会话上限</h3>
            <span class="sec-value">{{ settings.maxRunningHosts }} 台</span>
          </div>
          <p class="sec-desc">
            同时在后台挂起的主机数。超限时自动关闭最早打开的非激活会话。范围 4～24。
          </p>
          <el-slider
            :model-value="settings.maxRunningHosts"
            :min="4"
            :max="24"
            :step="2"
            show-stops
            @update:model-value="onMaxRunningHosts"
          />
        </section>

        <!-- 通知 -->
        <template v-else-if="activeGroup === 'notify'">
          <section class="settings-section">
            <div class="sec-row">
              <div>
                <h3 class="sec-title">启用企微通知</h3>
                <p class="sec-desc sec-desc--inline">
                  总开关。关闭后不推送：含目标机 jar 探活，以及面板侧主机停机告警。
                </p>
              </div>
              <el-switch
                :model-value="settings.notifyEnabled"
                @change="onNotifyEnabled"
              />
            </div>
          </section>

          <section class="settings-section">
            <h3 class="sec-title">通知地址</h3>
            <p class="sec-desc">
              企业微信群机器人 Webhook 完整 URL，或只填
              <code>key=</code> 后面的 UUID。不会写入 git。改完后点「下发」写入选中主机；
              面板侧主机停机告警直接使用此处地址，无需下发。
            </p>
            <el-input
              :model-value="settings.wecomWebhook"
              :disabled="!settings.notifyEnabled"
              clearable
              placeholder="https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=…"
              @update:model-value="(v: string) => settings.setWecomWebhook(v)"
            />
          </section>

          <section class="settings-section">
            <h3 class="sec-title">下发到主机</h3>
            <p class="sec-desc">
              写入当前选中主机的
              <code>/var/lib/spanel-agent/watch.yml</code>（热加载）。服务清单等其它项保持不变。
            </p>
            <div class="notify-actions">
              <el-select
                v-model="targetHost"
                filterable
                clearable
                placeholder="选择主机"
                style="flex: 1; min-width: 0"
              >
                <el-option
                  v-for="h in hostOptions"
                  :key="h"
                  :label="h"
                  :value="h"
                />
              </el-select>
              <el-button
                type="primary"
                :loading="syncing"
                :disabled="!targetHost"
                @click="syncToHost"
              >
                下发
              </el-button>
            </div>
            <p v-if="!hostOptions.length" class="sec-hint">
              请先打开一台主机会话，或从侧栏选择主机。
            </p>
          </section>
        </template>
      </div>
    </div>

    <template #footer>
      <el-button @click="settings.resetSettings()">恢复默认</el-button>
      <el-button type="primary" @click="emit('update:modelValue', false)">
        完成
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { Check } from "@element-plus/icons-vue";
import { ElMessage } from "element-plus";
import { api } from "@/api";
import { useAppStore } from "@/stores/app";
import {
  FONT_OPTIONS,
  TERMINAL_FONT_OPTIONS,
  THEME_OPTIONS,
  useSettingsStore,
} from "@/stores/settings";
import { patchWatchNotify, readWatchNotify } from "@/utils/watchYaml";

defineProps<{ modelValue: boolean }>();
const emit = defineEmits<{ "update:modelValue": [boolean] }>();

type GroupId = "appearance" | "ui" | "terminal" | "session" | "notify";

const NAV_GROUPS: { id: GroupId; label: string }[] = [
  { id: "appearance", label: "外观" },
  { id: "ui", label: "界面" },
  { id: "terminal", label: "终端" },
  { id: "session", label: "会话" },
  { id: "notify", label: "通知" },
];

const settings = useSettingsStore();
const app = useAppStore();
const activeGroup = ref<GroupId>("appearance");
const targetHost = ref("");
const syncing = ref(false);

const hostOptions = computed(() => {
  const open = app.runningHosts.slice();
  const all = (app.hosts || []).map((h) => h.name).filter(Boolean);
  const set = new Set<string>([...open, ...all]);
  return [...set].sort();
});

const uiPreviewStyle = computed(() => ({
  fontFamily: settings.fontFamily,
  fontSize: `${settings.fontSize}px`,
}));

const termPreviewStyle = computed(() => ({
  fontFamily:
    settings.terminalFontFamily === "inherit"
      ? settings.fontFamily
      : settings.terminalFontFamily,
  fontSize: `${settings.terminalFontSize}px`,
}));

function onFontSize(v: number | number[]) {
  settings.setFontSize(Array.isArray(v) ? v[0] : v);
}

function onTermFontSize(v: number | number[]) {
  settings.setTerminalFontSize(Array.isArray(v) ? v[0] : v);
}

function onMaxRunningHosts(v: number | number[]) {
  settings.setMaxRunningHosts(Array.isArray(v) ? v[0] : v);
}

async function onNotifyEnabled(v: string | number | boolean) {
  settings.setNotifyEnabled(Boolean(v));
  // 总开关立刻同步到选中主机，避免只改本地不生效
  if (targetHost.value) {
    await syncToHost();
  }
}

function pickDefaultHost() {
  if (app.activeView?.kind === "host") {
    targetHost.value = app.activeView.id;
    return;
  }
  if (app.runningHosts.length) {
    targetHost.value = app.runningHosts[0];
    return;
  }
  if (hostOptions.value.length) {
    targetHost.value = hostOptions.value[0];
  }
}

async function loadFromHost(host: string) {
  if (!host) return;
  try {
    const r = await api.agentGetWatch(host);
    const n = readWatchNotify(r.yaml || "");
    if (n.wecomWebhook) {
      settings.setWecomWebhook(n.wecomWebhook);
      settings.setNotifyEnabled(true);
    } else if (n.wecomWebhook === "" && settings.wecomWebhook) {
      settings.setNotifyEnabled(false);
    }
  } catch {
    /* 主机未装 agent 时忽略，保留本地设置 */
  }
}

async function onOpened() {
  pickDefaultHost();
  if (targetHost.value) {
    await loadFromHost(targetHost.value);
  }
}

watch(targetHost, (h) => {
  if (h && activeGroup.value === "notify") {
    void loadFromHost(h);
  }
});

async function syncToHost() {
  const host = targetHost.value;
  if (!host) return;
  syncing.value = true;
  try {
    const cur = await api.agentGetWatch(host);
    const next = patchWatchNotify(cur.yaml || "", {
      wecomWebhook: settings.effectiveWecomWebhook(),
    });
    await api.agentPutWatch(host, next);
    ElMessage.success(`已下发通知配置到 ${host}`);
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : String(e));
  } finally {
    syncing.value = false;
  }
}
</script>

<style scoped lang="scss">
.settings-layout {
  display: flex;
  gap: 0;
  min-height: min(58vh, 460px);
  max-height: min(68vh, 540px);
  overflow: hidden;
  background: var(--m3-surface-container-lowest);
}

.settings-nav {
  flex: 0 0 148px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 4px 8px 12px 0;
  background: transparent;
}

.nav-item {
  appearance: none;
  border: none;
  background: transparent;
  text-align: left;
  padding: 10px 16px;
  border-radius: var(--m3-shape-full);
  font: var(--m3-label-large);
  color: var(--m3-on-surface-variant);
  cursor: pointer;
  transition: background-color var(--m3-motion-state), color var(--m3-motion-state);

  &:hover {
    background: color-mix(in srgb, var(--m3-on-surface) 6%, transparent);
    color: var(--m3-on-surface);
  }
  &.active {
    background: var(--m3-primary-container);
    color: var(--m3-primary);
    font-weight: 600;
  }
}

.settings-pane {
  flex: 1;
  min-width: 0;
  overflow-y: auto;
  padding: 4px 0 12px 16px;
  display: flex;
  flex-direction: column;
  gap: 28px;
  background: transparent;
}

.settings-section {
  min-width: 0;
}

.sec-title {
  margin: 0;
  font: var(--m3-title-medium);
  font-weight: 500;
  color: var(--m3-on-surface);
}

.sec-desc {
  margin: 6px 0 14px;
  font: var(--m3-body-medium);
  color: var(--m3-on-surface-variant);
  line-height: 1.5;

  &--inline {
    margin-bottom: 0;
    font: var(--m3-body-small);
  }

  code {
    padding: 1px 6px;
    border-radius: var(--m3-shape-xs);
    background: var(--m3-surface-container);
    font-family: var(--m3-font-mono);
    font-size: 12px;
  }
}

.sec-hint {
  margin: 8px 0 0;
  font: var(--m3-body-small);
  color: var(--m3-on-surface-variant);
}

.sec-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.sec-value {
  font: var(--m3-label-large);
  font-variant-numeric: tabular-nums;
  color: var(--m3-primary);
  font-weight: 600;
}

.notify-actions {
  display: flex;
  gap: 10px;
  align-items: center;
}

.theme-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
}

.theme-card {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  border: 1px solid var(--m3-outline-variant);
  border-radius: var(--m3-shape-m);
  background: var(--m3-surface-container-lowest);
  text-align: left;
  cursor: pointer;
  transition: border-color var(--m3-motion-select), background-color var(--m3-motion-state);

  &:hover {
    border-color: color-mix(in srgb, var(--m3-primary) 28%, var(--m3-outline-variant));
  }
  &.active {
    border-color: var(--m3-primary);
    background: color-mix(in srgb, var(--m3-primary) 4%, var(--m3-surface-container-lowest));
  }
}

.theme-swatch {
  height: 56px;
  border-radius: var(--m3-shape-s);
  border: 1px solid var(--m3-outline-variant);
  display: flex;
  align-items: center;
  justify-content: center;
}

.theme-aa {
  padding: 4px 12px;
  border-radius: var(--m3-shape-full);
  font: var(--m3-label-medium);
  font-weight: 600;
}

.theme-name {
  font: var(--m3-title-small);
  font-weight: 600;
  color: var(--m3-on-surface);
}

.theme-desc {
  margin-top: 2px;
  font: var(--m3-body-small);
  color: var(--m3-on-surface-variant);
  line-height: 1.4;
}

.theme-check {
  position: absolute;
  top: 10px;
  right: 10px;
  width: 22px;
  height: 22px;
  border-radius: var(--m3-shape-full);
  background: var(--m3-primary);
  color: var(--m3-on-primary) !important;
  font-size: 14px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.preview-box {
  margin-top: 12px;
  padding: 14px 16px;
  border-radius: var(--m3-shape-s);
  border: 1px solid var(--m3-outline-variant);
  background: var(--m3-surface-container);
  color: var(--m3-on-surface);
  font: var(--m3-body-medium);
  line-height: 1.5;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;

  &--term {
    background: #272822;
    color: #f8f8f2;
    border-color: #49483e;
    font-family: var(--m3-font-mono);
    font-variant-numeric: tabular-nums;
  }
}
</style>
