<template>
  <div class="settings-page">
    <div class="settings-header">
      <h1 class="settings-title">设置</h1>
      <el-button
        v-tip="'仅恢复外观、界面、终端与会话；通知配置保留'"
        @click="settings.resetSettings()"
      >
        恢复默认
      </el-button>
    </div>

    <div class="settings-machine">
      <span class="machine-label">本机</span>
      <span
        v-if="egressLoading && !egress"
        class="machine-value is-muted"
      >
        检测中…
      </span>
      <span
        v-else-if="egress?.ip"
        class="machine-value"
        v-tip="machineTitle"
      >
        <span class="machine-ip">{{ egress.ip }}</span>
        <span v-if="egress.location" class="machine-loc">{{
          egress.location
        }}</span>
      </span>
      <span v-else class="machine-value is-muted">出口 IP 未知</span>
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

    <div class="settings-body">
      <div class="settings-pane">
        <!-- 外观 -->
        <template v-if="settings.lastNavGroup === 'appearance'">
          <section class="settings-section">
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
        </template>

        <!-- 界面 -->
        <template v-else-if="settings.lastNavGroup === 'ui'">
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
        <template v-else-if="settings.lastNavGroup === 'terminal'">
          <section class="settings-section">
            <h3 class="sec-title">终端字体</h3>
            <p class="sec-desc">仅影响「终端」标签页。macOS 默认 SF Mono，Windows 默认 Consolas。</p>
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
            <p class="sec-desc">macOS 默认 14，Windows 默认 16。范围 10～22。</p>
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
        <section
          v-else-if="settings.lastNavGroup === 'session'"
          class="settings-section"
        >
          <div class="sec-row">
            <h3 class="sec-title">主机会话上限</h3>
            <span class="sec-value">{{ settings.maxRunningHosts }} 台</span>
          </div>
          <p class="sec-desc">
            同时在后台挂起的主机数。超限时自动关闭最早打开、且未开终端的非激活会话。范围
            4～32。
          </p>
          <el-slider
            :model-value="settings.maxRunningHosts"
            :min="4"
            :max="32"
            :step="2"
            show-stops
            @update:model-value="onMaxRunningHosts"
          />
        </section>

        <!-- 应用 -->
        <template v-else-if="settings.lastNavGroup === 'app'">
          <section class="settings-section">
            <h3 class="sec-title">主机配置</h3>
            <p class="sec-desc">
              导出或导入本机主机列表、分组与图标。备份含已保存的主机密码，不含 SSH 私钥；换机恢复需另行保管密钥。
            </p>
            <div class="notify-actions">
              <el-button :loading="exporting" @click="onExportBackup">
                导出主机配置…
              </el-button>
              <el-button @click="backupImportRef?.openFor()">
                导入主机配置…
              </el-button>
            </div>
          </section>
          <section class="settings-section">
            <h3 class="sec-title">重启应用</h3>
            <p class="sec-desc">
              将断开所有主机连接并重启 1Pannel。运行中的终端会话会中断。
            </p>
            <el-button @click="onRestart">重启应用</el-button>
          </section>
          <section class="settings-section">
            <h3 class="sec-title">退出应用</h3>
            <p class="sec-desc">
              关闭窗口只会挂到后台。{{ quitKbd }} 可先确认：挂到后台还是彻底退出。真正退出后后台监听停止。
            </p>
            <div class="sec-row">
              <div>
                <h3 class="sec-title">{{ quitKbd }} 退出前询问</h3>
                <p class="sec-desc sec-desc--inline">
                  关闭后，{{ quitKbd }} 将直接挂到后台
                </p>
              </div>
              <el-switch
                :model-value="askBeforeQuit"
                @change="(v: string | number | boolean) => onAskBeforeQuit(Boolean(v))"
              />
            </div>
            <el-button @click="onQuitForReal">退出应用</el-button>
          </section>
        </template>
      </div>
    </div>
    <BackupImportDialog ref="backupImportRef" />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { Check, Refresh } from "@element-plus/icons-vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { Dialogs, Events } from "@wailsio/runtime";
