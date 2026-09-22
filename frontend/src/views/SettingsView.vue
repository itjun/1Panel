<template>
  <div class="settings-page">
    <ChromeTeleport>
      <el-button
        v-tip="'把本页改过的设置项恢复为默认值'"
        :disabled="!sectionModified"
        @click="onResetSection"
      >
        恢复本页默认值
      </el-button>
      <el-button
        v-tip="'恢复外观、会话、应用三页全部默认值；通知配置不动'"
        @click="onResetAll"
      >
        恢复应用全部默认值
      </el-button>
    </ChromeTeleport>

    <div class="settings-scroll">
      <template v-if="app.settingsSection === 'look'">
        <h2 class="group-title">外观</h2>
        <div class="row" :class="{ 'is-modified': isUiFontFamilyModified }">
          <div class="row-text">
            <span class="row-name">界面字体</span>
            <span class="row-hint" :style="uiPreviewStyle">主机列表 · 概览 · CPU 32.5%</span>
          </div>
          <el-select
            class="row-select"
            :model-value="settings.fontFamily"
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
        </div>
        <div class="row" :class="{ 'is-modified': isUiFontSizeModified }">
          <div class="row-text">
            <span class="row-name">界面字号</span>
            <span class="row-hint">11～20，改完立刻生效</span>
          </div>
          <div class="row-control row-control--slider">
            <span class="row-value">{{ settings.fontSize }} px</span>
            <el-slider
              :model-value="settings.fontSize"
              :min="11"
              :max="20"
              :step="1"
              :show-tooltip="false"
              @update:model-value="onFontSize"
            />
          </div>
        </div>
        <div class="row" :class="{ 'is-modified': isTermFontFamilyModified }">
          <div class="row-text">
            <span class="row-name">终端字体</span>
            <span class="term-sample" :style="termPreviewStyle">root@host:~$ ls</span>
          </div>
          <el-select
            class="row-select"
            :model-value="settings.terminalFontFamily"
            @change="(v: string) => settings.setTerminalFontFamily(v)"
          >
            <el-option
              v-for="f in TERMINAL_FONT_OPTIONS"
              :key="f.label"
              :label="f.label"
              :value="f.value"
            />
          </el-select>
        </div>
        <div class="row" :class="{ 'is-modified': isTermFontSizeModified }">
          <div class="row-text">
            <span class="row-name">终端字号</span>
            <span class="row-hint">macOS 默认 14，Windows 默认 16</span>
          </div>
          <div class="row-control row-control--slider">
            <span class="row-value">{{ settings.terminalFontSize }} px</span>
            <el-slider
              :model-value="settings.terminalFontSize"
              :min="10"
              :max="22"
              :step="1"
              :show-tooltip="false"
              @update:model-value="onTermFontSize"
            />
          </div>
        </div>
      </template>

      <template v-else-if="app.settingsSection === 'session'">
        <h2 class="group-title">会话</h2>
        <div class="row" :class="{ 'is-modified': isStartupModified }">
          <div class="row-text">
            <span class="row-name">启动时打开</span>
            <span class="row-hint">已开的标签都会留着，这里只决定落在哪一页。下次启动生效</span>
          </div>
          <el-radio-group
            :model-value="settings.startupPage"
            @change="onStartupPage"
          >
            <el-radio value="home">主机首页</el-radio>
            <el-radio value="resume">上次离开的画面</el-radio>
          </el-radio-group>
        </div>
      </template>

      <template v-else>
        <h2 class="group-title">应用</h2>
        <div class="row">
          <div class="row-text">
            <span class="row-name">本机出口</span>
            <span class="row-hint">公网 IP，来自 myip.ipip.net</span>
          </div>
          <div class="row-control">
            <span v-if="egressLoading && !egress" class="row-muted">检测中…</span>
            <span v-else-if="egress?.ip" class="machine-value" v-tip="machineTitle">
              <span class="machine-ip">{{ egress.ip }}</span>
              <span v-if="egress.location" class="machine-loc">{{ egress.location }}</span>
            </span>
            <span v-else class="row-muted">未知</span>
            <el-button
              link
              type="primary"
              :icon="Refresh"
              :loading="egressLoading"
              @click="loadEgress(true)"
            >
              刷新
            </el-button>
          </div>
        </div>
        <div class="row">
          <div class="row-text">
            <span class="row-name">主机配置</span>
            <span class="row-hint">Panel JSON 是主源；外部导出默认脱敏，不含 SSH 私钥</span>
          </div>
          <div class="row-control">
            <el-button :loading="exporting" @click="onExportBackup">导出…</el-button>
            <el-button @click="backupImportRef?.openFor()">导入…</el-button>
          </div>
        </div>
        <div class="row">
          <div class="row-text">
            <span class="row-name">SSH 配置同步</span>
            <span class="row-hint">Panel JSON → ~/.ssh/config + config.d；外部修改会先导入差异</span>
          </div>
          <div class="row-control">
            <el-tag :type="panelConfigTagType" effect="plain">{{ panelConfigLabel }}</el-tag>
            <el-button link type="primary" :loading="panelConfigLoading" @click="refreshPanelConfigStatus">
              刷新
            </el-button>
            <el-button type="primary" :loading="panelConfigLoading" @click="openConfigCenter">
              打开配置中心
            </el-button>
          </div>
        </div>
        <div class="row" :class="{ 'is-modified': isAskQuitModified }">
          <div class="row-text">
            <span class="row-name">{{ quitKbd }} 退出前询问</span>
            <span class="row-hint">关掉后，{{ quitKbd }} 直接挂到后台。关窗口本身不会退出</span>
          </div>
          <el-switch
            :model-value="askBeforeQuit"
            @change="(v: string | number | boolean) => onAskBeforeQuit(Boolean(v))"
          />
        </div>
        <div class="row row--actions">
          <div class="row-text">
            <span class="row-name">重启或退出</span>
            <span class="row-hint">重启会断开所有主机。退出后后台监听停止，通知不再送达</span>
          </div>
          <div class="row-control">
            <el-button @click="onRestart">重启应用</el-button>
            <el-button @click="onQuitForReal">退出应用</el-button>
          </div>
        </div>
      </template>
    </div>
    <BackupImportDialog ref="backupImportRef" />

  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { Refresh } from "@element-plus/icons-vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { Dialogs, Events } from "@wailsio/runtime";
