<template>
  <el-dialog
    :model-value="modelValue"
    title="设置"
    width="560px"
    append-to-body
    destroy-on-close
    class="settings-dialog"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <div class="settings-body">
      <!-- 主题 -->
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
            <div
              class="theme-swatch"
              :style="{ background: t.swatch.bg }"
            >
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

      <!-- 界面字体 -->
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

      <!-- 界面字号 -->
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

      <!-- 终端字体 -->
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

      <!-- 终端字号 -->
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
import { computed } from "vue";
import { Check } from "@element-plus/icons-vue";
import {
  FONT_OPTIONS,
  TERMINAL_FONT_OPTIONS,
  THEME_OPTIONS,
  useSettingsStore,
} from "@/stores/settings";

defineProps<{ modelValue: boolean }>();
const emit = defineEmits<{ "update:modelValue": [boolean] }>();

const settings = useSettingsStore();

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
  const n = Array.isArray(v) ? v[0] : v;
  settings.setFontSize(n);
}

function onTermFontSize(v: number | number[]) {
  const n = Array.isArray(v) ? v[0] : v;
  settings.setTerminalFontSize(n);
}
</script>

<style scoped lang="scss">
.settings-body {
  display: flex;
  flex-direction: column;
  gap: 20px;
  max-height: min(70vh, 560px);
  overflow-y: auto;
  padding-right: 4px;
}

.settings-section {
  min-width: 0;
}

.sec-title {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.sec-desc {
  margin: 4px 0 10px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
  line-height: 1.45;
}

.sec-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
}

.sec-value {
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  color: var(--el-text-color-secondary);
}

.theme-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
}

.theme-card {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px;
  border: 1px solid var(--el-border-color);
  border-radius: 8px;
  background: var(--el-bg-color);
  text-align: left;
  cursor: pointer;
  transition: border-color 0.15s, box-shadow 0.15s;

  &:hover {
    border-color: var(--el-color-primary-light-5);
  }
  &.active {
    border-color: var(--el-color-primary);
    box-shadow: 0 0 0 1px var(--el-color-primary);
  }
}

.theme-swatch {
  height: 48px;
  border-radius: 6px;
  border: 1px solid var(--el-border-color-lighter);
  display: flex;
  align-items: center;
  justify-content: center;
}

.theme-aa {
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 600;
}

.theme-name {
  font-size: 12px;
  font-weight: 600;
}

.theme-desc {
  margin-top: 2px;
  font-size: 11px;
  color: var(--el-text-color-secondary);
  line-height: 1.35;
}

.theme-check {
  position: absolute;
  top: 8px;
  right: 8px;
  color: var(--el-color-primary);
  font-size: 16px;
}

.preview-box {
  margin-top: 10px;
  padding: 10px 12px;
  border-radius: 6px;
  border: 1px dashed var(--el-border-color);
  background: var(--el-fill-color-lighter);
  color: var(--el-text-color-regular);
  line-height: 1.5;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;

  &--term {
    background: #0d0d0d;
    color: #d1d5db;
    border-color: #2a2a2a;
    font-variant-numeric: tabular-nums;
  }
}
</style>