import { api } from "@/api";
import type { monitor } from "@/api";
import { formatErr } from "@/utils/format";
import BackupImportDialog from "@/components/BackupImportDialog.vue";
import {
  FONT_OPTIONS,
  TERMINAL_FONT_OPTIONS,
  THEME_OPTIONS,
  useSettingsStore,
} from "@/stores/settings";

/** 进程内缓存：离开设置页卸载后仍保留，避免每次进出都打 myip */
let egressCache: monitor.EgressInfo | null = null;

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

function onFontSize(v: number | number[]) {
  settings.setFontSize(Array.isArray(v) ? v[0] : v);
}

function onTermFontSize(v: number | number[]) {
  settings.setTerminalFontSize(Array.isArray(v) ? v[0] : v);
}

function onMaxRunningHosts(v: number | number[]) {
  settings.setMaxRunningHosts(Array.isArray(v) ? v[0] : v);
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

onMounted(() => {
  void loadEgress(false);
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
});

onUnmounted(() => {
  if (offAskBeforeQuit) {
    offAskBeforeQuit();
    offAskBeforeQuit = null;
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
  padding: 20px 28px 28px;
  box-sizing: border-box;
  /* 与主栏灰画布统一 */
  background: var(--m3-canvas);
}

.settings-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-shrink: 0;
}

.settings-title {
  margin: 0;
  font: var(--m3-headline-small);
  font-weight: 400;
  color: var(--m3-on-surface);
}

.settings-machine {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
  min-width: 0;
  padding: 12px 0 16px;
  margin-bottom: 8px;
  border-bottom: 1px solid var(--m3-outline-variant);
}

.machine-label {
  flex-shrink: 0;
  font: var(--m3-label-large);
  font-weight: 600;
  color: var(--m3-on-surface-variant);
}

.machine-value {
  flex: 0 1 auto;
  min-width: 0;
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 8px;
  font: var(--m3-body-medium);
  color: var(--m3-on-surface);

  &.is-muted {
    color: var(--m3-on-surface-variant);
    font-style: italic;
  }
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

.settings-body {
  flex: 1;
  min-height: 0;
  display: flex;
  gap: 0;
}

.settings-pane {
  flex: 1;
  min-width: 0;
  max-width: 760px;
  overflow-y: auto;
  padding: 4px 0 12px;
  display: flex;
  flex-direction: column;
  gap: 20px;
  scrollbar-width: none;

  &::-webkit-scrollbar {
    display: none;
  }
}

.settings-section {
  min-width: 0;
  padding: 18px 20px;
  background: var(--m3-card);
  border: 1px solid var(--m3-outline-variant);
  border-radius: var(--m3-shape-m);
  box-sizing: border-box;
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
    background: color-mix(in srgb, var(--m3-on-surface) 6%, var(--m3-surface));
    font-family: var(--m3-font-mono);
    font-size: 12px;
  }
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
  margin-top: 10px;
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
  background: var(--m3-card);
  text-align: left;
  cursor: pointer;
  transition: border-color var(--m3-motion-select),
    background-color var(--m3-motion-state);

  &:hover {
    border-color: color-mix(
      in srgb,
      var(--m3-primary) 28%,
      var(--m3-outline-variant)
    );
  }
  &.active {
    border-color: var(--m3-primary);
    background: color-mix(
      in srgb,
      var(--m3-primary) 4%,
      var(--m3-surface-container-lowest)
    );
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
  background: var(--m3-surface);
  color: var(--m3-on-surface);
  font: var(--m3-body-medium);
  line-height: 1.5;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;

  &--term {
    background: #000000;
    color: #f8f8f2;
    border-color: #49483e;
    font-family: var(--m3-font-mono);
    font-variant-numeric: tabular-nums;
  }
}
</style>