import { api } from "@/api";
import type { main, monitor } from "@/api";
import { formatErr } from "@/utils/format";
import BackupImportDialog from "@/components/BackupImportDialog.vue";
import ChromeTeleport from "@/components/ChromeTeleport.vue";
import { useAppStore } from "@/stores/app";
import {
  FONT_OPTIONS,
  SETTINGS_DEFAULTS,
  TERMINAL_FONT_OPTIONS,
  useSettingsStore,
  type StartupPage,
} from "@/stores/settings";

/** 进程内缓存：离开设置页卸载后仍保留，避免每次进出都打 myip */
let egressCache: monitor.EgressInfo | null = null;

const app = useAppStore();
const settings = useSettingsStore();
const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
const quitKbd = isMac ? "⌘Q" : "Ctrl+Q";
const askBeforeQuit = ref(true);
const exporting = ref(false);
const backupImportRef = ref<InstanceType<typeof BackupImportDialog> | null>(
  null
);
const egress = ref<monitor.EgressInfo | null>(egressCache);
const egressLoading = ref(false);
const panelConfigStatus = ref<main.PanelConfigStatus | null>(null);
const panelConfigLoading = ref(false);
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

const machineTitle = computed(() => {
  if (!egress.value?.ip) return "本机出口公网 IP";
  const loc = egress.value.location ? ` · ${egress.value.location}` : "";
  return `${egress.value.ip}${loc}\n来源：myip.ipip.net`;
});

const panelConfigLabel = computed(() => {
  const status = panelConfigStatus.value;
  if (!status) return "检测中";
  if (status.needsReview) return "需导入确认";
  if (status.configStale) return "配置过期";
  if (status.drift) return "检测到外部修改";
  return "已同步";
});

const panelConfigTagType = computed(() => {
  const status = panelConfigStatus.value;
  if (!status) return "info";
  if (status.needsReview || status.configStale) return "danger";
  if (status.drift) return "warning";
  return "success";
});

/** 值 ≠ 默认值的行高亮；本页有改过项时「恢复本页默认值」才可用 */
const isUiFontFamilyModified = computed(
  () => settings.fontFamily !== SETTINGS_DEFAULTS.fontFamily
);
const isUiFontSizeModified = computed(
  () => settings.fontSize !== SETTINGS_DEFAULTS.fontSize
);
const isTermFontFamilyModified = computed(
  () => settings.terminalFontFamily !== SETTINGS_DEFAULTS.terminalFontFamily
);
const isTermFontSizeModified = computed(
  () => settings.terminalFontSize !== SETTINGS_DEFAULTS.terminalFontSize
);
const isStartupModified = computed(
  () => settings.startupPage !== SETTINGS_DEFAULTS.startupPage
);
/** 应用页可改的设置项只有「退出前询问」，默认开 */
const isAskQuitModified = computed(() => !askBeforeQuit.value);

