<template>
  <el-dialog
    :model-value="store.visible"
    :title="`安装 Agent — ${store.host}`"
    width="520px"
    append-to-body
    :close-on-click-modal="false"
    :close-on-press-escape="!store.running"
    :show-close="!store.running"
    class="agent-install-dialog"
    @update:model-value="(v: boolean) => v || store.close()"
  >
    <div class="install-body">
      <el-steps direction="vertical" :space="56" class="install-steps">
        <el-step
          v-for="s in store.steps"
          :key="s.key"
          :title="s.label"
          :status="elStatus(s.state)"
        >
          <template v-if="s.key === 'upload' && s.state === 'running'" #description>
            <el-progress
              :percentage="s.percent"
              :stroke-width="4"
              class="upload-progress"
            />
          </template>
        </el-step>
      </el-steps>

      <el-alert
        v-if="store.error"
        :title="store.error"
        type="error"
        :closable="false"
        show-icon
        class="install-result"
      />
      <el-alert
        v-else-if="store.resultText"
        :title="store.resultText"
        type="success"
        :closable="false"
        show-icon
        class="install-result"
      />
    </div>

    <template #footer>
      <p v-if="store.running" class="running-hint">
        正在安装，请稍候…（上传约 10MB，视网络可能需要一两分钟）
      </p>
      <el-button v-else type="primary" class="install-done-btn" @click="store.close()">
        {{ store.error ? "关闭" : "完成" }}
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import type { InstallStepState } from "@/stores/agentInstall";
import { useAgentInstallStore } from "@/stores/agentInstall";

const store = useAgentInstallStore();

type ElStepStatus = "" | "error" | "success" | "wait" | "process" | "finish";

const EL_STATUS: Record<InstallStepState, ElStepStatus> = {
  pending: "wait",
  running: "process",
  error: "error",
  done: "success",
};

function elStatus(state: InstallStepState): ElStepStatus {
  return EL_STATUS[state];
}
</script>

<style scoped lang="scss">
.install-body {
  min-height: 280px;
  display: flex;
  flex-direction: column;
}

.upload-progress {
  width: 92%;
  max-width: 360px;
  margin: 6px 0 2px;
}

.install-result {
  margin-top: 16px;
  border-radius: var(--m3-shape-s);
}

.running-hint {
  margin: 0;
  flex: 1;
  text-align: left;
  font: var(--m3-body-small);
  color: var(--m3-on-surface-variant);
  line-height: 1.45;
}

.install-done-btn {
  min-width: 88px;
  height: 40px;
  padding: 0 24px;
  border-radius: var(--m3-shape-full);
  font: var(--m3-label-large);
  font-weight: 500;
}
</style>

<!-- append-to-body：弹窗外壳与步骤需非 scoped 才能压过 EP 默认 -->
<style lang="scss">
.agent-install-dialog.el-dialog {
  padding: 24px;
  overflow: hidden;
  border: none;
  border-radius: var(--m3-shape-xl) !important;
  background: var(--m3-surface-container-lowest) !important;
  box-shadow: var(--m3-elevation-3) !important;

  .el-dialog__header {
    padding: 0 0 16px;
    margin: 0;
  }

  .el-dialog__title {
    font: var(--m3-headline-small) !important;
    font-weight: 500 !important;
    color: var(--m3-on-surface) !important;
  }

  .el-dialog__headerbtn {
    top: 8px;
    right: 8px;
    width: 40px;
    height: 40px;
  }

  .el-dialog__body {
    padding: 0;
  }

  .el-dialog__footer {
    padding: 20px 0 0;
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 12px;
  }
}

/* M3 风格垂直步骤：实心进度点 + outline-variant 连线 */
.agent-install-dialog .install-steps {
  --el-text-color-primary: var(--m3-on-surface);
  --el-text-color-placeholder: var(--m3-on-surface-variant);
  --el-color-primary: var(--m3-primary);
  --el-color-success: #4a6e5a;

  .el-step__head.is-process {
    color: var(--m3-primary);
    border-color: var(--m3-primary);
  }

  .el-step__head.is-finish,
  .el-step__head.is-success {
    color: var(--m3-primary);
    border-color: var(--m3-primary);
  }

  .el-step__head.is-wait {
    color: var(--m3-on-surface-variant);
    border-color: var(--m3-outline-variant);
  }

  .el-step__head.is-error {
    color: var(--m3-error);
    border-color: var(--m3-error);
  }

  .el-step__icon {
    width: 28px;
    height: 28px;
    font: var(--m3-label-large);
    font-weight: 600;
  }

  .el-step__icon.is-text {
    border-width: 1.5px;
  }

  .el-step__head.is-process .el-step__icon.is-text {
    background: var(--m3-primary);
    border-color: var(--m3-primary);
    color: var(--m3-on-primary);
  }

  .el-step__head.is-finish .el-step__icon.is-text,
  .el-step__head.is-success .el-step__icon.is-text {
    background: var(--m3-primary);
    border-color: var(--m3-primary);
    color: var(--m3-on-primary);
  }

  .el-step__title {
    font: var(--m3-title-small) !important;
    line-height: 20px !important;
  }

  .el-step__title.is-process {
    color: var(--m3-on-surface) !important;
    font-weight: 600 !important;
  }

  .el-step__title.is-finish,
  .el-step__title.is-success {
    color: var(--m3-on-surface) !important;
    font-weight: 500 !important;
  }

  .el-step__title.is-wait {
    color: var(--m3-on-surface-variant) !important;
    font-weight: 400 !important;
  }

  .el-step__line {
    background-color: var(--m3-outline-variant) !important;
  }

  .el-step__line-inner {
    border-color: var(--m3-primary) !important;
  }

  .el-progress-bar__outer {
    background: var(--m3-surface-container-highest) !important;
    border-radius: var(--m3-shape-full);
  }

  .el-progress-bar__inner {
    border-radius: var(--m3-shape-full);
    background: var(--m3-primary) !important;
  }

  .el-progress__text {
    font: var(--m3-label-medium);
    color: var(--m3-on-surface-variant) !important;
    min-width: 2.5em;
  }
}
</style>