const sectionModified = computed(() => {
  const sec = app.settingsSection;
  if (sec === "look") {
    return (
      isUiFontFamilyModified.value ||
      isUiFontSizeModified.value ||
      isTermFontFamilyModified.value ||
      isTermFontSizeModified.value
    );
  }
  if (sec === "session") return isStartupModified.value;
  return isAskQuitModified.value;
});

function onFontSize(v: number | number[]) {
  settings.setFontSize(Array.isArray(v) ? v[0] : v);
}

function onTermFontSize(v: number | number[]) {
  settings.setTerminalFontSize(Array.isArray(v) ? v[0] : v);
}

function onStartupPage(v: string | number | boolean | undefined) {
  const next: StartupPage = v === "resume" ? "resume" : "home";
  settings.setStartupPage(next);
}

function onResetSection() {
  const sec = app.settingsSection;
  if (sec === "look" || sec === "session") {
    settings.resetSettingsSection(sec);
    ElMessage.success("已恢复本页默认值");
    return;
  }
  void resetAskBeforeQuit();
}

/** 应用页的默认值：退出前询问恢复为开 */
async function resetAskBeforeQuit() {
  try {
    await api.setAskBeforeQuit(true);
    askBeforeQuit.value = true;
    ElMessage.success("已恢复本页默认值");
  } catch (e) {
    ElMessage.error(formatErr(e));
  }
}

async function onResetAll() {
  settings.resetSettings();
  try {
    await api.setAskBeforeQuit(true);
    askBeforeQuit.value = true;
    ElMessage.success("已恢复应用全部默认值");
  } catch (e) {
    ElMessage.error(formatErr(e));
  }
}

async function loadEgress(force: boolean) {
  if (egressLoading.value) return;
  if (!force && egressCache) {
    egress.value = egressCache;
    return;
  }
  egressLoading.value = true;
  try {
    const r = await api.getMyEgress();
    if (r && r.ip) {
      egressCache = r;
      egress.value = r;
    } else if (!egressCache) {
      egress.value = r ?? null;
    }
  } catch {
    if (!egressCache) egress.value = null;
  } finally {
    egressLoading.value = false;
  }
}

async function onAskBeforeQuit(v: boolean) {
  askBeforeQuit.value = v;
  try {
    await api.setAskBeforeQuit(v);
  } catch (e) {
    ElMessage.error(formatErr(e));
  }
}

async function onExportBackup() {
  const dir = await Dialogs.OpenFile({
    Title: "选择备份位置",
    CanChooseDirectories: true,
    CanChooseFiles: false,
    CanCreateDirectories: true,
  });
  if (!dir) return;
  exporting.value = true;
  try {
    const msg = await api.exportBackup(dir);
    ElMessage.success(msg);
  } catch (e) {
    ElMessage.error(formatErr(e));
  } finally {
    exporting.value = false;
  }
}

async function refreshPanelConfigStatus() {
  panelConfigLoading.value = true;
  try {
    panelConfigStatus.value = await api.getPanelConfigStatus();
  } catch (e) {
    ElMessage.error(formatErr(e));
  } finally {
    panelConfigLoading.value = false;
  }
}

function openConfigCenter() {
	app.setConfigSection("overview");
	app.setWorkspace("config");
}

async function onRestart() {
  try {
    await ElMessageBox.confirm(
      "将断开所有主机连接并重启 1Pannel",
      "重启应用",
      { confirmButtonText: "重启", cancelButtonText: "取消", type: "warning" }
    );
  } catch {
    return;
  }
  void Events.Emit("app-restart");
}

async function onQuitForReal() {
  try {
    await ElMessageBox.confirm(
      "将结束后台监听，系统通知与企微不再送达",
      "退出应用",
      { confirmButtonText: "退出", cancelButtonText: "取消", type: "warning" }
    );
  } catch {
    return;
  }
  void Events.Emit("app-quit-for-real");
}

let offAskBeforeQuit: (() => void) | null = null;
let offPanelConfigChange: (() => void) | null = null;

/** 本机出口只在应用页加载；组件常驻时切分页不会重新挂载，用 watch 跟随 */
watch(
  () => app.settingsSection,
  (sec) => {
    if (sec === "app") void loadEgress(false);
  },
  { immediate: true }
);

onMounted(() => {
  void api
    .getAskBeforeQuit()
    .then((v) => {
      askBeforeQuit.value = v;
    })
    .catch(() => {});
  offAskBeforeQuit = Events.On(
    "ask-before-quit-changed",
    (ev: { data?: boolean }) => {
      if (typeof ev?.data === "boolean") {
        askBeforeQuit.value = ev.data;
      }
    }
  );
  offPanelConfigChange = Events.On("panel-config-imported", () => {
    void refreshPanelConfigStatus();
  });
  void refreshPanelConfigStatus();
});

onUnmounted(() => {
  if (offAskBeforeQuit) {
    offAskBeforeQuit();
    offAskBeforeQuit = null;
  }
  if (offPanelConfigChange) {
    offPanelConfigChange();
    offPanelConfigChange = null;
  }
});
</script>

<style scoped lang="scss">
.settings-page {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  min-width: 0;
  background: var(--m3-content);
}

.settings-scroll {
  flex: 1 1 auto;
  align-self: center;
  width: 100%;
  max-width: 880px;
  min-height: 0;
  overflow-y: auto;
  padding: 8px 16px 16px;
  box-sizing: border-box;
  scrollbar-width: thin;
}

.group-title {
  margin: 8px 0 2px;
  font: var(--m3-label-large);
  font-weight: 600;
  color: var(--m3-on-surface-variant);
}

.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px 28px;
  min-height: 56px;
  padding: 8px 0;
  border-bottom: 1px solid var(--m3-outline-variant);
  box-sizing: border-box;
}

/** 值和默认值不一样的行：淡主色底 + 名称前主色圆点 */
.row.is-modified {
  background: color-mix(in srgb, var(--m3-primary) 5%, transparent);

  .row-name {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--m3-primary);
  }

  .row-name::before {
    content: "";
    flex: 0 0 6px;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--m3-primary);
  }
}

.row-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  flex: 1 1 auto;
}

.row-name {
  font: var(--m3-body-medium);
  font-weight: 600;
  color: var(--m3-on-surface);
}

.row-hint,
.row-muted {
  font: var(--m3-body-small);
  color: var(--m3-on-surface-variant);
  line-height: 1.4;
}

.row-control {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
  flex: 0 1 360px;
  min-width: 0;
}

.row-control--slider {
  gap: 14px;

  .el-slider {
    flex: 1 1 180px;
    min-width: 140px;
    max-width: 240px;
  }
}

.panel-config-dialog :deep(.el-dialog__body) {
  padding-top: 8px;
}

.panel-config-alert {
  margin-bottom: 10px;
}

.panel-config-editor :deep(textarea) {
  min-height: 480px;
  padding: 12px;
  font-family: var(--m3-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
  font-size: 12px;
  line-height: 1.55;
  tab-size: 4;
}

.panel-config-hint {
  margin: 8px 0 0;
  color: var(--m3-on-surface-variant);
  font: var(--m3-body-small);
  line-height: 1.5;
}

.row-select {
  width: 280px;
  max-width: 46%;
  flex-shrink: 0;
}

.row-value {
  flex-shrink: 0;
  min-width: 52px;
  text-align: right;
  font: var(--m3-label-large);
  font-variant-numeric: tabular-nums;
  font-weight: 600;
  color: var(--m3-primary);
}

.machine-value {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: flex-end;
  gap: 8px;
  min-width: 0;
  font: var(--m3-body-medium);
  color: var(--m3-on-surface);
}

.machine-ip {
  font-family: var(--m3-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
  font-variant-numeric: tabular-nums;
  font-weight: 600;
}

.machine-loc {
  color: var(--m3-on-surface-variant);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.term-sample {
  align-self: flex-start;
  max-width: 100%;
  margin-top: 4px;
  padding: 2px 8px;
  border-radius: 2px;
  background: #000;
  color: #f8f8f2;
  line-height: 1.4;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

@media (max-width: 760px) {
  .row {
    flex-wrap: wrap;
  }

  .row-control,
  .row-select {
    width: 100%;
    max-width: none;
    flex-basis: 100%;
    justify-content: flex-start;
  }
}
</style>
